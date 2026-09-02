import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logAdminAction } from "@/lib/admin/audit";
import { searchAdminUsers, setProfileStatus } from "@/lib/admin/users";
import {
  createWeek,
  ensureFivePositionContests,
  WeekSetupError,
} from "@/lib/admin/weeks";
import { prisma } from "@/lib/db";
import {
  saveSubmissionPicks,
  submitRanking,
  SubmissionError,
} from "@/lib/submissions";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `adm${Date.now()}`;

describe("admin command-center workflow", () => {
  let seasonId = "";
  let weekId = "";
  let adminUserId = "";
  let humanId = "";
  let botId = "";
  let contestId = "";
  let entryIds: string[] = [];

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2097,
        sport: `ADM-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const admin = await prisma.user.create({
      data: {
        email: `admin-${suffix}@example.com`,
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;

    const human = await prisma.universalProfile.create({
      data: {
        username: `adm-human-${suffix}`,
        displayName: "Admin Human",
        profileType: "HUMAN",
      },
    });
    humanId = human.id;

    const bot = await prisma.universalProfile.create({
      data: {
        username: `adm-bot-${suffix}`,
        displayName: "Admin Bot",
        profileType: "AI",
      },
    });
    botId = bot.id;
  });

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.contestEntry.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    if (weekId) await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [humanId, botId] } },
    });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: `adm-${suffix}-` } },
    });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.$disconnect();
  });

  it("prevents duplicate week numbers and bulk-creates five contests", async () => {
    const week = await createWeek({
      seasonId,
      weekNumber: 3,
      label: "Admin Week 3",
      startsAt: zonedLocalToUtc(2026, 9, 10, 19, 15),
      endsAt: zonedLocalToUtc(2026, 9, 14, 23, 0),
      status: "OPEN",
    });
    weekId = week.id;
    expect(week.rankingsOpenAt).toBeTruthy();
    expect(week.fullLockAt).toBeTruthy();

    await expect(
      createWeek({
        seasonId,
        weekNumber: 3,
        startsAt: zonedLocalToUtc(2026, 9, 17, 19, 15),
        endsAt: zonedLocalToUtc(2026, 9, 21, 23, 0),
      }),
    ).rejects.toBeInstanceOf(WeekSetupError);

    const first = await ensureFivePositionContests(weekId);
    expect(first.created).toHaveLength(5);
    const second = await ensureFivePositionContests(weekId);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(5);

    const rb = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId, position: "RB" } },
    });
    contestId = rb.id;
    expect(rb.rankingDepth).toBe(10);
    expect(rb.title).toBe("RB Top 10");
  });

  it("lets admin submit a bot board on the existing submission path", async () => {
    entryIds = [];
    for (let i = 1; i <= 12; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `adm-${suffix}-${i}`,
          type: "PLAYER",
          name: `Back ${i}`,
          shortName: `B${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "RB",
        },
      });
      await prisma.contestEntry.create({
        data: { contestId, rankableEntryId: entry.id },
      });
      entryIds.push(entry.id);
    }

    const submitted = await submitRanking({
      contestId,
      universalProfileId: botId,
      rankedEntryIds: entryIds.slice(0, 10),
      now: zonedLocalToUtc(2026, 9, 9, 12, 0),
    });
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.universalProfileId).toBe(botId);
    expect(submitted.picks).toHaveLength(10);
  });

  it("searches admin users and records audit actions", async () => {
    const rows = await searchAdminUsers({ query: `adm-bot-${suffix}` });
    expect(rows.some((row) => row.profileId === botId)).toBe(true);
    expect(rows.find((row) => row.profileId === botId)?.profileType).toBe("AI");

    await logAdminAction({
      adminUserId,
      action: "ai.board_submitted",
      entityType: "RankIQContest",
      entityId: contestId,
      metadata: { profileId: botId },
    });
    const logs = await prisma.adminAuditLog.findMany({
      where: { adminUserId, action: "ai.board_submitted" },
    });
    expect(logs.length).toBeGreaterThan(0);
  });

  it("blocks suspended users from submitting while preserving history", async () => {
    const beforeKickoff = zonedLocalToUtc(2026, 9, 9, 12, 0);
    await submitRanking({
      contestId,
      universalProfileId: humanId,
      rankedEntryIds: [...entryIds.slice(1, 11)],
      now: beforeKickoff,
    });
    await prisma.rankingSubmission.update({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: humanId,
        },
      },
      data: { status: "GRADED", normalizedScore: 77.7, rawScore: 200 },
    });

    await setProfileStatus({ profileId: humanId, status: "SUSPENDED" });

    await expect(
      saveSubmissionPicks({
        contestId,
        universalProfileId: humanId,
        rankedEntryIds: entryIds.slice(0, 10),
        now: beforeKickoff,
      }),
    ).rejects.toBeInstanceOf(SubmissionError);

    const preserved = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: humanId,
        },
      },
      include: { picks: true },
    });
    expect(preserved.status).toBe("GRADED");
    expect(preserved.normalizedScore).toBe(77.7);
    expect(preserved.picks).toHaveLength(10);
  });
});
