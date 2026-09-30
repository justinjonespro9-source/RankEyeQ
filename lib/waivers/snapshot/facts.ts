import { resolvePlayerWeekStatus, type WeeklyDesignation } from "@/lib/eligibility/player-week-availability";
import type { WaiverDb } from "@/lib/waivers/clock";
import { WAIVER_OWNERSHIP_THRESHOLD_BPS, WAIVER_POSITIONS } from "@/lib/waivers/constants";
import { loadFinalWaiverBoards } from "@/lib/waivers/corrections";
import type { WaiverPoolPlayer, WaiverTrackedPlayer } from "@/lib/waivers/snapshot/completeness";
import {
  canonicalWaiverTeam,
  resolveWaiverGame,
  waiverAvailabilityFact,
  type WaiverEntryFacts,
  type WaiverWeekGame,
} from "@/lib/waivers/snapshot/eligibility";
import { buildWaiverMatchIndex, type WaiverMatchCandidate, type WaiverMatchIndex } from "@/lib/waivers/snapshot/match";
import type { WaiverPreviewContext } from "@/lib/waivers/snapshot/preview-model";

/**
 * Read-only canonical facts for the snapshot workflow. Every loader takes the
 * caller's client so freeze and correction can read inside their transaction.
 * Sequential awaits only (never Promise.all on a transaction client).
 */

export type WaiverWeekRecord = {
  id: string;
  seasonId: string;
  weekNumber: number;
  label: string;
  isTest: boolean;
  rosterSyncedAt: Date | null;
};

export async function loadWaiverWeek(db: WaiverDb, weekId: string): Promise<WaiverWeekRecord | null> {
  const week = await db.week.findUnique({
    where: { id: weekId },
    select: { id: true, seasonId: true, weekNumber: true, label: true, isTest: true, season: { select: { rosterSyncedAt: true } } },
  });
  if (!week) return null;
  return {
    id: week.id,
    seasonId: week.seasonId,
    weekNumber: week.weekNumber,
    label: week.label,
    isTest: week.isTest,
    rosterSyncedAt: week.season.rosterSyncedAt,
  };
}

export async function loadWaiverWeekGames(db: WaiverDb, weekId: string): Promise<WaiverWeekGame[]> {
  return db.nflGame.findMany({
    where: { weekId },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { id: true, homeTeam: true, awayTeam: true, startsAt: true, status: true },
  });
}

export async function loadCurrentWaiverSnapshot(db: WaiverDb, weekId: string) {
  return db.waiverSnapshot.findUnique({
    where: { currentForWeekId: weekId },
    select: { id: true, version: true },
  });
}

const candidateSelect = (seasonId: string) =>
  ({
    id: true,
    name: true,
    adminNotes: true,
    position: true,
    type: true,
    team: true,
    seasonPlayers: { where: { seasonId }, select: { team: true }, take: 1 },
  }) as const;

type CandidateRow = {
  id: string;
  name: string;
  adminNotes: string | null;
  position: WaiverMatchCandidate["position"];
  type: string;
  team: string;
  seasonPlayers: Array<{ team: string }>;
};

const toCandidate = (row: CandidateRow): WaiverMatchCandidate => ({
  id: row.id,
  name: row.name,
  adminNotes: row.adminNotes,
  position: row.position,
  type: row.type,
  canonicalTeam: canonicalWaiverTeam(row.seasonPlayers[0]?.team, row.team),
  onSeasonRoster: row.seasonPlayers.length > 0,
});

/**
 * Name universe: records at a Waiver position that are active or on this
 * season's roster. Explicit ID-column values are looked up regardless.
 */
export async function loadWaiverMatchIndex(
  db: WaiverDb,
  input: { seasonId: string; idLookups: ReadonlyArray<string> },
): Promise<WaiverMatchIndex> {
  const universe = await db.rankableEntry.findMany({
    where: {
      position: { in: [...WAIVER_POSITIONS] },
      OR: [{ active: true }, { seasonPlayers: { some: { seasonId: input.seasonId } } }],
    },
    select: candidateSelect(input.seasonId),
  });
  const ids = [...new Set(input.idLookups)];
  const byId = ids.length > 0 ? await db.rankableEntry.findMany({ where: { id: { in: ids } }, select: candidateSelect(input.seasonId) }) : [];
  return buildWaiverMatchIndex(universe.map(toCandidate), byId.map(toCandidate));
}

/**
 * Same reads and resolver as `loadResolvedStatusesForWeek` (week row +
 * season roster status; RankableEntry.availability intentionally ignored),
 * plus canonical team and game facts.
 */
export async function loadWaiverEntryFacts(
  db: WaiverDb,
  input: { weekId: string; seasonId: string; rankableEntryIds: ReadonlyArray<string>; games: ReadonlyArray<WaiverWeekGame> },
): Promise<Map<string, WaiverEntryFacts>> {
  const ids = [...new Set(input.rankableEntryIds)];
  const out = new Map<string, WaiverEntryFacts>();
  if (ids.length === 0) return out;
  const entries = await db.rankableEntry.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, team: true } });
  const weekRows = await db.playerWeekAvailability.findMany({ where: { weekId: input.weekId, rankableEntryId: { in: ids } } });
  const rosterRows = await db.seasonPlayer.findMany({
    where: { seasonId: input.seasonId, rankableEntryId: { in: ids } },
    select: { rankableEntryId: true, team: true, activeOnNFLRoster: true, nflStatus: true },
  });
  const weekById = new Map(weekRows.map((row) => [row.rankableEntryId, row]));
  const rosterById = new Map(rosterRows.map((row) => [row.rankableEntryId, row]));
  for (const entry of entries) {
    const week = weekById.get(entry.id);
    const roster = rosterById.get(entry.id) ?? null;
    const resolved = resolvePlayerWeekStatus({
      nflStatus: roster?.nflStatus ?? null,
      weekDesignation: week?.designation as WeeklyDesignation | undefined,
      injuryDescription: week?.injuryDescription,
      practiceStatus: week?.practiceStatus,
      sourceType: week?.sourceType,
      sourceUrl: week?.sourceUrl,
      sourcePublishedAt: week?.sourcePublishedAt,
      observedAt: week?.observedAt,
      manualOverride: week?.manualOverride,
    });
    const canonicalTeam = canonicalWaiverTeam(roster?.team, entry.team);
    out.set(entry.id, {
      rankableEntryId: entry.id,
      canonicalName: entry.name,
      canonicalTeam,
      roster: roster ? { team: roster.team, activeOnNFLRoster: roster.activeOnNFLRoster, nflStatus: roster.nflStatus } : null,
      game: resolveWaiverGame(canonicalTeam, input.games),
      availability: waiverAvailabilityFact(resolved, Boolean(week)),
    });
  }
  return out;
}

/** Earlier weeks of the same season sharing the week's test flag (test data never mixes with real weeks). */
const earlierWeeks = (week: WaiverWeekRecord) => ({ seasonId: week.seasonId, isTest: week.isTest, weekNumber: { lt: week.weekNumber } });

/**
 * Players called on a final (locked) board in an earlier week whose most
 * recent weekly observation is below the threshold.
 */
export async function loadWaiverTrackedPlayers(
  db: WaiverDb,
  input: { week: WaiverWeekRecord; now: Date; thresholdBps?: number },
): Promise<WaiverTrackedPlayer[]> {
  const thresholdBps = input.thresholdBps ?? WAIVER_OWNERSHIP_THRESHOLD_BPS;
  const contests = await db.waiverContest.findMany({
    where: { week: earlierWeeks(input.week), locksAt: { lte: input.now } },
    orderBy: { id: "asc" },
    select: { id: true, locksAt: true },
  });
  const called = new Set<string>();
  for (const contest of contests) {
    for (const board of await loadFinalWaiverBoards(db, { contestId: contest.id, locksAt: contest.locksAt })) {
      for (const call of board.calls) called.add(call.rankableEntryId);
    }
  }
  if (called.size === 0) return [];

  const observations = await db.waiverSnapshotEntry.findMany({
    where: {
      rankableEntryId: { in: [...called] },
      snapshot: { currentForWeekId: { not: null }, week: earlierWeeks(input.week) },
    },
    select: {
      rankableEntryId: true,
      rosteredBps: true,
      displayNameAtFreeze: true,
      position: true,
      snapshot: { select: { week: { select: { weekNumber: true } } } },
    },
  });
  const latest = new Map<string, (typeof observations)[number]>();
  for (const row of observations) {
    const previous = latest.get(row.rankableEntryId);
    if (!previous || row.snapshot.week.weekNumber > previous.snapshot.week.weekNumber) latest.set(row.rankableEntryId, row);
  }
  const tracked: WaiverTrackedPlayer[] = [];
  for (const row of latest.values()) {
    if (row.rosteredBps >= thresholdBps) continue;
    tracked.push({
      rankableEntryId: row.rankableEntryId,
      name: row.displayNameAtFreeze,
      position: row.position,
      lastObservedBps: row.rosteredBps,
      lastObservedWeekNumber: row.snapshot.week.weekNumber,
    });
  }
  return tracked.sort((a, b) => (a.rankableEntryId < b.rankableEntryId ? -1 : 1));
}

/** Rankings weekly pool (non-excluded contest entries) — read-only completeness cross-check. */
export async function loadWaiverRankingsPool(db: WaiverDb, weekId: string): Promise<WaiverPoolPlayer[]> {
  const rows = await db.contestEntry.findMany({
    where: { excluded: false, contest: { weekId, position: { in: [...WAIVER_POSITIONS] } } },
    orderBy: { rankableEntryId: "asc" },
    select: { rankableEntryId: true, contest: { select: { position: true } }, rankableEntry: { select: { name: true } } },
  });
  return rows.map((row) => ({ rankableEntryId: row.rankableEntryId, name: row.rankableEntry.name, position: row.contest.position }));
}

/** ELIGIBLE candidates of the latest earlier week's current snapshot. */
export async function loadPreviousWaiverWeekEligible(
  db: WaiverDb,
  week: WaiverWeekRecord,
): Promise<{ weekNumber: number | null; players: WaiverPoolPlayer[] }> {
  const previous = await db.waiverSnapshot.findFirst({
    where: { currentForWeekId: { not: null }, week: earlierWeeks(week) },
    orderBy: { week: { weekNumber: "desc" } },
    select: { id: true, week: { select: { weekNumber: true } } },
  });
  if (!previous) return { weekNumber: null, players: [] };
  const rows = await db.waiverSnapshotEntry.findMany({
    where: { snapshotId: previous.id, evidenceRole: "CANDIDATE", eligibility: "ELIGIBLE" },
    orderBy: { rankableEntryId: "asc" },
    select: { rankableEntryId: true, displayNameAtFreeze: true, position: true },
  });
  return {
    weekNumber: previous.week.weekNumber,
    players: rows.map((row) => ({ rankableEntryId: row.rankableEntryId, name: row.displayNameAtFreeze, position: row.position })),
  };
}

export async function loadWaiverPreviewContext(
  db: WaiverDb,
  input: { week: WaiverWeekRecord; now: Date; games: WaiverWeekGame[] },
): Promise<WaiverPreviewContext> {
  const currentSnapshot = await loadCurrentWaiverSnapshot(db, input.week.id);
  const tracked = await loadWaiverTrackedPlayers(db, { week: input.week, now: input.now });
  const rankingsPool = await loadWaiverRankingsPool(db, input.week.id);
  const previous = await loadPreviousWaiverWeekEligible(db, input.week);
  return {
    now: input.now,
    week: { id: input.week.id, seasonId: input.week.seasonId, weekNumber: input.week.weekNumber },
    thresholdBps: WAIVER_OWNERSHIP_THRESHOLD_BPS,
    games: input.games,
    currentSnapshot,
    rosterSyncedAt: input.week.rosterSyncedAt,
    tracked,
    rankingsPool,
    previousWeekNumber: previous.weekNumber,
    previousEligible: previous.players,
  };
}
