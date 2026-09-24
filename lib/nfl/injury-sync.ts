import { prisma } from "@/lib/db";
import type {
  ContestPosition,
  EntryAvailability,
} from "@/lib/generated/prisma/client";
import {
  normalizePlayerName,
  playerNamesCanMerge,
} from "@/lib/nfl/player-identity";
import { parsePlayerAliases } from "@/lib/nfl/player-aliases";
import {
  INJURY_SYNC_FANTASY_POSITIONS,
  isInjuryFantasyPosition,
  mapInjurySourcePosition,
  nextAvailabilityFromInjuryRow,
  type ParsedInjuryRow,
} from "@/lib/providers/nfl/nflcom/parse-injuries";
import {
  fetchNflComInjuryRows,
  type FetchLike,
} from "@/lib/providers/nfl/nflcom/fetch-injuries";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  entryAvailabilityFromInjuryGameStatus,
  ROSTER_UNAVAILABLE_ENTRY,
} from "@/lib/eligibility/player-week-availability";
import { upsertPlayerWeekAvailability } from "@/lib/eligibility/player-week-availability-store";

export type InjuryMatchCandidate = {
  id: string;
  name: string;
  team: string;
  position: ContestPosition;
  score: "exact" | "alias" | "fuzzy";
};

export type InjurySyncMatch =
  | {
      status: "matched";
      row: ParsedInjuryRow;
      entryId: string;
      entryName: string;
      previous: EntryAvailability;
      next: EntryAvailability | null;
      changed: boolean;
      /** True when NFL.com listed the player but Game Status was blank. */
      missingGameStatus?: boolean;
    }
  | {
      status: "unmatched";
      row: ParsedInjuryRow;
      suggestions: InjuryMatchCandidate[];
    }
  | {
      status: "ambiguous";
      row: ParsedInjuryRow;
      suggestions: InjuryMatchCandidate[];
    };

export type InjurySyncSummary = {
  ok: boolean;
  source: "nfl.com" | "none";
  sourceUrl: string;
  syncedAt: Date;
  /** Total rows parsed from NFL.com (all positions). */
  sourceRowCount: number;
  /** Rows with a mapped official Game Status (Out/Q/D/IR). */
  officialGameStatusCount: number;
  /** Rows with blank Game Status (practice-only / awaiting official status). */
  blankGameStatusCount: number;
  matched: number;
  updated: number;
  unchanged: number;
  skippedManual: number;
  skippedKickoff: number;
  failed: number;
  questionable: number;
  doubtful: number;
  out: number;
  unmatched: number;
  ambiguous: number;
  errors: string[];
  matches: InjurySyncMatch[];
  skippedNonFantasy: number;
};

export function formatInjurySyncOperatorMessage(
  summary: InjurySyncSummary,
): string {
  if (!summary.ok && summary.source === "none") {
    return [
      "NFL Injury Sync failed",
      summary.errors[0] ?? "Source unavailable",
      "Existing designations left unchanged",
    ].join("\n");
  }

  const lines = [
    "NFL Injury Sync complete ✓",
    "",
    `${summary.sourceRowCount} NFL.com injury-report rows`,
    `${summary.officialGameStatusCount} official Game Status`,
    `${summary.blankGameStatusCount} awaiting official Game Status`,
    "",
    "Fantasy pool:",
    `${summary.matched} matched`,
    `${summary.unmatched} unmatched`,
    `${summary.out} OUT`,
    `${summary.questionable} QUESTIONABLE`,
    `${summary.doubtful} DOUBTFUL`,
    "",
    `Updated: ${summary.updated}`,
    `Unchanged: ${summary.unchanged}`,
    `Skipped kickoff: ${summary.skippedKickoff}`,
    `Skipped manual: ${summary.skippedManual}`,
    `Errors: ${summary.failed}`,
    `Source: ${summary.sourceUrl}`,
    `Fetched: ${summary.syncedAt.toISOString()}`,
  ];
  return lines.join("\n");
}

type RankableCandidate = {
  id: string;
  name: string;
  team: string;
  position: ContestPosition;
  availability: EntryAvailability;
  externalId: string;
  provider: string;
  adminNotes: string | null;
};

function candidatesForWeek(entries: RankableCandidate[]) {
  return entries.filter((entry) =>
    INJURY_SYNC_FANTASY_POSITIONS.has(entry.position),
  );
}

function matchInjuryRow(
  row: ParsedInjuryRow,
  pool: RankableCandidate[],
): InjurySyncMatch {
  const fantasyPos = mapInjurySourcePosition(row.position);
  const scoped = fantasyPos
    ? pool.filter((entry) => entry.position === fantasyPos)
    : pool;

  // 1) Provider/external id (nflcom slug)
  if (row.externalId) {
    const byExternal = scoped.filter(
      (entry) =>
        entry.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
        entry.externalId === row.externalId,
    );
    if (byExternal.length === 1) {
      return buildMatched(row, byExternal[0]!);
    }
    // Also allow externalId match across providers if unique
    const anyExternal = scoped.filter(
      (entry) => entry.externalId === row.externalId,
    );
    if (anyExternal.length === 1) {
      return buildMatched(row, anyExternal[0]!);
    }
  }

  // 2) Exact normalized name + team
  const normalized = normalizePlayerName(row.name);
  const exact = scoped.filter(
    (entry) =>
      entry.team === row.team &&
      normalizePlayerName(entry.name) === normalized,
  );
  if (exact.length === 1) {
    return buildMatched(row, exact[0]!);
  }
  if (exact.length > 1) {
    return {
      status: "ambiguous",
      row,
      suggestions: exact.map((entry) => ({
        id: entry.id,
        name: entry.name,
        team: entry.team,
        position: entry.position,
        score: "exact" as const,
      })),
    };
  }

  // 3) Alias table
  const aliasHits = scoped.filter((entry) => {
    if (entry.team !== row.team) return false;
    const aliases = parsePlayerAliases(entry.adminNotes);
    return (
      playerNamesCanMerge(entry.name, row.name) ||
      aliases.some((alias) => playerNamesCanMerge(alias, row.name))
    );
  });
  if (aliasHits.length === 1) {
    return buildMatched(row, aliasHits[0]!);
  }
  if (aliasHits.length > 1) {
    return {
      status: "ambiguous",
      row,
      suggestions: aliasHits.map((entry) => ({
        id: entry.id,
        name: entry.name,
        team: entry.team,
        position: entry.position,
        score: "alias" as const,
      })),
    };
  }

  // 4) Fuzzy suggestions ONLY for admin review — never auto-apply
  const fuzzy = scoped
    .filter((entry) => {
      if (entry.team !== row.team && row.team !== "UNK") return false;
      const a = normalizePlayerName(entry.name);
      const b = normalized;
      return a.includes(b) || b.includes(a) || playerNamesCanMerge(entry.name, row.name);
    })
    .slice(0, 5)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      team: entry.team,
      position: entry.position,
      score: "fuzzy" as const,
    }));

  return { status: "unmatched", row, suggestions: fuzzy };
}

function buildMatched(
  row: ParsedInjuryRow,
  entry: RankableCandidate,
): InjurySyncMatch {
  const next = nextAvailabilityFromInjuryRow({
    gameStatus: row.gameStatus,
    current: entry.availability,
  });
  const missingGameStatus = row.gameStatus == null && next == null;
  // Blank Game Status: do not invent AVAILABLE and do not overwrite existing
  // designations — leave unchanged for operator/manual review.
  const changed = next != null && next !== entry.availability;
  return {
    status: "matched",
    row,
    entryId: entry.id,
    entryName: entry.name,
    previous: entry.availability,
    next,
    changed,
    missingGameStatus,
  };
}

/**
 * Sync weekly injury designations from NFL.com official injuries page only.
 * Third-party sources (including CBS) are not used.
 * Failed fetch/parse leaves existing designations and overrides unchanged.
 */
export async function syncWeekInjuriesFromNflCom(input: {
  weekId: string;
  apply?: boolean;
  fetchFn?: FetchLike;
  nflHtml?: string;
}): Promise<InjurySyncSummary> {
  const apply = input.apply !== false;
  const errors: string[] = [];
  let source: InjurySyncSummary["source"] = "none";
  let sourceUrl = "https://www.nfl.com/injuries/";
  let syncedAt = new Date();
  let nflRows: ParsedInjuryRow[] = [];

  try {
    const fetched = await fetchNflComInjuryRows({
      fetchFn: input.fetchFn,
      html: input.nflHtml,
    });
    nflRows = fetched.rows;
    source = "nfl.com";
    sourceUrl = fetched.sourceUrl;
    syncedAt = fetched.fetchedAt;
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error.message
        : "Failed to fetch/parse NFL.com injuries",
    );
    return emptySummary({
      ok: false,
      source: "none",
      sourceUrl,
      syncedAt,
      errors: [...errors, "Existing designations left unchanged"],
      failed: 1,
    });
  }

  const workingRows = nflRows.filter((row) =>
    isInjuryFantasyPosition(row.position),
  );
  const skippedNonFantasy = nflRows.length - workingRows.length;
  const officialGameStatusCount = nflRows.filter(
    (row) => row.gameStatus != null,
  ).length;
  const blankGameStatusCount = nflRows.length - officialGameStatusCount;

  const contests = await prisma.rankIQContest.findMany({
    where: {
      weekId: input.weekId,
      position: { in: [...INJURY_SYNC_FANTASY_POSITIONS] },
    },
    select: { id: true },
  });
  const contestIds = contests.map((c) => c.id);
  const entries = await prisma.contestEntry.findMany({
    where: { contestId: { in: contestIds }, excluded: false },
    include: {
      rankableEntry: {
        select: {
          id: true,
          name: true,
          team: true,
          position: true,
          availability: true,
          externalId: true,
          provider: true,
          adminNotes: true,
        },
      },
    },
  });

  const poolMap = new Map<string, RankableCandidate>();
  for (const entry of entries) {
    poolMap.set(entry.rankableEntryId, entry.rankableEntry);
  }
  const pool = candidatesForWeek([...poolMap.values()]);

  const matches: InjurySyncMatch[] = workingRows.map((row) =>
    matchInjuryRow(row, pool),
  );

  let updated = 0;
  let unchanged = 0;
  let skippedManual = 0;
  let skippedKickoff = 0;
  let failed = 0;
  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let questionable = 0;
  let doubtful = 0;
  let out = 0;

  for (const match of matches) {
    if (match.status === "unmatched") {
      unmatched += 1;
      continue;
    }
    if (match.status === "ambiguous") {
      ambiguous += 1;
      unmatched += 1;
      continue;
    }
    matched += 1;
    if (match.next === "QUESTIONABLE") questionable += 1;
    if (match.next === "DOUBTFUL") doubtful += 1;
    if (match.next === "OUT") out += 1;

    // Blank Game Status: leave existing designation alone (UNKNOWN if none).
    if (match.missingGameStatus || match.next == null) {
      unchanged += 1;
      continue;
    }

    if (!match.changed) {
      unchanged += 1;
      continue;
    }

    if (!apply) {
      updated += 1;
      continue;
    }

    try {
      if (ROSTER_UNAVAILABLE_ENTRY.has(match.next)) {
        await prisma.rankableEntry.update({
          where: { id: match.entryId },
          data: { availability: match.next },
        });
        updated += 1;
        continue;
      }

      const designation = entryAvailabilityFromInjuryGameStatus(match.next);
      if (designation === "UNKNOWN") {
        // Official Game Status missing after mapping — do not invent AVAILABLE.
        unchanged += 1;
        continue;
      }

      const result = await upsertPlayerWeekAvailability({
        weekId: input.weekId,
        rankableEntryId: match.entryId,
        designation,
        injuryDescription: match.row.injury?.trim() || null,
        sourceUrl,
        sourcePublishedAt: syncedAt,
        observedAt: syncedAt,
        sourceType: "NFL_SYNC",
        respectManualOverride: true,
        skipAfterKickoff: true,
        now: syncedAt,
      });
      if (result.status === "skipped_override") {
        skippedManual += 1;
        continue;
      }
      if (result.status === "skipped_kickoff") {
        skippedKickoff += 1;
        continue;
      }
      if (result.status === "unchanged") {
        unchanged += 1;
        continue;
      }
      updated += 1;
    } catch (error) {
      failed += 1;
      errors.push(
        error instanceof Error
          ? `Failed updating ${match.entryName}: ${error.message}`
          : `Failed updating ${match.entryName}`,
      );
    }
  }

  return {
    ok: errors.length === 0 || (matched > 0 && failed === 0),
    source,
    sourceUrl,
    syncedAt,
    sourceRowCount: nflRows.length,
    officialGameStatusCount,
    blankGameStatusCount,
    matched,
    updated,
    unchanged,
    skippedManual,
    skippedKickoff,
    failed,
    questionable,
    doubtful,
    out,
    unmatched,
    ambiguous,
    errors,
    matches,
    skippedNonFantasy,
  };
}

function emptySummary(partial: {
  ok: boolean;
  source: InjurySyncSummary["source"];
  sourceUrl: string;
  syncedAt: Date;
  errors: string[];
  failed?: number;
}): InjurySyncSummary {
  return {
    ...partial,
    sourceRowCount: 0,
    officialGameStatusCount: 0,
    blankGameStatusCount: 0,
    matched: 0,
    updated: 0,
    unchanged: 0,
    skippedManual: 0,
    skippedKickoff: 0,
    failed: partial.failed ?? 0,
    questionable: 0,
    doubtful: 0,
    out: 0,
    unmatched: 0,
    ambiguous: 0,
    matches: [],
    skippedNonFantasy: 0,
  };
}

export async function getLastInjurySyncAt(weekId: string): Promise<Date | null> {
  const row = await prisma.adminAuditLog.findFirst({
    where: {
      action: "week_status.injury_synced",
      entityType: "Week",
      entityId: weekId,
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}
