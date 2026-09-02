import { prisma } from "@/lib/db";
import { ensureFivePositionContests } from "@/lib/admin/weeks";
import { listActiveAiCompetitors } from "@/lib/ai-competitors-sync";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";
import { createNflDataProvider } from "@/lib/providers/nfl";
import { commitWeeklyImport } from "@/lib/nfl/import";
import { buildRankIqPositionPools } from "@/lib/nfl/pool-builder";
import { commitWeekResults } from "@/lib/nfl/results-import";
import { calculateActualFinishesForWeek } from "@/lib/nfl/actual-finishes";
import { gradeContest } from "@/lib/grading";
import { submitRanking } from "@/lib/submissions";

export const TEST_SPORT = "NFL-TEST";

export class HistoricalTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalTestError";
  }
}

export async function ensureHistoricalTestSeason(year: number) {
  const existing = await prisma.season.findUnique({
    where: { year_sport: { year, sport: TEST_SPORT } },
  });
  if (existing) return existing;
  return prisma.season.create({
    data: {
      year,
      sport: TEST_SPORT,
      active: false,
    },
  });
}

export async function ensureHistoricalTestWeek(input: {
  year: number;
  weekNumber: number;
}) {
  if (!Number.isInteger(input.weekNumber) || input.weekNumber < 1) {
    throw new HistoricalTestError("Week number must be a positive integer");
  }
  const season = await ensureHistoricalTestSeason(input.year);
  const existing = await prisma.week.findUnique({
    where: {
      seasonId_weekNumber: {
        seasonId: season.id,
        weekNumber: input.weekNumber,
      },
    },
  });
  if (existing) {
    if (!existing.isTest) {
      return prisma.week.update({
        where: { id: existing.id },
        data: {
          isTest: true,
          label: existing.label.startsWith("[TEST]")
            ? existing.label
            : `[TEST] ${existing.label}`,
        },
      });
    }
    return existing;
  }

  const timing = computeNflTimingWindows(
    new Date(Date.UTC(input.year, 8, 1 + (input.weekNumber - 1) * 7)),
    new Date(Date.UTC(input.year, 8, 7 + (input.weekNumber - 1) * 7)),
  );

  return prisma.week.create({
    data: {
      seasonId: season.id,
      weekNumber: input.weekNumber,
      label: `[TEST] ${input.year} Week ${input.weekNumber}`,
      startsAt: timing.rankingsOpenAt,
      endsAt: timing.publicReleaseAt,
      status: "OPEN",
      isTest: true,
      rankingsOpenAt: timing.rankingsOpenAt,
      fullLockAt: timing.fullLockAt,
      revealStartsAt: timing.revealStartsAt,
      publicReleaseAt: timing.publicReleaseAt,
    },
  });
}

export async function runHistoricalTestStep(input: {
  weekId: string;
  step:
    | "schedule"
    | "pool"
    | "contests"
    | "stats"
    | "finishes"
    | "seed_bots"
    | "grade";
}) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true, contests: true },
  });
  if (!week.isTest) {
    throw new HistoricalTestError("Refusing to run historical test steps on a live week");
  }

  const provider = createNflDataProvider();

  switch (input.step) {
    case "schedule": {
      const games = await provider.getWeekSchedule(
        week.season.year,
        week.weekNumber,
      );
      if (games.length === 0) {
        throw new HistoricalTestError("No games returned for that historical week");
      }
      const starts = games.map((game) => game.startsAt.getTime());
      const startsAt = new Date(Math.min(...starts));
      const endsAt = new Date(Math.max(...starts) + 5 * 60 * 60 * 1000);
      const timing = computeNflTimingWindows(startsAt, endsAt);
      await prisma.week.update({
        where: { id: week.id },
        data: {
          startsAt,
          endsAt,
          rankingsOpenAt: timing.rankingsOpenAt,
          fullLockAt: timing.fullLockAt,
          revealStartsAt: timing.revealStartsAt,
          publicReleaseAt: timing.publicReleaseAt,
          isTest: true,
          label: week.label.startsWith("[TEST]")
            ? week.label
            : `[TEST] ${week.season.year} Week ${week.weekNumber}`,
        },
      });
      await commitWeeklyImport({
        seasonId: week.seasonId,
        weekId: week.id,
        seasonYear: week.season.year,
        weekNumber: week.weekNumber,
        provider,
      });
      return { ok: true as const, step: input.step };
    }
    case "pool": {
      await buildRankIqPositionPools({ weekId: week.id, provider });
      return { ok: true as const, step: input.step };
    }
    case "contests": {
      const result = await ensureFivePositionContests(week.id);
      return { ok: true as const, step: input.step, result };
    }
    case "stats": {
      await commitWeekResults({ weekId: week.id, provider });
      return { ok: true as const, step: input.step };
    }
    case "finishes": {
      const result = await calculateActualFinishesForWeek(week.id);
      return { ok: true as const, step: input.step, result };
    }
    case "seed_bots": {
      const bots = await listActiveAiCompetitors();
      const contests = await prisma.rankIQContest.findMany({
        where: { weekId: week.id },
        include: { entries: { where: { excluded: false } } },
      });
      let seeded = 0;
      for (const contest of contests) {
        const entryIds = contest.entries
          .slice(0, contest.rankingDepth)
          .map((entry) => entry.rankableEntryId);
        if (entryIds.length < contest.rankingDepth) continue;
        for (const bot of bots) {
          try {
            await submitRanking({
              contestId: contest.id,
              universalProfileId: bot.id,
              rankedEntryIds: entryIds,
            });
            seeded += 1;
          } catch {
            // already submitted or contest not open
          }
        }
      }
      return { ok: true as const, step: input.step, seeded };
    }
    case "grade": {
      const contests = await prisma.rankIQContest.findMany({
        where: { weekId: week.id },
      });
      for (const contest of contests) {
        await gradeContest(contest.id);
      }
      await prisma.week.update({
        where: { id: week.id },
        data: { status: "COMPLETE" },
      });
      return { ok: true as const, step: input.step, graded: contests.length };
    }
    default:
      throw new HistoricalTestError("Unknown historical test step");
  }
}

export async function listHistoricalTestWeeks() {
  return prisma.week.findMany({
    where: { isTest: true },
    include: {
      season: true,
      contests: { select: { id: true, position: true, status: true } },
    },
    orderBy: [{ season: { year: "desc" } }, { weekNumber: "desc" }],
  });
}
