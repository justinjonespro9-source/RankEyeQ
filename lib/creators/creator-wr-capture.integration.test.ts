import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureBenchmarkSnapshot } from "@/lib/benchmarks/snapshots";
import { extractTopNFromPastedText } from "@/lib/benchmarks/parser";
import { createCreatorCompetitor } from "@/lib/creator-identity";
import { getCreatorRankingCoverage } from "@/lib/creators/coverage";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `cwr${Date.now().toString(36)}`;

describe("new Creator WR Top 15 capture + idempotent retry", () => {
  let seasonId = "";
  let weekId = "";
  let wrContestId = "";
  let rbContestId = "";
  let adminUserId = "";
  let creatorId = "";
  let wrEntryIds: string[] = [];
  let rbEntryIds: string[] = [];

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2098,
        sport: `CWR-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Creator WR Test Week",
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

    const admin = await prisma.user.create({
      data: {
        email: `cwr-admin-${suffix}@rankiq.local`,
        role: "ADMIN",
        emailVerified: new Date(),
        name: "Creator WR Admin",
      },
    });
    adminUserId = admin.id;

    const creator = await createCreatorCompetitor({
      personName: `WR Creator ${suffix}`,
      brandName: "WR Channel",
      username: `wr_creator_${suffix.slice(-8)}`,
    });
    creatorId = creator.id;

    wrEntryIds = [];
    for (let i = 1; i <= 18; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `cwr-wr-${suffix}-${i}`,
          type: "PLAYER",
          name: `Creator WR ${i}`,
          shortName: `CWR${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "WR",
          gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        },
      });
      await prisma.contestEntry.create({
        data: { contestId: wrContestId, rankableEntryId: entry.id },
      });
      wrEntryIds.push(entry.id);
    }

    rbEntryIds = [];
    for (let i = 1; i <= 12; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `cwr-rb-${suffix}-${i}`,
          type: "PLAYER",
          name: `Creator RB ${i}`,
          shortName: `CRB${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "RB",
          gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        },
      });
      await prisma.contestEntry.create({
        data: { contestId: rbContestId, rankableEntryId: entry.id },
      });
      rbEntryIds.push(entry.id);
    }
  });

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.benchmarkSnapshotPick.deleteMany({
      where: { snapshot: { weekId } },
    });
    await prisma.benchmarkSnapshot.deleteMany({ where: { weekId } });
    await prisma.contestEntry.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.rankableEntry.deleteMany({
      where: {
        provider: "test",
        externalId: { startsWith: `cwr-` },
      },
    });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.week.delete({ where: { id: weekId } });
    await prisma.season.delete({ where: { id: seasonId } });
    await prisma.creatorCompetitorProfile
      .deleteMany({
        where: { universalProfileId: creatorId },
      })
      .catch(() => undefined);
    await prisma.universalProfile.delete({ where: { id: creatorId } }).catch(
      () => undefined,
    );
    await prisma.user.delete({ where: { id: adminUserId } }).catch(
      () => undefined,
    );
  });

  it("new Creator has CREATOR identity and appears in WR matrix", async () => {
    const row = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: creatorId },
      include: { creatorCompetitor: true },
    });
    expect(row.profileType).toBe("CREATOR");
    expect(row.competitorActive).toBe(true);
    expect(row.creatorCompetitor?.claimStatus).toBe("UNCLAIMED");

    const coverage = await getCreatorRankingCoverage(weekId);
    const found = coverage.rows.find((item) => item.profileId === creatorId);
    expect(found).toBeTruthy();
    expect(found?.cells.WR).toBe("Not imported");
    expect(found?.cells.RB).toBe("Not imported");
  });

  it("submits new Creator RB Top 10 then WR Top 15", async () => {
    const rbPicks = rbEntryIds.slice(0, 10).map((id, index) => ({
      sourceRank: index + 1,
      rawName: `Creator RB ${index + 1}`,
      rankableEntryId: id,
      rankIqRank: index + 1,
      excluded: false,
      exclusionReason: null,
      issue: null,
      selected: true,
    }));
    const rb = await captureBenchmarkSnapshot({
      contestId: rbContestId,
      universalProfileId: creatorId,
      adminUserId,
      captureType: "SUNDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 12, 12, 0),
      sourceUrl: "https://example.com/rb",
      sourcePublishedAt: zonedLocalToUtc(2026, 9, 12, 10, 0),
      rawText: rbPicks.map((p) => `${p.sourceRank}. ${p.rawName}`).join("\n"),
      picks: rbPicks,
      commitOfficial: true,
    });
    expect(rb.official).toBe(true);
    expect(rb.snapshot.status).toBe("LOCKED");

    const wrPaste = wrEntryIds
      .slice(0, 15)
      .map((_, index) => `${index + 1}. Creator WR ${index + 1}`)
      .join("\n");
    const eligible = wrEntryIds.slice(0, 18).map((id, index) => ({
      id,
      name: `Creator WR ${index + 1}`,
      team: "TST",
      shortName: `CWR${index + 1}`,
    }));
    const extracted = extractTopNFromPastedText({
      text: wrPaste,
      eligible,
      rankingDepth: 15,
    });
    expect(extracted.ready).toBe(true);
    expect(extracted.selected).toHaveLength(15);

    const wr = await captureBenchmarkSnapshot({
      contestId: wrContestId,
      universalProfileId: creatorId,
      adminUserId,
      captureType: "SUNDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 12, 12, 5),
      sourceUrl: "https://example.com/wr",
      sourcePublishedAt: zonedLocalToUtc(2026, 9, 12, 10, 5),
      rawText: wrPaste,
      picks: extracted.rows.map((row) => ({
        sourceRank: row.sourceRank,
        rawName: row.rawName,
        rankableEntryId: row.matchedEntryId,
        rankIqRank: row.rankIqRank,
        excluded: row.excluded,
        exclusionReason: row.exclusionReason,
        issue: row.issue,
        selected: row.selected,
      })),
      commitOfficial: true,
    });
    expect(wr.official).toBe(true);
    expect(wr.snapshot.picks.filter((p) => p.selected)).toHaveLength(15);

    const submission = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId: wrContestId,
          universalProfileId: creatorId,
        },
      },
      include: { picks: true },
    });
    expect(submission.status).toBe("LOCKED");
    expect(submission.picks).toHaveLength(15);
  });

  it("retries converge without duplicate snapshot/submission/picks", async () => {
    const wrPaste = wrEntryIds
      .slice(0, 15)
      .map((_, index) => `${index + 1}. Creator WR ${index + 1}`)
      .join("\n");
    const picks = wrEntryIds.slice(0, 15).map((id, index) => ({
      sourceRank: index + 1,
      rawName: `Creator WR ${index + 1}`,
      rankableEntryId: id,
      rankIqRank: index + 1,
      excluded: false,
      exclusionReason: null,
      issue: null,
      selected: true,
    }));

    const first = await captureBenchmarkSnapshot({
      contestId: wrContestId,
      universalProfileId: creatorId,
      adminUserId,
      captureType: "SUNDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 12, 13, 0),
      sourceUrl: "https://example.com/wr-retry",
      rawText: wrPaste,
      picks,
      commitOfficial: true,
    });
    const second = await captureBenchmarkSnapshot({
      contestId: wrContestId,
      universalProfileId: creatorId,
      adminUserId,
      captureType: "SUNDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 12, 13, 1),
      sourceUrl: "https://example.com/wr-retry",
      rawText: wrPaste,
      picks,
      commitOfficial: true,
    });

    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(second.official).toBe(true);

    const snapshots = await prisma.benchmarkSnapshot.findMany({
      where: {
        contestId: wrContestId,
        universalProfileId: creatorId,
        captureType: "SUNDAY",
        correctionOfId: null,
      },
    });
    expect(snapshots).toHaveLength(1);

    const submissions = await prisma.rankingSubmission.findMany({
      where: {
        contestId: wrContestId,
        universalProfileId: creatorId,
      },
      include: { picks: true },
    });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.picks).toHaveLength(15);

    const pickCount = await prisma.rankingPick.count({
      where: { submissionId: submissions[0]!.id },
    });
    expect(pickCount).toBe(15);
  });

  it("rejects WR contest configured as Top 10", async () => {
    await prisma.rankIQContest.update({
      where: { id: wrContestId },
      data: { rankingDepth: 10 },
    });

    await expect(
      captureBenchmarkSnapshot({
        contestId: wrContestId,
        universalProfileId: creatorId,
        adminUserId,
        captureType: "SUNDAY",
        capturedAt: zonedLocalToUtc(2026, 9, 12, 14, 0),
        picks: wrEntryIds.slice(0, 10).map((id, index) => ({
          sourceRank: index + 1,
          rawName: `Creator WR ${index + 1}`,
          rankableEntryId: id,
          rankIqRank: index + 1,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        })),
      }),
    ).rejects.toThrow(/WR contest must use Top 15/);

    await prisma.rankIQContest.update({
      where: { id: wrContestId },
      data: { rankingDepth: 15 },
    });
  });
});
