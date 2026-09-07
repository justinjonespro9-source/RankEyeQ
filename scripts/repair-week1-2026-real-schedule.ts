/**
 * In-place repair: replace mock Week 1 2026 NflGames with the real NFL schedule.
 * Preserves Week + Contest IDs + RankingSubmissions.
 *
 *   npx tsx scripts/repair-week1-2026-real-schedule.ts
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { commitManualSchedule } from "../lib/nfl/manual/schedule-import";
import { autoSyncWeeklyEligibilityForWeek } from "../lib/nfl/weekly-auto-sync";
import { auditAllPools } from "../lib/nfl/manual/pool-audit";
import { getWeekTimingState } from "../lib/timing/week-windows";
import { parseWeeklySchedulePaste } from "../lib/nfl/manual/parse-schedule";
import { normalizeTeamAbbr } from "../lib/nfl/manual/parse-common";

/**
 * Official 2026 Week 1 slate (NFL Football Operations / NFL.com).
 * Kickoffs entered as America/Chicago local (ET − 1h during CDT).
 */
export const WEEK1_2026_REAL_SCHEDULE = `Away | Home | Kickoff
NE | SEA | 2026-09-09 19:20 CT
SF | LAR | 2026-09-10 19:35 CT
CHI | CAR | 2026-09-13 12:00 CT
TB | CIN | 2026-09-13 12:00 CT
NO | DET | 2026-09-13 12:00 CT
BUF | HOU | 2026-09-13 12:00 CT
BAL | IND | 2026-09-13 12:00 CT
CLE | JAX | 2026-09-13 12:00 CT
ATL | PIT | 2026-09-13 12:00 CT
NYJ | TEN | 2026-09-13 12:00 CT
ARI | LAC | 2026-09-13 15:25 CT
MIA | LV | 2026-09-13 15:25 CT
GB | MIN | 2026-09-13 15:25 CT
WAS | PHI | 2026-09-13 15:25 CT
DAL | NYG | 2026-09-13 19:20 CT
DEN | KC | 2026-09-14 19:15 CT`;

const EXPECTED_FULL_LOCK = "2026-09-13T15:00:00.000Z";
const EXPECTED_PUBLIC = "2026-09-13T17:00:00.000Z";

async function main() {
  const parsed = parseWeeklySchedulePaste(WEEK1_2026_REAL_SCHEDULE);
  if (!parsed.ready) {
    console.error("Schedule paste invalid:", parsed.blockers);
    process.exit(1);
  }

  const week = await prisma.week.findFirst({
    where: { season: { year: 2026, sport: "NFL", active: true }, weekNumber: 1, isTest: false },
    include: {
      contests: { select: { id: true, position: true, status: true } },
      season: true,
    },
  });
  if (!week) {
    console.error("Active 2026 NFL Week 1 not found");
    process.exit(1);
  }

  const contestIdsBefore = week.contests.map((c) => c.id).sort();
  const contestStatusBefore = Object.fromEntries(
    week.contests.map((c) => [c.position, c.status]),
  );

  const submissionsBefore = await prisma.rankingSubmission.findMany({
    where: { contestId: { in: contestIdsBefore } },
    include: {
      universalProfile: { select: { profileType: true, username: true } },
      picks: {
        include: {
          rankableEntry: {
            select: {
              id: true,
              name: true,
              team: true,
              opponent: true,
              gameStartsAt: true,
            },
          },
        },
        orderBy: { predictedRank: "asc" },
      },
    },
  });

  const pickSnapshot = new Map<
    string,
    { entryId: string; team: string; opponent: string | null; kickoff: string | null }
  >();
  for (const sub of submissionsBefore) {
    for (const pick of sub.picks) {
      pickSnapshot.set(`${sub.id}:${pick.predictedRank}`, {
        entryId: pick.rankableEntryId,
        team: pick.rankableEntry.team,
        opponent: pick.rankableEntry.opponent,
        kickoff: pick.rankableEntry.gameStartsAt?.toISOString() ?? null,
      });
    }
  }

  const admin =
    (await prisma.user.findFirst({ where: { role: "ADMIN" } })) ??
    (await prisma.user.findFirst());
  if (!admin) {
    console.error("No admin user for ManualImportLog");
    process.exit(1);
  }

  console.log("=== BEFORE ===");
  console.log({
    weekId: week.id,
    contests: contestStatusBefore,
    contestIds: contestIdsBefore,
    submissions: submissionsBefore.length,
    humanSubmitted: submissionsBefore.filter(
      (s) =>
        s.universalProfile.profileType === "HUMAN" &&
        (s.status === "SUBMITTED" || s.status === "LOCKED"),
    ).length,
  });

  // 1) Upsert real games, drop mock orphans, recompute week timing
  const commit = await commitManualSchedule({
    weekId: week.id,
    text: WEEK1_2026_REAL_SCHEDULE,
    adminUserId: admin.id,
    recomputeWeekTiming: true,
    replaceOrphanGames: true,
  });
  console.log("commitManualSchedule:", commit);

  // Keep contests OPEN (timing update only touches opensAt/locksAt on DRAFT/OPEN)
  await prisma.rankIQContest.updateMany({
    where: { weekId: week.id },
    data: { status: "OPEN" },
  });

  // Schedule-derived open is Tue Sept 8; restore Sept 1 so pregame imports work before Wed.
  const { updateWeekTiming } = await import("../lib/admin/weeks");
  const { zonedLocalToUtc } = await import("../lib/timing/chicago");
  await updateWeekTiming({
    weekId: week.id,
    rankingsOpenAt: zonedLocalToUtc(2026, 9, 1, 0, 0),
  });

  // 2) Relink ContestEntry.gameId + restamp opponent / gameStartsAt
  const sync = await autoSyncWeeklyEligibilityForWeek(week.id);
  console.log("autoSync:", sync.skipped ? "SKIPPED" : sync.byPosition);

  // 4) Audit pools
  const audits = await auditAllPools(week.id);

  // 5) Verify
  const after = await prisma.week.findUniqueOrThrow({
    where: { id: week.id },
    include: {
      contests: { select: { id: true, position: true, status: true, locksAt: true } },
      games: {
        orderBy: { startsAt: "asc" },
        select: {
          awayTeam: true,
          homeTeam: true,
          startsAt: true,
          externalId: true,
        },
      },
    },
  });

  const contestIdsAfter = after.contests.map((c) => c.id).sort();
  const teams = new Set<string>();
  for (const g of after.games) {
    teams.add(normalizeTeamAbbr(g.awayTeam));
    teams.add(normalizeTeamAbbr(g.homeTeam));
  }

  const now = new Date();
  const timing = getWeekTimingState({
    rankingsOpenAt: after.rankingsOpenAt,
    fullLockAt: after.fullLockAt,
    revealStartsAt: after.revealStartsAt,
    publicReleaseAt: after.publicReleaseAt,
    weekStatus: after.status,
    now,
  });

  const submissionsAfter = await prisma.rankingSubmission.findMany({
    where: { contestId: { in: contestIdsAfter } },
    include: {
      universalProfile: { select: { profileType: true, username: true } },
      picks: {
        include: {
          rankableEntry: {
            select: {
              id: true,
              name: true,
              team: true,
              opponent: true,
              gameStartsAt: true,
            },
          },
        },
        orderBy: { predictedRank: "asc" },
      },
    },
  });

  let pickIdDrift = 0;
  let metadataChanges = 0;
  const humanImpact: Array<{
    username: string;
    contestId: string;
    status: string;
    pickCount: number;
    opponentOrKickoffChanges: number;
    sample: Array<{ name: string; before: string; after: string }>;
  }> = [];

  for (const sub of submissionsAfter) {
    let subMeta = 0;
    const samples: Array<{ name: string; before: string; after: string }> = [];
    for (const pick of sub.picks) {
      const key = `${sub.id}:${pick.predictedRank}`;
      const before = pickSnapshot.get(key);
      if (!before) {
        pickIdDrift += 1;
        continue;
      }
      if (before.entryId !== pick.rankableEntryId) {
        pickIdDrift += 1;
        continue;
      }
      const afterKick = pick.rankableEntry.gameStartsAt?.toISOString() ?? null;
      const oppChanged = before.opponent !== pick.rankableEntry.opponent;
      const kickChanged = before.kickoff !== afterKick;
      if (oppChanged || kickChanged) {
        metadataChanges += 1;
        subMeta += 1;
        if (samples.length < 5) {
          samples.push({
            name: pick.rankableEntry.name,
            before: `${before.opponent ?? "?"} @ ${before.kickoff ?? "?"}`,
            after: `${pick.rankableEntry.opponent ?? "?"} @ ${afterKick ?? "?"}`,
          });
        }
      }
    }
    if (sub.universalProfile.profileType === "HUMAN") {
      humanImpact.push({
        username: sub.universalProfile.username,
        contestId: sub.contestId,
        status: sub.status,
        pickCount: sub.picks.length,
        opponentOrKickoffChanges: subMeta,
        sample: samples,
      });
    }
  }

  const entriesMissingGame = await prisma.contestEntry.count({
    where: {
      contestId: { in: contestIdsAfter },
      excluded: false,
      gameId: null,
    },
  });

  const report = {
    weekId: after.id,
    contestIdsPreserved: contestIdsBefore.join() === contestIdsAfter.join(),
    contestsOpen: after.contests.every((c) => c.status === "OPEN"),
    gameCount: after.games.length,
    teamCount: teams.size,
    games: after.games.map(
      (g) => `${g.awayTeam}@${g.homeTeam} ${g.startsAt.toISOString()}`,
    ),
    rankingsOpenAt: after.rankingsOpenAt?.toISOString() ?? null,
    fullLockAt: after.fullLockAt?.toISOString() ?? null,
    revealStartsAt: after.revealStartsAt?.toISOString() ?? null,
    publicReleaseAt: after.publicReleaseAt?.toISOString() ?? null,
    fullLockOk: after.fullLockAt?.toISOString() === EXPECTED_FULL_LOCK,
    publicReleaseOk: after.publicReleaseAt?.toISOString() === EXPECTED_PUBLIC,
    revealOk: after.revealStartsAt?.toISOString() === EXPECTED_FULL_LOCK,
    canEditUnlocked: timing.canEditUnlocked,
    phase: timing.phase,
    submissionCountBefore: submissionsBefore.length,
    submissionCountAfter: submissionsAfter.length,
    pickIdentityDrift: pickIdDrift,
    pickMetadataChanges: metadataChanges,
    eligibleEntriesMissingGameId: entriesMissingGame,
    poolAudits: audits.audits.map((a) => ({
      position: a.position,
      eligible: a.eligibleCount,
      withOpponent: a.withOpponent,
      withKickoff: a.withKickoff,
      ready: a.ready,
      blockers: a.blockers.slice(0, 3),
    })),
    humanImpact,
  };

  console.log("=== AFTER ===");
  console.log(JSON.stringify(report, null, 2));

  const ok =
    report.contestIdsPreserved &&
    report.contestsOpen &&
    report.gameCount === 16 &&
    report.teamCount === 32 &&
    report.fullLockOk &&
    report.publicReleaseOk &&
    report.revealOk &&
    report.pickIdentityDrift === 0 &&
    report.submissionCountBefore === report.submissionCountAfter;

  if (!ok) {
    console.error("VERIFICATION FAILED");
    process.exitCode = 1;
  } else {
    console.log("VERIFICATION PASSED");
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
