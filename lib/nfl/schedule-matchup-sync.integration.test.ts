import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { commitManualSchedule } from "@/lib/nfl/manual/schedule-import";
import {
  auditRepairWeekMatchups,
  summarizeMatchupSync,
} from "@/lib/nfl/week-matchup-repair";
import { resolveWeekStatusMatchup } from "@/lib/admin/week-status";
import { resolveWeekScopedGame } from "@/lib/timing/resolve-contest-kickoff";

const suffix = `sched-sync-${Date.now()}`;

const SCHEDULE_TWO = `
Away | Home | Kickoff
GB | MIN | 2099-09-14 12:00 CT
CHI | DET | 2099-09-14 12:00 CT
`;

const SCHEDULE_SWAPPED = `
Away | Home | Kickoff
MIN | GB | 2099-09-14 15:25 CT
DET | CHI | 2099-09-14 15:25 CT
`;

describe("schedule → matchup synchronization (integration)", () => {
  let seasonId = "";
  let weekId = "";
  let otherWeekId = "";
  let adminUserId = "";
  let profileId = "";
  let contestId = "";
  let entryMissingId = "";
  let entryLinkedId = "";
  let entryUnmatchedId = "";
  let otherWeekEntryId = "";
  let pickId = "";
  let submissionId = "";
  let availabilityId = "";
  let loveRankableId = "";
  let gameGbMinId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2099,
        sport: `TEST-SCHED-SYNC-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 3,
        label: `Week 3 ${suffix}`,
        startsAt: new Date("2099-09-14T00:00:00Z"),
        endsAt: new Date("2099-09-21T00:00:00Z"),
        status: "OPEN",
        isTest: true,
      },
    });
    weekId = week.id;

    const otherWeek = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 2,
        label: `Week 2 ${suffix}`,
        startsAt: new Date("2099-09-07T00:00:00Z"),
        endsAt: new Date("2099-09-14T00:00:00Z"),
        status: "COMPLETE",
        isTest: true,
      },
    });
    otherWeekId = otherWeek.id;

    const admin = await prisma.user.create({
      data: {
        email: `admin-${suffix}@example.com`,
        name: "Sched Sync Admin",
      },
    });
    adminUserId = admin.id;

    const profile = await prisma.universalProfile.create({
      data: {
        username: `sync-${suffix.slice(-10)}`,
        displayName: `Sched Sync ${suffix}`,
        profileType: "HUMAN",
      },
    });
    profileId = profile.id;

    const players = await Promise.all(
      [
        { name: "Jordan Love", team: "GB", externalId: `love-${suffix}` },
        { name: "Caleb Williams", team: "CHI", externalId: `caleb-${suffix}` },
        { name: "Bye Week QB", team: "PIT", externalId: `bye-${suffix}` },
        { name: "Other Week QB", team: "GB", externalId: `other-${suffix}` },
      ].map((row) =>
        prisma.rankableEntry.create({
          data: {
            provider: "manual",
            externalId: row.externalId,
            type: "PLAYER",
            name: row.name,
            shortName: row.name.split(" ").pop()!,
            team: row.team,
            position: "QB",
            opponent: "TBD",
            active: true,
          },
        }),
      ),
    );

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: `QB ${suffix}`,
        rankingDepth: 20,
        status: "DRAFT",
      },
    });
    contestId = contest.id;

    const otherContest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId: otherWeekId,
        position: "QB",
        title: `QB W2 ${suffix}`,
        rankingDepth: 20,
        status: "FINAL",
      },
    });

    const otherGame = await prisma.nflGame.create({
      data: {
        provider: "manual",
        externalId: `w2-gb-${suffix}`,
        seasonId,
        weekId: otherWeekId,
        seasonYear: 2099,
        weekNumber: 2,
        homeTeam: "GB",
        awayTeam: "CHI",
        startsAt: new Date("2099-09-07T17:00:00Z"),
        status: "FINAL",
      },
    });

    const [love, caleb, bye, other] = players;
    loveRankableId = love!.id;

    const entries = await Promise.all([
      prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: love!.id,
          weekTeam: "GB",
          excluded: false,
          gameId: null,
        },
      }),
      prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: caleb!.id,
          weekTeam: "CHI",
          excluded: false,
          gameId: null,
        },
      }),
      prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: bye!.id,
          weekTeam: "PIT",
          excluded: false,
          gameId: null,
        },
      }),
      prisma.contestEntry.create({
        data: {
          contestId: otherContest.id,
          rankableEntryId: other!.id,
          weekTeam: "GB",
          excluded: false,
          gameId: otherGame.id,
        },
      }),
    ]);

    entryMissingId = entries[0]!.id;
    entryLinkedId = entries[1]!.id;
    entryUnmatchedId = entries[2]!.id;
    otherWeekEntryId = entries[3]!.id;

    const submission = await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: profileId,
        status: "DRAFT",
      },
    });
    submissionId = submission.id;

    const pick = await prisma.rankingPick.create({
      data: {
        submissionId,
        rankableEntryId: love!.id,
        predictedRank: 1,
      },
    });
    pickId = pick.id;

    const avail = await prisma.playerWeekAvailability.create({
      data: {
        weekId,
        rankableEntryId: love!.id,
        designation: "AVAILABLE",
        sourceType: "MANUAL",
      },
    });
    availabilityId = avail.id;
  });

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({ where: { id: pickId } }).catch(() => {});
    await prisma.rankingSubmission
      .deleteMany({ where: { id: submissionId } })
      .catch(() => {});
    await prisma.playerWeekAvailability
      .deleteMany({ where: { id: availabilityId } })
      .catch(() => {});
    await prisma.contestEntry
      .deleteMany({
        where: {
          id: {
            in: [
              entryMissingId,
              entryLinkedId,
              entryUnmatchedId,
              otherWeekEntryId,
            ],
          },
        },
      })
      .catch(() => {});
    await prisma.rankIQContest
      .deleteMany({ where: { week: { seasonId } } })
      .catch(() => {});
    await prisma.nflGame.deleteMany({ where: { seasonId } }).catch(() => {});
    await prisma.manualImportLog
      .deleteMany({ where: { weekId: { in: [weekId, otherWeekId] } } })
      .catch(() => {});
    await prisma.week.deleteMany({ where: { seasonId } }).catch(() => {});
    await prisma.rankableEntry
      .deleteMany({ where: { externalId: { endsWith: suffix } } })
      .catch(() => {});
    await prisma.universalProfile
      .deleteMany({ where: { id: profileId } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: adminUserId } }).catch(() => {});
    await prisma.season.deleteMany({ where: { id: seasonId } }).catch(() => {});
  });

  it("Save Schedule stamps existing entries and leaves unmatched unguessed", async () => {
    const beforeCount = await prisma.contestEntry.count({
      where: { contestId },
    });
    const beforePick = await prisma.rankingPick.findUniqueOrThrow({
      where: { id: pickId },
    });
    const beforeSub = await prisma.rankingSubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    const beforeAvail = await prisma.playerWeekAvailability.findUniqueOrThrow({
      where: { id: availabilityId },
    });
    const beforeOther = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: otherWeekEntryId },
    });

    const result = await commitManualSchedule({
      weekId,
      text: SCHEDULE_TWO,
      adminUserId,
    });

    expect(result.games).toBe(2);
    expect(result.matchupSummary.totalEntries).toBe(3);
    expect(result.matchupSummary.updated).toBe(2);
    expect(result.matchupSummary.unmatched).toBe(1);
    expect(result.matchupSummary.ambiguous).toBe(0);
    expect(result.operatorMessage).toContain("2/3 pool matchups synchronized");
    expect(result.operatorMessage).toContain("1 entries need attention");

    const gb = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryMissingId },
      include: { game: true },
    });
    const chi = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryLinkedId },
      include: { game: true },
    });
    const pit = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryUnmatchedId },
    });

    expect(gb.gameId).toBeTruthy();
    expect(gb.game?.awayTeam).toBe("GB");
    expect(gb.game?.homeTeam).toBe("MIN");
    expect(chi.gameId).toBeTruthy();
    expect(chi.game?.awayTeam).toBe("CHI");
    expect(pit.gameId).toBeNull();

    gameGbMinId = gb.gameId!;

    const matchup = resolveWeekStatusMatchup({
      weekId,
      team: "GB",
      contestGame: gb.game,
    });
    expect(matchup.matchupMissing).toBe(false);
    expect(matchup.opponent).toBe("@ MIN");
    expect(
      resolveWeekScopedGame({ weekId, contestGame: gb.game }),
    ).not.toBeNull();

    expect(
      await prisma.contestEntry.count({ where: { contestId } }),
    ).toBe(beforeCount);

    const afterPick = await prisma.rankingPick.findUniqueOrThrow({
      where: { id: pickId },
    });
    expect(afterPick.predictedRank).toBe(beforePick.predictedRank);
    expect(afterPick.rankableEntryId).toBe(beforePick.rankableEntryId);

    const afterSub = await prisma.rankingSubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    expect(afterSub.status).toBe(beforeSub.status);
    expect(afterSub.updatedAt.getTime()).toBe(beforeSub.updatedAt.getTime());

    const afterAvail = await prisma.playerWeekAvailability.findUniqueOrThrow({
      where: { id: availabilityId },
    });
    expect(afterAvail.designation).toBe(beforeAvail.designation);
    expect(afterAvail.updatedAt.getTime()).toBe(beforeAvail.updatedAt.getTime());

    const afterOther = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: otherWeekEntryId },
    });
    expect(afterOther.gameId).toBe(beforeOther.gameId);
  });

  it("idempotent Sync Matchups leaves correct links and reports unmatched", async () => {
    const dry = await auditRepairWeekMatchups({
      weekId,
      apply: false,
      respectLifecycle: true,
    });
    const drySummary = summarizeMatchupSync({ report: dry });
    expect(drySummary.alreadyCorrect).toBeGreaterThanOrEqual(2);
    expect(drySummary.unmatched).toBe(1);
    expect(drySummary.writable).toBe(0);

    const applied = await auditRepairWeekMatchups({
      weekId,
      apply: true,
      respectLifecycle: true,
    });
    expect(applied.counts.updated).toBe(0);
    expect(applied.counts.unmatched).toBe(1);

    const pit = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryUnmatchedId },
    });
    expect(pit.gameId).toBeNull();
  });

  it("corrects stale same-week gameId when schedule changes", async () => {
    await prisma.contestEntry.update({
      where: { id: entryLinkedId },
      data: { gameId: gameGbMinId },
    });

    const result = await commitManualSchedule({
      weekId,
      text: SCHEDULE_SWAPPED,
      adminUserId,
    });

    expect(result.matchupSummary.updated).toBeGreaterThanOrEqual(1);
    const chi = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryLinkedId },
      include: { game: true },
    });
    expect(chi.game?.homeTeam).toBe("CHI");
    expect(chi.game?.awayTeam).toBe("DET");
    expect(chi.gameId).not.toBe(gameGbMinId);

    const pit = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryUnmatchedId },
    });
    expect(pit.gameId).toBeNull();
  });

  it("skips matchup writes when week is LOCKED", async () => {
    await prisma.week.update({
      where: { id: weekId },
      data: { status: "LOCKED" },
    });

    const before = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryMissingId },
    });

    const report = await auditRepairWeekMatchups({
      weekId,
      apply: true,
      respectLifecycle: true,
    });
    expect(report.skippedDueToLifecycle).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.counts.updated).toBe(0);

    const after = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryMissingId },
    });
    expect(after.gameId).toBe(before.gameId);

    await prisma.week.update({
      where: { id: weekId },
      data: { status: "OPEN" },
    });
  });

  it("does not introduce cross-week fallback for Availability", async () => {
    const pit = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryUnmatchedId },
      include: { game: true },
    });
    await prisma.rankableEntry.update({
      where: { id: loveRankableId },
      data: {
        opponent: "vs CLE",
        gameStartsAt: new Date("2099-09-07T17:00:00Z"),
      },
    });

    const matchup = resolveWeekStatusMatchup({
      weekId,
      team: "PIT",
      contestGame: pit.game,
    });
    expect(matchup.matchupMissing).toBe(true);
    expect(matchup.opponent).toBe("MISSING");
    expect(matchup.kickoffAt).toBeNull();
  });

  it("OPEN weeks allow sync writes; COMPLETE blocks them", async () => {
    await prisma.contestEntry.update({
      where: { id: entryMissingId },
      data: { gameId: null },
    });
    await prisma.week.update({
      where: { id: weekId },
      data: { status: "OPEN" },
    });

    const openReport = await auditRepairWeekMatchups({
      weekId,
      apply: true,
      respectLifecycle: true,
    });
    expect(openReport.skippedDueToLifecycle).toBe(false);
    expect(openReport.counts.updated).toBeGreaterThanOrEqual(1);

    const gb = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entryMissingId },
    });
    expect(gb.gameId).toBeTruthy();

    await prisma.week.update({
      where: { id: weekId },
      data: { status: "COMPLETE" },
    });
    await prisma.contestEntry.update({
      where: { id: entryMissingId },
      data: { gameId: null },
    });

    const completeReport = await auditRepairWeekMatchups({
      weekId,
      apply: true,
      respectLifecycle: true,
    });
    expect(completeReport.skippedDueToLifecycle).toBe(true);
    expect(completeReport.counts.updated).toBe(0);

    await prisma.week.update({
      where: { id: weekId },
      data: { status: "OPEN" },
    });
  });
});
