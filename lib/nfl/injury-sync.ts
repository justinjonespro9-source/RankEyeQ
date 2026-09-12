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
  fetchCbsInjuryRows,
  fetchNflComInjuryRows,
  type FetchLike,
} from "@/lib/providers/nfl/nflcom/fetch-injuries";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

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
      next: EntryAvailability;
      changed: boolean;
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
  source: "nfl.com" | "cbs" | "none";
  sourceUrl: string;
  syncedAt: Date;
  matched: number;
  updated: number;
  unchanged: number;
  questionable: number;
  doubtful: number;
  out: number;
  unmatched: number;
  ambiguous: number;
  errors: string[];
  matches: InjurySyncMatch[];
  skippedNonFantasy: number;
};

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
  return {
    status: "matched",
    row,
    entryId: entry.id,
    entryName: entry.name,
    previous: entry.availability,
    next,
    changed: next !== entry.availability,
  };
}

/**
 * Merge CBS fallback rows only for players missing from NFL.com matches.
 * Conflicting designations are left unmatched for admin review (not auto-applied).
 */
export function mergeCbsFallback(input: {
  nflRows: ParsedInjuryRow[];
  cbsRows: ParsedInjuryRow[];
}): { rows: ParsedInjuryRow[]; conflicts: ParsedInjuryRow[] } {
  const byKey = new Map<string, ParsedInjuryRow>();
  for (const row of input.nflRows) {
    byKey.set(`${normalizePlayerName(row.name)}|${row.team}`, row);
  }
  const conflicts: ParsedInjuryRow[] = [];
  const extras: ParsedInjuryRow[] = [];
  for (const row of input.cbsRows) {
    if (row.team === "UNK") continue;
    const key = `${normalizePlayerName(row.name)}|${row.team}`;
    const existing = byKey.get(key);
    if (!existing) {
      extras.push(row);
      continue;
    }
    if (
      existing.gameStatus &&
      row.gameStatus &&
      existing.gameStatus !== row.gameStatus
    ) {
      conflicts.push(row);
    }
  }
  return { rows: [...input.nflRows, ...extras], conflicts };
}

export async function syncWeekInjuriesFromNflCom(input: {
  weekId: string;
  apply?: boolean;
  fetchFn?: FetchLike;
  nflHtml?: string;
  cbsHtml?: string;
  useCbsFallback?: boolean;
}): Promise<InjurySyncSummary> {
  const apply = input.apply !== false;
  const errors: string[] = [];
  let source: InjurySyncSummary["source"] = "none";
  let sourceUrl = "";
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
    // Try CBS as sole fallback when NFL.com fails entirely.
    if (input.useCbsFallback !== false) {
      try {
        const cbs = await fetchCbsInjuryRows({
          fetchFn: input.fetchFn,
          html: input.cbsHtml,
        });
        if (cbs.rows.length === 0) {
          return emptySummary({
            ok: false,
            source: "none",
            sourceUrl: "https://www.nfl.com/injuries/",
            syncedAt,
            errors: [
              ...errors,
              "CBS fallback returned no rows — existing statuses left unchanged",
            ],
          });
        }
        nflRows = cbs.rows;
        source = "cbs";
        sourceUrl = cbs.sourceUrl;
        syncedAt = cbs.fetchedAt;
        errors.push("Using CBS Sports injuries as fallback (NFL.com parse failed)");
      } catch (cbsError) {
        return emptySummary({
          ok: false,
          source: "none",
          sourceUrl: "https://www.nfl.com/injuries/",
          syncedAt,
          errors: [
            ...errors,
            cbsError instanceof Error
              ? `CBS fallback failed: ${cbsError.message}`
              : "CBS fallback failed",
            "Existing statuses left unchanged",
          ],
        });
      }
    } else {
      return emptySummary({
        ok: false,
        source: "none",
        sourceUrl: "https://www.nfl.com/injuries/",
        syncedAt,
        errors: [...errors, "Existing statuses left unchanged"],
      });
    }
  }

  let workingRows = nflRows.filter((row) => isInjuryFantasyPosition(row.position));
  const skippedNonFantasy = nflRows.length - workingRows.length;

  if (input.useCbsFallback !== false) {
    try {
      const cbs = await fetchCbsInjuryRows({
        fetchFn: input.fetchFn,
        html: input.cbsHtml,
      });
      if (cbs.rows.length > 0) {
        const merged = mergeCbsFallback({
          nflRows: workingRows,
          cbsRows: cbs.rows.filter((row) => isInjuryFantasyPosition(row.position)),
        });
        workingRows = merged.rows;
        if (merged.conflicts.length > 0) {
          errors.push(
            `${merged.conflicts.length} CBS/NFL.com status conflicts left for admin review`,
          );
        }
        if (source === "nfl.com" && merged.rows.length > nflRows.length) {
          // still nfl.com primary
        } else if (nflRows.length === 0 && cbs.rows.length > 0) {
          source = "cbs";
          sourceUrl = cbs.sourceUrl;
        }
      }
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `CBS fallback failed: ${error.message}`
          : "CBS fallback failed",
      );
    }
  }

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
    if (!match.changed) {
      unchanged += 1;
      continue;
    }
    if (apply) {
      await prisma.rankableEntry.update({
        where: { id: match.entryId },
        data: { availability: match.next },
      });
    }
    updated += 1;
  }

  return {
    ok: errors.length === 0 || matched > 0,
    source,
    sourceUrl,
    syncedAt,
    matched,
    updated,
    unchanged,
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
}): InjurySyncSummary {
  return {
    ...partial,
    matched: 0,
    updated: 0,
    unchanged: 0,
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
