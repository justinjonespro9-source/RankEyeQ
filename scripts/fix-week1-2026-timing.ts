/**
 * One-shot correction: Week 1 2026 slate was anchored ~1 week early.
 * Shifts NflGame + contest RankableEntry kickoffs, then recomputes week timing.
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import {
  applyWeekTimingFromSchedule,
  updateWeekTiming,
} from "../lib/admin/weeks";
import {
  computeNflTimingWindows,
  getWeekTimingState,
} from "../lib/timing/week-windows";
import { zonedLocalToUtc } from "../lib/timing/chicago";

/** Wed Sept 9, 2026 8:20 PM ET */
const TARGET_FIRST_KICKOFF = new Date("2026-09-10T00:20:00.000Z");

async function main() {
  const week = await prisma.week.findFirst({
    where: { season: { year: 2026 }, weekNumber: 1 },
    include: { contests: { select: { id: true, position: true, status: true, locksAt: true } } },
  });
  if (!week) {
    console.error("Week 1 2026 not found");
    process.exit(1);
  }

  const games = await prisma.nflGame.findMany({
    where: { weekId: week.id },
    orderBy: { startsAt: "asc" },
  });

  console.log("Before:", {
    weekId: week.id,
    startsAt: week.startsAt.toISOString(),
    endsAt: week.endsAt.toISOString(),
    rankingsOpenAt: week.rankingsOpenAt?.toISOString(),
    fullLockAt: week.fullLockAt?.toISOString(),
    publicReleaseAt: week.publicReleaseAt?.toISOString(),
    gameCount: games.length,
    firstGame: games[0]?.startsAt.toISOString(),
    lastGame: games.at(-1)?.startsAt.toISOString(),
    contestStatuses: week.contests.map((c) => `${c.position}:${c.status}`),
  });

  if (games.length > 0) {
    const currentFirst = games[0]!.startsAt;
    const deltaMs = TARGET_FIRST_KICKOFF.getTime() - currentFirst.getTime();
    console.log("Shifting games by ms:", deltaMs, `(${deltaMs / 86400000} days)`);

    for (const game of games) {
      await prisma.nflGame.update({
        where: { id: game.id },
        data: { startsAt: new Date(game.startsAt.getTime() + deltaMs) },
      });
    }

    const entryIds = await prisma.contestEntry.findMany({
      where: { contest: { weekId: week.id } },
      select: { rankableEntryId: true },
      distinct: ["rankableEntryId"],
    });
    const ids = entryIds.map((e) => e.rankableEntryId);
    const entries = await prisma.rankableEntry.findMany({
      where: { id: { in: ids }, gameStartsAt: { not: null } },
      select: { id: true, gameStartsAt: true },
    });

    let shiftedEntries = 0;
    for (const entry of entries) {
      if (!entry.gameStartsAt) continue;
      // Only shift 2026 early-September kickoffs (leave absurd/future placeholders alone).
      const t = entry.gameStartsAt.getTime();
      if (t < Date.parse("2026-09-01T00:00:00Z") || t > Date.parse("2026-09-12T23:59:59Z")) {
        continue;
      }
      await prisma.rankableEntry.update({
        where: { id: entry.id },
        data: { gameStartsAt: new Date(t + deltaMs) },
      });
      shiftedEntries += 1;
    }
    console.log("Shifted RankableEntry.gameStartsAt rows:", shiftedEntries);

    await applyWeekTimingFromSchedule(week.id);
  } else {
    // No games — set timing from intended Week 1 bounds directly.
    const startsAt = zonedLocalToUtc(2026, 9, 9, 19, 20);
    const endsAt = zonedLocalToUtc(2026, 9, 14, 22, 15);
    const timing = computeNflTimingWindows(startsAt, endsAt);
    await updateWeekTiming({
      weekId: week.id,
      startsAt,
      endsAt,
      rankingsOpenAt: timing.rankingsOpenAt,
      fullLockAt: timing.fullLockAt,
      revealStartsAt: timing.revealStartsAt,
      publicReleaseAt: timing.publicReleaseAt,
    });
  }

  const after = await prisma.week.findUniqueOrThrow({
    where: { id: week.id },
    include: {
      contests: { select: { position: true, status: true, locksAt: true, opensAt: true } },
      games: { orderBy: { startsAt: "asc" }, select: { startsAt: true, homeTeam: true, awayTeam: true } },
    },
  });
  const now = new Date();
  const state = getWeekTimingState({
    rankingsOpenAt: after.rankingsOpenAt,
    fullLockAt: after.fullLockAt,
    revealStartsAt: after.revealStartsAt,
    publicReleaseAt: after.publicReleaseAt,
    weekStatus: after.status,
    now,
  });

  console.log("After:", {
    startsAt: after.startsAt.toISOString(),
    endsAt: after.endsAt.toISOString(),
    rankingsOpenAt: after.rankingsOpenAt?.toISOString(),
    fullLockAt: after.fullLockAt?.toISOString(),
    revealStartsAt: after.revealStartsAt?.toISOString(),
    publicReleaseAt: after.publicReleaseAt?.toISOString(),
    firstGame: after.games[0]?.startsAt.toISOString(),
    lastGame: after.games.at(-1)?.startsAt.toISOString(),
    canEditUnlocked: state.canEditUnlocked,
    fullBoardLocked: state.fullBoardLocked,
    phase: state.phase,
    contests: after.contests.map((c) => ({
      position: c.position,
      status: c.status,
      locksAt: c.locksAt?.toISOString(),
      opensAt: c.opensAt?.toISOString(),
    })),
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
