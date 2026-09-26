import { prisma } from "@/lib/db";
import type {
  ContestPosition,
  EntryAvailability,
  WeeklyAvailabilityDesignation,
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
  derivePracticeTier,
  entryAvailabilityFromInjuryGameStatus,
  PRESERVED_OFFICIAL_DESIGNATIONS,
  ROSTER_UNAVAILABLE_ENTRY,
  type PracticeTier,
  type WeeklyDesignation,
} from "@/lib/eligibility/player-week-availability";
import {
  updateInjuryContextPreservingOverride,
  upsertPlayerWeekAvailability,
} from "@/lib/eligibility/player-week-availability-store";

export type InjuryMatchCandidate = {
  id: string;
  name: string;
  team: string;
  position: ContestPosition;
  score: "exact" | "alias" | "fuzzy";
};

export type InjurySyncChangeKind =
  | "designation"
  | "practice_context"
  | "injury_description"
  | "unchanged"
  | "unmatched"
  | "ambiguous"
  | "skipped_override_context"
  | "skipped_kickoff"
  | "skipped_manual";

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
      /** Proposed PWA designation after blank-GS / official-GS rules. */
      proposedDesignation?: WeeklyDesignation;
      proposedPracticeStatus?: string | null;
      proposedInjuryDescription?: string | null;
      changeKind?: InjurySyncChangeKind;
    }
  | {
      status: "unmatched";
      row: ParsedInjuryRow;
      suggestions: InjuryMatchCandidate[];
      changeKind?: InjurySyncChangeKind;
    }
  | {
      status: "ambiguous";
      row: ParsedInjuryRow;
      suggestions: InjuryMatchCandidate[];
      changeKind?: InjurySyncChangeKind;
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
  /** Preview/Sync classification (proposed or applied). */
  designationChanges: number;
  practiceContextOnlyChanges: number;
  injuryDescriptionOnlyChanges: number;
  practiceTierCounts: Record<PracticeTier, number>;
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
    "Proposed / applied changes:",
    `${summary.designationChanges} official designation changes`,
    `${summary.practiceContextOnlyChanges} practice-context-only`,
    `${summary.injuryDescriptionOnlyChanges} injury-description-only`,
    `${summary.unchanged} unchanged`,
    "",
    "Practice tiers (matched fantasy):",
    `DNP ${summary.practiceTierCounts.DNP} · Limited ${summary.practiceTierCounts.LIMITED} · Full ${summary.practiceTierCounts.FULL} · Unknown ${summary.practiceTierCounts.UNKNOWN}`,
    "",
    `Updated: ${summary.updated}`,
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

type ExistingPwa = {
  designation: WeeklyAvailabilityDesignation;
  injuryDescription: string | null;
  practiceStatus: string | null;
  manualOverride: boolean;
  sourceType: string;
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
      changeKind: "ambiguous",
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
      changeKind: "ambiguous",
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

  return {
    status: "unmatched",
    row,
    suggestions: fuzzy,
    changeKind: "unmatched",
  };
}

function buildMatched(
  row: ParsedInjuryRow,
  entry: RankableCandidate,
): InjurySyncMatch {
  const next = nextAvailabilityFromInjuryRow({
    gameStatus: row.gameStatus,
    current: entry.availability,
  });
  const missingGameStatus = row.gameStatus == null;
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
 * Resolve PWA designation for an injury row without inventing Q/D/OUT from practice.
 * Blank Game Status never clears a stronger existing official designation.
 */
export function resolveInjurySyncDesignation(input: {
  gameStatus: ParsedInjuryRow["gameStatus"];
  existingDesignation: WeeklyDesignation | null;
}): WeeklyDesignation {
  if (input.gameStatus) {
    return entryAvailabilityFromInjuryGameStatus(input.gameStatus);
  }
  // Blank GS: preserve stronger official designation if present.
  if (
    input.existingDesignation &&
    PRESERVED_OFFICIAL_DESIGNATIONS.has(input.existingDesignation)
  ) {
    return input.existingDesignation;
  }
  return "UNKNOWN";
}

export function classifyInjuryContextChange(input: {
  existing: ExistingPwa | null;
  proposedDesignation: WeeklyDesignation;
  proposedPractice: string | null;
  proposedInjury: string | null;
}): InjurySyncChangeKind {
  const prevDes = input.existing?.designation ?? null;
  const prevPractice = input.existing?.practiceStatus ?? null;
  const prevInjury = input.existing?.injuryDescription ?? null;
  // null/absent → UNKNOWN is practice-context persistence, not an official GS change.
  const priorEffective = prevDes ?? "UNKNOWN";
  const desChanged = priorEffective !== input.proposedDesignation;
  const practiceChanged = prevPractice !== input.proposedPractice;
  const injuryChanged = prevInjury !== input.proposedInjury;

  if (!desChanged && !practiceChanged && !injuryChanged) return "unchanged";
  if (desChanged) return "designation";
  if (practiceChanged && !injuryChanged) return "practice_context";
  if (injuryChanged && !practiceChanged) return "injury_description";
  // Both practice + injury changed, designation same → practice_context bucket
  // (primary V2.1 signal); injury-only is reserved for injury-only diffs.
  return "practice_context";
}

/**
 * Sync weekly injury designations from NFL.com official injuries page only.
 * Third-party sources (including CBS) are not used.
 * Failed fetch/parse leaves existing designations and overrides unchanged.
 *
 * V2.1: blank Game Status may persist practiceStatus + injuryDescription with
 * designation UNKNOWN (or preserved stronger designation). Practice never
 * implies Q/D/OUT.
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

  const existingRows = await prisma.playerWeekAvailability.findMany({
    where: {
      weekId: input.weekId,
      rankableEntryId: { in: [...poolMap.keys()] },
    },
    select: {
      rankableEntryId: true,
      designation: true,
      injuryDescription: true,
      practiceStatus: true,
      manualOverride: true,
      sourceType: true,
    },
  });
  const existingById = new Map(
    existingRows.map((row) => [
      row.rankableEntryId,
      row as ExistingPwa & { rankableEntryId: string },
    ]),
  );

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
  let designationChanges = 0;
  let practiceContextOnlyChanges = 0;
  let injuryDescriptionOnlyChanges = 0;
  const practiceTierCounts: Record<PracticeTier, number> = {
    DNP: 0,
    LIMITED: 0,
    FULL: 0,
    UNKNOWN: 0,
  };

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

    const existing = existingById.get(match.entryId) ?? null;
    const proposedPractice = match.row.practiceStatus?.trim() || null;
    const proposedInjury = match.row.injury?.trim() || null;
    const proposedDesignation = resolveInjurySyncDesignation({
      gameStatus: match.row.gameStatus,
      existingDesignation: (existing?.designation as WeeklyDesignation) ?? null,
    });

    match.proposedDesignation = proposedDesignation;
    match.proposedPracticeStatus = proposedPractice;
    match.proposedInjuryDescription = proposedInjury;

    const tier = derivePracticeTier(proposedPractice);
    if (tier) practiceTierCounts[tier] += 1;

    if (match.next === "QUESTIONABLE" || proposedDesignation === "QUESTIONABLE") {
      if (match.row.gameStatus === "QUESTIONABLE") questionable += 1;
    }
    if (match.next === "DOUBTFUL" || proposedDesignation === "DOUBTFUL") {
      if (match.row.gameStatus === "DOUBTFUL") doubtful += 1;
    }
    if (match.next === "OUT" || proposedDesignation === "OUT") {
      if (match.row.gameStatus === "OUT") out += 1;
    }

    const changeKind = classifyInjuryContextChange({
      existing,
      proposedDesignation,
      proposedPractice,
      proposedInjury,
    });
    match.changeKind = changeKind;

    if (changeKind === "unchanged") {
      unchanged += 1;
      continue;
    }
    if (changeKind === "designation") designationChanges += 1;
    if (changeKind === "practice_context") practiceContextOnlyChanges += 1;
    if (changeKind === "injury_description") injuryDescriptionOnlyChanges += 1;

    // Admin override: never touch designation/provenance; optional context only.
    if (existing?.manualOverride) {
      if (!apply) {
        skippedManual += 1;
        match.changeKind = "skipped_override_context";
        // Still count as proposed context refresh for Preview visibility.
        updated += 1;
        continue;
      }
      try {
        const result = await updateInjuryContextPreservingOverride({
          weekId: input.weekId,
          rankableEntryId: match.entryId,
          injuryDescription: proposedInjury,
          practiceStatus: proposedPractice,
          observedAt: syncedAt,
        });
        if (result.status === "updated_context_only") {
          updated += 1;
          match.changeKind = "skipped_override_context";
        } else {
          unchanged += 1;
          // Roll back change bucket if nothing wrote.
          if (changeKind === "designation") designationChanges -= 1;
          if (changeKind === "practice_context") practiceContextOnlyChanges -= 1;
          if (changeKind === "injury_description") {
            injuryDescriptionOnlyChanges -= 1;
          }
        }
        skippedManual += 1;
      } catch (error) {
        failed += 1;
        errors.push(
          error instanceof Error
            ? `Failed context update ${match.entryName}: ${error.message}`
            : `Failed context update ${match.entryName}`,
        );
      }
      continue;
    }

    if (!apply) {
      updated += 1;
      continue;
    }

    try {
      // Roster-unavailable EntryAvailability only when official GS maps to it
      // (should not happen for Q/D/OUT path). Keep prior behavior for IR-as-GS.
      if (match.next && ROSTER_UNAVAILABLE_ENTRY.has(match.next)) {
        await prisma.rankableEntry.update({
          where: { id: match.entryId },
          data: { availability: match.next },
        });
        updated += 1;
        continue;
      }

      const result = await upsertPlayerWeekAvailability({
        weekId: input.weekId,
        rankableEntryId: match.entryId,
        designation: proposedDesignation,
        injuryDescription: proposedInjury,
        practiceStatus: proposedPractice,
        sourceUrl,
        sourcePublishedAt: syncedAt,
        observedAt: syncedAt,
        sourceType: "NFL_SYNC",
        respectManualOverride: true,
        skipAfterKickoff: true,
        skipRankableMirrorWhenDesignationUnchanged: true,
        now: syncedAt,
      });
      if (result.status === "skipped_override") {
        skippedManual += 1;
        continue;
      }
      if (result.status === "skipped_kickoff") {
        skippedKickoff += 1;
        match.changeKind = "skipped_kickoff";
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
    designationChanges,
    practiceContextOnlyChanges,
    injuryDescriptionOnlyChanges,
    practiceTierCounts,
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
    designationChanges: 0,
    practiceContextOnlyChanges: 0,
    injuryDescriptionOnlyChanges: 0,
    practiceTierCounts: { DNP: 0, LIMITED: 0, FULL: 0, UNKNOWN: 0 },
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
