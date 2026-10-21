import type { WaiverDb } from "@/lib/waivers/clock";
import { WaiverPrecisionError, toFpHundredths } from "@/lib/waivers/precision";
import { rankEyeQContentChecksum } from "@/lib/waivers/rankeyeq-results/checksum";
import {
  RANKEYEQ_FANTASY_SCORING_VERSION,
  RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION,
  RANKEYEQ_FINAL_WEEK_STATS_SOURCE_KIND,
  RANKEYEQ_IDENTITY_PROVIDER,
  RANKEYEQ_POSITIONS,
  RANKEYEQ_REQUIRED_GAME_STATUS,
  RANKEYEQ_REQUIRED_WEEK_STATUS,
  RANKEYEQ_WEEK_STAT_PROVIDER,
  rankEyeQDefenseExternalId,
  rankEyeQResultsSeriesKey,
  type RankEyeQResultsPosition,
} from "@/lib/waivers/rankeyeq-results/contract";
import { RankEyeQResultsError } from "@/lib/waivers/rankeyeq-results/errors";
import { sortRankEyeQParticipants, summarizeRankEyeQParticipants } from "@/lib/waivers/rankeyeq-results/summary";
import type {
  RankEyeQBuildBlocker,
  RankEyeQFinalWeekStatsBuild,
  RankEyeQFinalWeekStatsContent,
  RankEyeQParticipant,
  RankEyeQParticipantIssue,
} from "@/lib/waivers/rankeyeq-results/types";

/**
 * Builds the `rankeyeq-final-week-stats/1` snapshot content from RankEyeQ's
 * own already-calculated WeekStat rows. It re-scores nothing: fantasy points
 * come from PlayerWeekStat / DefenseWeekStat via toFpHundredths, matched only
 * by RankableEntry id (and frozen provider + externalId identity). Names never
 * resolve a match.
 *
 *   missing / provisional / duplicate / unverifiable stat → ABSENT_UNRESOLVED (never zero)
 *   fantasy points !== 0                                   → PARTICIPATED_WITH_STATS / PLAYED
 *   fantasy points === 0                                   → PENDING_ZERO_REVIEW (operator decides)
 *
 * The assembler is pure; `loadRankEyeQFinalWeekStatsInput` only SELECTs.
 */

export type RankEyeQBuildWeek = { id: string; seasonYear: number; weekNumber: number; status: string; fantasyScoringVersion: string };
export type RankEyeQBuildGame = { id: string; status: string };

export type RankEyeQBuildSnapshotEntry = {
  snapshotEntryId: string;
  rankableEntryId: string;
  position: string;
  evidenceRole: string;
  eligibility: string;
  displayNameAtFreeze: string;
  teamAtFreeze: string | null;
  nflGameId: string | null;
  /** Identity key stored at freeze; null on rows frozen before Stage 4B.1. */
  frozenIdentity: { provider: string; externalId: string } | null;
  rankable: { provider: string; externalId: string; team: string };
};

export type RankEyeQBuildSnapshot = {
  id: string;
  version: number;
  status: string;
  currentForWeekId: string | null;
  entriesFingerprint: string;
  entries: readonly RankEyeQBuildSnapshotEntry[];
};

export type RankEyeQBuildContest = { id: string; position: string; status: string; snapshotId: string };

/** One RankEyeQ WeekStat row (PlayerWeekStat or DefenseWeekStat), already scored. */
export type RankEyeQBuildStatRow = {
  id: string;
  provider: string;
  weekId: string;
  rankableEntryId: string | null;
  gameId: string | null;
  scoringVersion: string;
  fantasyPoints: number;
  isProvisional: boolean;
};

export type RankEyeQFinalWeekStatsBuildInput = {
  week: RankEyeQBuildWeek;
  games: readonly RankEyeQBuildGame[];
  /**
   * The current FROZEN waiver snapshot; null when the week has none. `entries`
   * may hold every entry of the snapshot (any role or eligibility): only
   * eligible CANDIDATE entries are pool participants, and the rest identify
   * called players that are no longer eligible (see `calledEntries`).
   */
  snapshot: RankEyeQBuildSnapshot | null;
  contests: readonly RankEyeQBuildContest[];
  playerStats: readonly RankEyeQBuildStatRow[];
  defenseStats: readonly RankEyeQBuildStatRow[];
  /**
   * The snapshot entry of every call on the contests' locked revisions (the
   * entries the boards originally called, which may belong to an earlier
   * snapshot version). Players called outside the eligible pool become
   * participants too, so grading can recognize them as INVALIDATED_CALLED
   * players by the same frozen identity rules. Defaults to none.
   */
  calledEntries?: readonly RankEyeQBuildSnapshotEntry[];
};

export type RankEyeQCalledOutsidePool = {
  /** The entry whose frozen identity and facts the participant uses: the snapshot's own entry for the player, else the first called entry. */
  entry: RankEyeQBuildSnapshotEntry;
  /** More than one distinct frozen identity was called for a player absent from the snapshot. */
  ambiguousIdentity: boolean;
};

const isResultsPosition = (value: string): value is RankEyeQResultsPosition => (RANKEYEQ_POSITIONS as readonly string[]).includes(value);
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isPoolMember = (entry: RankEyeQBuildSnapshotEntry) => entry.evidenceRole === "CANDIDATE" && entry.eligibility === "ELIGIBLE";

/**
 * Players called on locked boards that are not eligible pool members of the
 * snapshot (the grading engine's INVALIDATED_CALLED_PLAYER category), one per
 * rankableEntryId in code-unit order. A player the snapshot still holds (as an
 * ineligible entry) uses that entry; an absent one uses the called entry.
 */
export function rankEyeQCalledOutsidePool(
  snapshotEntries: readonly RankEyeQBuildSnapshotEntry[],
  calledEntries: readonly RankEyeQBuildSnapshotEntry[],
): RankEyeQCalledOutsidePool[] {
  const poolPlayers = new Set(snapshotEntries.filter(isPoolMember).map((entry) => entry.rankableEntryId));
  const pinnedByPlayer = new Map(snapshotEntries.map((entry) => [entry.rankableEntryId, entry]));
  const called = new Map<string, RankEyeQBuildSnapshotEntry[]>();
  for (const entry of calledEntries) {
    if (poolPlayers.has(entry.rankableEntryId)) continue;
    const list = called.get(entry.rankableEntryId) ?? [];
    if (!list.some((existing) => existing.snapshotEntryId === entry.snapshotEntryId)) list.push(entry);
    called.set(entry.rankableEntryId, list);
  }
  const identityOf = (entry: RankEyeQBuildSnapshotEntry) => entry.frozenIdentity ?? { provider: entry.rankable.provider, externalId: entry.rankable.externalId };
  return [...called]
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([player, list]) => {
      const pinned = pinnedByPlayer.get(player) ?? null;
      const sorted = [...list].sort((a, b) => byCodeUnit(a.snapshotEntryId, b.snapshotEntryId));
      const identities = new Set(sorted.map((entry) => `${identityOf(entry).provider}\u0000${identityOf(entry).externalId}`));
      return { entry: pinned ?? sorted[0], ambiguousIdentity: pinned === null && identities.size > 1 };
    });
}

function groupStats(rows: readonly RankEyeQBuildStatRow[], weekId: string): Map<string, RankEyeQBuildStatRow[]> {
  const grouped = new Map<string, RankEyeQBuildStatRow[]>();
  for (const row of rows) {
    if (row.rankableEntryId === null || row.weekId !== weekId || row.provider !== RANKEYEQ_WEEK_STAT_PROVIDER) continue;
    grouped.set(row.rankableEntryId, [...(grouped.get(row.rankableEntryId) ?? []), row]);
  }
  return grouped;
}

function classifyEntry(
  entry: RankEyeQBuildSnapshotEntry,
  position: RankEyeQResultsPosition,
  statRows: readonly RankEyeQBuildStatRow[],
  gamesById: ReadonlyMap<string, string>,
  extraIssues: readonly RankEyeQParticipantIssue[] = [],
): RankEyeQParticipant {
  const issues: RankEyeQParticipantIssue[] = [...extraIssues];
  const isDefense = position === "DEF";
  const team = entry.teamAtFreeze ?? entry.rankable.team;
  const label = `${entry.displayNameAtFreeze} (${entry.rankableEntryId})`;

  // Identity: the frozen key when present, else the live RankableEntry key (advisory).
  const identity = entry.frozenIdentity ?? { provider: entry.rankable.provider, externalId: entry.rankable.externalId };
  if (entry.frozenIdentity === null) {
    issues.push({ code: "IDENTITY_NOT_FROZEN", detail: `${label} was frozen before the identity key was recorded; the live RankableEntry identity was used` });
  } else if (entry.frozenIdentity.provider !== entry.rankable.provider || entry.frozenIdentity.externalId !== entry.rankable.externalId) {
    issues.push({
      code: "FROZEN_IDENTITY_MISMATCH",
      detail: `${label}: frozen ${entry.frozenIdentity.provider}:${entry.frozenIdentity.externalId}; live ${entry.rankable.provider}:${entry.rankable.externalId}`,
    });
  }
  if (identity.provider !== RANKEYEQ_IDENTITY_PROVIDER) {
    issues.push({
      code: "IDENTITY_PROVIDER_NOT_CONTRACT",
      detail: `${label} uses provider ${identity.provider}; the contract requires ${RANKEYEQ_IDENTITY_PROVIDER}`,
    });
  }
  if (isDefense && identity.externalId !== rankEyeQDefenseExternalId(team)) {
    issues.push({ code: "DEF_IDENTITY_MALFORMED", detail: `${label}: DEF identity ${identity.externalId} must be ${rankEyeQDefenseExternalId(team)}` });
  }

  // Stat line: exactly one final manual row, scored under the pinned ruleset.
  let statRow: RankEyeQBuildStatRow | null = null;
  let pointsHundredths: number | null = null;
  if (statRows.length === 0) {
    issues.push({ code: "STAT_ROW_MISSING", detail: `${label} has no ${RANKEYEQ_WEEK_STAT_PROVIDER} ${isDefense ? "DefenseWeekStat" : "PlayerWeekStat"} row; missing is never zero` });
  } else if (statRows.length > 1) {
    issues.push({ code: "STAT_ROW_DUPLICATE", detail: `${label} has ${statRows.length} WeekStat rows (${statRows.map((row) => row.id).sort(byCodeUnit).join(", ")})` });
  } else {
    statRow = statRows[0];
    if (statRow.isProvisional) {
      issues.push({ code: "STAT_ROW_PROVISIONAL", detail: `${label} WeekStat row ${statRow.id} is still provisional` });
    }
    if (statRow.scoringVersion !== RANKEYEQ_FANTASY_SCORING_VERSION) {
      issues.push({
        code: "STAT_SCORING_VERSION_MISMATCH",
        detail: `${label} WeekStat row ${statRow.id} was scored under ${statRow.scoringVersion}; ${RANKEYEQ_FANTASY_SCORING_VERSION} is required`,
      });
    }
    try {
      pointsHundredths = toFpHundredths(statRow.fantasyPoints);
    } catch (error) {
      if (!(error instanceof WaiverPrecisionError)) throw error;
      issues.push({ code: "FANTASY_POINTS_NOT_REPRESENTABLE", detail: `${label} WeekStat row ${statRow.id}: ${error.message}` });
    }
  }

  // Games backing the line must all be FINAL.
  const gameIds = [...new Set([statRow?.gameId ?? null, entry.nflGameId].filter((id): id is string => id !== null))].sort(byCodeUnit);
  const games = gameIds.map((gameId) => ({ gameId, status: gamesById.get(gameId) ?? "UNKNOWN" }));
  if (statRow !== null) {
    if (gameIds.length === 0) {
      issues.push({ code: "NO_GAME_LINKED", detail: `${label} has no linked NflGame to prove the line is final` });
    }
    for (const game of games) {
      if (game.status !== RANKEYEQ_REQUIRED_GAME_STATUS) {
        issues.push({ code: "GAME_NOT_FINAL", detail: `${label}: game ${game.gameId} is ${game.status}; ${RANKEYEQ_REQUIRED_GAME_STATUS} is required` });
      }
    }
  }

  const blocking = issues.filter((issue) => issue.code !== "IDENTITY_NOT_FROZEN");
  const base = {
    rankableEntryId: entry.rankableEntryId,
    snapshotEntryId: entry.snapshotEntryId,
    provider: identity.provider,
    externalId: identity.externalId,
    kind: isDefense ? ("TEAM_DEFENSE" as const) : ("PLAYER" as const),
    position,
    team: entry.teamAtFreeze ?? entry.rankable.team ?? null,
    displayName: entry.displayNameAtFreeze,
    gameIds,
  };
  const evidence = {
    statTable: isDefense ? ("DefenseWeekStat" as const) : ("PlayerWeekStat" as const),
    statRowId: statRow?.id ?? null,
    statProvider: statRow?.provider ?? null,
    statScoringVersion: statRow?.scoringVersion ?? null,
    isProvisional: statRow?.isProvisional ?? null,
    games,
    decision: null,
    issues,
  };

  if (blocking.length > 0 || statRow === null || pointsHundredths === null) {
    return { ...base, participationState: "ABSENT_UNRESOLVED", disposition: "UNRESOLVED", proof: "NONE", pointsHundredths: null, evidence };
  }
  if (pointsHundredths === 0) {
    // Zero fantasy points never infers DNP (or a played zero): the operator must review.
    return { ...base, participationState: "PENDING_ZERO_REVIEW", disposition: "UNRESOLVED", proof: "NONE", pointsHundredths: null, evidence };
  }
  return { ...base, participationState: "PARTICIPATED_WITH_STATS", disposition: "PLAYED", proof: "WEEK_STAT_LINE", pointsHundredths, evidence };
}

/** Pure assembly of the snapshot content and its week-level blockers. */
export function assembleRankEyeQFinalWeekStatsContent(input: RankEyeQFinalWeekStatsBuildInput): RankEyeQFinalWeekStatsBuild {
  const blockers: RankEyeQBuildBlocker[] = [];
  const { week } = input;
  if (week.status !== RANKEYEQ_REQUIRED_WEEK_STATUS) {
    blockers.push({ code: "WEEK_NOT_COMPLETE", detail: `Week status is ${week.status}; ${RANKEYEQ_REQUIRED_WEEK_STATUS} is required` });
  }
  if (week.fantasyScoringVersion !== RANKEYEQ_FANTASY_SCORING_VERSION) {
    blockers.push({
      code: "WEEK_SCORING_VERSION_MISMATCH",
      detail: `Week fantasyScoringVersion is ${week.fantasyScoringVersion}; ${RANKEYEQ_FANTASY_SCORING_VERSION} is required`,
    });
  }
  const notFinal = input.games.filter((game) => game.status !== RANKEYEQ_REQUIRED_GAME_STATUS && game.status !== "CANCELED");
  if (notFinal.length > 0) {
    blockers.push({
      code: "WEEK_GAMES_NOT_FINAL",
      detail: `${notFinal.length} week game(s) are not ${RANKEYEQ_REQUIRED_GAME_STATUS}: ${notFinal.map((game) => `${game.id}:${game.status}`).sort(byCodeUnit).join(", ")}`,
    });
  }
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.status !== "FROZEN" || snapshot.currentForWeekId !== week.id) {
    blockers.push({ code: "NO_CURRENT_FROZEN_SNAPSHOT", detail: "The week has no current FROZEN waiver snapshot" });
  } else {
    for (const contest of input.contests) {
      if (contest.status !== "LOCKED") {
        blockers.push({ code: "CONTEST_NOT_LOCKED", detail: `${contest.position} contest ${contest.id} is ${contest.status}; LOCKED is required` });
      }
      if (contest.snapshotId !== snapshot.id) {
        blockers.push({
          code: "CONTEST_SNAPSHOT_MISMATCH",
          detail: `${contest.position} contest ${contest.id} is pinned to snapshot ${contest.snapshotId}, not the current snapshot ${snapshot.id}`,
        });
      }
    }
  }
  if (blockers.length > 0 || !snapshot) return { content: null, blockers, contentChecksum: null };

  const gamesById = new Map(input.games.map((game) => [game.id, game.status]));
  const playerStats = groupStats(input.playerStats, week.id);
  const defenseStats = groupStats(input.defenseStats, week.id);
  const participants: RankEyeQParticipant[] = [];
  for (const entry of snapshot.entries.filter(isPoolMember)) {
    if (!isResultsPosition(entry.position)) continue;
    const stats = (entry.position === "DEF" ? defenseStats : playerStats).get(entry.rankableEntryId) ?? [];
    participants.push(classifyEntry(entry, entry.position, stats, gamesById));
  }
  // Players called on locked boards outside the eligible pool: same identity and stat rules.
  for (const { entry, ambiguousIdentity } of rankEyeQCalledOutsidePool(snapshot.entries, input.calledEntries ?? [])) {
    if (!isResultsPosition(entry.position)) continue;
    const stats = (entry.position === "DEF" ? defenseStats : playerStats).get(entry.rankableEntryId) ?? [];
    const extra: RankEyeQParticipantIssue[] = ambiguousIdentity
      ? [{ code: "CALLED_IDENTITY_AMBIGUOUS", detail: `${entry.displayNameAtFreeze} (${entry.rankableEntryId}) was called under more than one frozen identity` }]
      : [];
    participants.push(classifyEntry(entry, entry.position, stats, gamesById, extra));
  }
  const sorted = sortRankEyeQParticipants(participants);
  const content: RankEyeQFinalWeekStatsContent = {
    schemaVersion: RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION,
    sourceKind: RANKEYEQ_FINAL_WEEK_STATS_SOURCE_KIND,
    seriesKey: rankEyeQResultsSeriesKey(week.seasonYear, week.weekNumber),
    week: { id: week.id, season: week.seasonYear, weekNumber: week.weekNumber },
    scoringVersion: week.fantasyScoringVersion,
    rankingsWeekStatus: week.status,
    sourceWeekId: week.id,
    statProvider: RANKEYEQ_WEEK_STAT_PROVIDER,
    waiverSnapshot: { id: snapshot.id, version: snapshot.version, entriesFingerprint: snapshot.entriesFingerprint },
    contests: input.contests
      .filter((contest): contest is typeof contest & { position: RankEyeQResultsPosition } => isResultsPosition(contest.position))
      .map((contest) => ({ contestId: contest.id, position: contest.position, status: contest.status, snapshotId: contest.snapshotId }))
      .sort((a, b) => byCodeUnit(a.position, b.position) || byCodeUnit(a.contestId, b.contestId)),
    participants: sorted,
    summary: summarizeRankEyeQParticipants(sorted),
  };
  return { content, blockers, contentChecksum: rankEyeQContentChecksum(content) };
}

const ENTRY_SELECT = {
  id: true,
  rankableEntryId: true,
  position: true,
  evidenceRole: true,
  eligibility: true,
  displayNameAtFreeze: true,
  teamAtFreeze: true,
  nflGameId: true,
  identityProviderAtFreeze: true,
  identityExternalIdAtFreeze: true,
  rankableEntry: { select: { provider: true, externalId: true, team: true } },
} as const;

type EntryRow = {
  id: string;
  rankableEntryId: string;
  position: string;
  evidenceRole: string;
  eligibility: string;
  displayNameAtFreeze: string;
  teamAtFreeze: string | null;
  nflGameId: string | null;
  identityProviderAtFreeze: string | null;
  identityExternalIdAtFreeze: string | null;
  rankableEntry: { provider: string; externalId: string; team: string };
};

const toBuildEntry = (entry: EntryRow): RankEyeQBuildSnapshotEntry => ({
  snapshotEntryId: entry.id,
  rankableEntryId: entry.rankableEntryId,
  position: entry.position,
  evidenceRole: entry.evidenceRole,
  eligibility: entry.eligibility,
  displayNameAtFreeze: entry.displayNameAtFreeze,
  teamAtFreeze: entry.teamAtFreeze,
  nflGameId: entry.nflGameId,
  frozenIdentity:
    entry.identityProviderAtFreeze !== null && entry.identityExternalIdAtFreeze !== null
      ? { provider: entry.identityProviderAtFreeze, externalId: entry.identityExternalIdAtFreeze }
      : null,
  rankable: entry.rankableEntry,
});

/** SELECT-only load of everything the assembler needs for one week. */
export async function loadRankEyeQFinalWeekStatsInput(db: WaiverDb, weekId: string): Promise<RankEyeQFinalWeekStatsBuildInput> {
  const week = await db.week.findUnique({
    where: { id: weekId },
    select: { id: true, weekNumber: true, status: true, fantasyScoringVersion: true, season: { select: { year: true } } },
  });
  if (!week) throw new RankEyeQResultsError("NOT_FOUND", "Week not found");
  const games = await db.nflGame.findMany({ where: { weekId }, select: { id: true, status: true } });
  const snapshotRow = await db.waiverSnapshot.findFirst({
    where: { weekId, currentForWeekId: weekId, status: "FROZEN" },
    select: {
      id: true,
      version: true,
      status: true,
      currentForWeekId: true,
      entriesFingerprint: true,
      // Every entry: eligible CANDIDATEs are the pool, the rest identify called-but-no-longer-eligible players.
      entries: { orderBy: [{ position: "asc" }, { inputLineNumber: "asc" }], select: ENTRY_SELECT },
    },
  });
  const contests = await db.waiverContest.findMany({
    where: { weekId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, status: true, snapshotId: true },
  });
  const snapshot: RankEyeQBuildSnapshot | null = snapshotRow
    ? {
        id: snapshotRow.id,
        version: snapshotRow.version,
        status: snapshotRow.status,
        currentForWeekId: snapshotRow.currentForWeekId,
        entriesFingerprint: snapshotRow.entriesFingerprint,
        entries: snapshotRow.entries.map(toBuildEntry),
      }
    : null;
  // The entry of every call on the contests' locked boards (SELECT only).
  const submissions = contests.length
    ? await db.waiverSubmission.findMany({
        where: { contestId: { in: contests.map((contest) => contest.id) }, lockedRevisionId: { not: null } },
        orderBy: { id: "asc" },
        select: { lockedRevision: { select: { calls: { orderBy: { slot: "asc" }, select: { snapshotEntry: { select: ENTRY_SELECT } } } } } },
      })
    : [];
  const calledEntries = submissions.flatMap((submission) => (submission.lockedRevision?.calls ?? []).map((call) => toBuildEntry(call.snapshotEntry)));
  const poolEntries = snapshot ? snapshot.entries.filter(isPoolMember) : [];
  const statEntries = [...poolEntries, ...(snapshot ? rankEyeQCalledOutsidePool(snapshot.entries, calledEntries).map((called) => called.entry) : [])];
  const playerIds = statEntries.filter((entry) => entry.position !== "DEF").map((entry) => entry.rankableEntryId);
  const defenseIds = statEntries.filter((entry) => entry.position === "DEF").map((entry) => entry.rankableEntryId);
  // Provisional rows are loaded too so the assembler can name them instead of reporting "missing".
  const statSelect = { id: true, provider: true, weekId: true, rankableEntryId: true, gameId: true, scoringVersion: true, fantasyPoints: true, isProvisional: true } as const;
  const playerStats = playerIds.length
    ? await db.playerWeekStat.findMany({ where: { weekId, provider: RANKEYEQ_WEEK_STAT_PROVIDER, rankableEntryId: { in: playerIds } }, select: statSelect })
    : [];
  const defenseStats = defenseIds.length
    ? await db.defenseWeekStat.findMany({ where: { weekId, provider: RANKEYEQ_WEEK_STAT_PROVIDER, rankableEntryId: { in: defenseIds } }, select: statSelect })
    : [];
  return {
    week: { id: week.id, seasonYear: week.season.year, weekNumber: week.weekNumber, status: week.status, fantasyScoringVersion: week.fantasyScoringVersion },
    games,
    snapshot,
    contests,
    playerStats,
    defenseStats,
    calledEntries,
  };
}

/** Read-only build for one week: load, then assemble. Writes nothing. */
export async function buildRankEyeQFinalWeekStatsSnapshot(input: { weekId: string }, db: WaiverDb): Promise<RankEyeQFinalWeekStatsBuild> {
  return assembleRankEyeQFinalWeekStatsContent(await loadRankEyeQFinalWeekStatsInput(db, input.weekId));
}
