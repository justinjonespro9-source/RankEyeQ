import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCreatorBoardPage } from "@/lib/admin/creator-board-page";
import { createCreatorCompetitor } from "@/lib/creator-identity";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `cbp${Date.now().toString(36)}`;

describe("loadCreatorBoardPage — empty WR/RB boards", () => {
  let seasonId = "";
  let weekId = "";
  let wrContestId = "";
  let rbContestId = "";
  let creatorId = "";
  let wrEntryIds: string[] = [];

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: 2099, sport: `CBP-${suffix}`, active: false },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Creator Board Page Week",
        startsAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
        endsAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
        status: "OPEN",
        fullLockAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
        isTest: true,
      },
    });
    weekId = week.id;

    const wr = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "WR",
        title: "WR Top 15",
        rankingDepth: rankingDepthForPosition("WR"),
        status: "OPEN",
      },
    });
    wrContestId = wr.id;

    const rb = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "RB Top 10",
        rankingDepth: rankingDepthForPosition("RB"),
        status: "OPEN",
      },
    });
    rbContestId = rb.id;

    const creator = await createCreatorCompetitor({
      personName: `Board Page ${suffix}`,
      brandName: "Board Channel",
      username: `board_${suffix.slice(-8)}`,
    });
    creatorId = creator.id;

    wrEntryIds = [];
    for (let i = 1; i <= 16; i += 1) {
      const thursday = i <= 3;
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `cbp-wr-${suffix}-${i}`,
          type: "PLAYER",
          name: `Board WR ${i}`,
          shortName: `BWR${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "WR",
          gameStartsAt: thursday
            ? zonedLocalToUtc(2026, 9, 10, 19, 20)
            : zonedLocalToUtc(2026, 9, 13, 12, 0),
        },
      });
      await prisma.contestEntry.create({
        data: { contestId: wrContestId, rankableEntryId: entry.id },
      });
      wrEntryIds.push(entry.id);
    }

    for (let i = 1; i <= 10; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `cbp-rb-${suffix}-${i}`,
          type: "PLAYER",
          name: `Board RB ${i}`,
          shortName: `BRB${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "RB",
          gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        },
      });
      await prisma.contestEntry.create({
        data: { contestId: rbContestId, rankableEntryId: entry.id },
      });
    }
  });

  afterAll(async () => {
    await prisma.benchmarkSnapshotPick.deleteMany({
      where: { snapshot: { weekId } },
    });
    await prisma.benchmarkSnapshot.deleteMany({ where: { weekId } });
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.contestEntry.deleteMany({ where: { contest: { weekId } } });
    await prisma.rankableEntry.deleteMany({
      where: { provider: "test", externalId: { startsWith: `cbp-` } },
    });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.week.delete({ where: { id: weekId } });
    await prisma.season.delete({ where: { id: seasonId } });
    await prisma.creatorCompetitorProfile
      .deleteMany({ where: { universalProfileId: creatorId } })
      .catch(() => undefined);
    await prisma.universalProfile.delete({ where: { id: creatorId } }).catch(
      () => undefined,
    );
  });

  it("loads new Creator RB board with no prior data", async () => {
    const model = await loadCreatorBoardPage({
      profileId: creatorId,
      contestId: rbContestId,
      weekId,
      now: zonedLocalToUtc(2026, 9, 9, 12, 0),
    });
    expect("notFound" in model).toBe(false);
    if ("notFound" in model) return;
    expect(model.position).toBe("RB");
    expect(model.rankingDepth).toBe(10);
    expect(model.eligibleCount).toBe(10);
    expect(model.submissionStatus).toBeNull();
    expect(model.snapshots).toEqual([]);
    expect(model.hasOfficialBoard).toBe(false);
    expect(model.timingNotice).toBeNull();
  });

  it("loads new Creator WR board with no prior data before kickoff", async () => {
    const model = await loadCreatorBoardPage({
      profileId: creatorId,
      contestId: wrContestId,
      weekId,
      now: zonedLocalToUtc(2026, 9, 9, 12, 0),
    });
    expect("notFound" in model).toBe(false);
    if ("notFound" in model) return;
    expect(model.position).toBe("WR");
    expect(model.rankingDepth).toBe(15);
    expect(model.eligibleCount).toBe(16);
    expect(model.submissionStatus).toBeNull();
    expect(model.latestSnapshotId).toBeNull();
    expect(model.snapshots).toEqual([]);
    expect(model.hasOfficialBoard).toBe(false);
    expect(model.timingNotice).toBeNull();
  });

  it("loads WR after Thursday kickoff with clear timing notice, no throw", async () => {
    const model = await loadCreatorBoardPage({
      profileId: creatorId,
      contestId: wrContestId,
      weekId,
      now: zonedLocalToUtc(2026, 9, 11, 12, 0),
    });
    expect("notFound" in model).toBe(false);
    if ("notFound" in model) return;
    expect(model.timingNotice?.kind).toBe("thursday_started_no_snapshot");
    expect(model.timingNotice?.thursdayStartedCount).toBeGreaterThan(0);
    expect(model.hasOfficialBoard).toBe(false);
  });

  it("still loads WR when a snapshot exists", async () => {
    const admin = await prisma.user.create({
      data: {
        email: `cbp-admin-${suffix}@rankiq.local`,
        role: "ADMIN",
        emailVerified: new Date(),
      },
    });
    await prisma.benchmarkSnapshot.create({
      data: {
        universalProfileId: creatorId,
        contestId: wrContestId,
        weekId,
        captureType: "THURSDAY",
        capturedAt: zonedLocalToUtc(2026, 9, 10, 12, 0),
        status: "CAPTURED",
        adminUserId: admin.id,
        rawText: "draft",
      },
    });

    const model = await loadCreatorBoardPage({
      profileId: creatorId,
      contestId: wrContestId,
      weekId,
      now: zonedLocalToUtc(2026, 9, 11, 12, 0),
    });
    expect("notFound" in model).toBe(false);
    if ("notFound" in model) return;
    expect(model.snapshots.length).toBe(1);
    expect(model.timingNotice).toBeNull();

    await prisma.benchmarkSnapshot.deleteMany({
      where: { contestId: wrContestId, universalProfileId: creatorId },
    });
    await prisma.user.delete({ where: { id: admin.id } });
  });
});
