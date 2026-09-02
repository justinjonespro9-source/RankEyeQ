import type { ContestPosition, RankableEntry } from "@/lib/generated/prisma/client";
import { rankableEntryMatchesImportName } from "@/lib/nfl/player-aliases";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

const SUFFIX_PATTERN = /\b(jr\.?|sr\.?|ii|iii|iv|v)\s*$/i;

export type ParsedPlayerIdentity = {
  displayName: string;
  baseKey: string;
  suffixKey: string | null;
};

/** Parse a display name into stable identity parts (suffix preserved separately). */
export function parsePlayerNameIdentity(name: string): ParsedPlayerIdentity {
  let cleaned = name
    .trim()
    .replace(/[*_`~]/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");

  let suffixKey: string | null = null;
  const suffixMatch = cleaned.match(SUFFIX_PATTERN);
  if (suffixMatch?.[1]) {
    suffixKey = suffixMatch[1].toLowerCase().replace(/\./g, "");
    cleaned = cleaned.replace(SUFFIX_PATTERN, "").trim();
  }

  const baseKey = cleaned
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    displayName: name.trim(),
    baseKey,
    suffixKey,
  };
}

/**
 * Fuzzy normalized name (suffix included when present).
 * Used for duplicate detection in pools and legacy parser compatibility.
 */
export function normalizePlayerName(value: string): string {
  const { baseKey, suffixKey } = parsePlayerNameIdentity(value);
  return suffixKey ? `${baseKey} ${suffixKey}`.trim() : baseKey;
}

/** Stable key for grouping likely-same players at a position. */
export function playerIdentityGroupKey(name: string, position: ContestPosition): string {
  const identity = parsePlayerNameIdentity(name);
  const suffix = identity.suffixKey ?? "";
  return `${position}|${identity.baseKey}|${suffix}`;
}

/**
 * Whether two names may refer to the same real player without provider IDs.
 * Suffix-aware: will not match Brian Robinson vs Brian Robinson Jr.
 * Allows Sr-only omission (Aaron Jones vs Aaron Jones Sr.).
 */
export function playerNamesCanMerge(a: string, b: string): boolean {
  const left = parsePlayerNameIdentity(a);
  const right = parsePlayerNameIdentity(b);
  if (left.baseKey !== right.baseKey) return false;
  if (left.suffixKey === right.suffixKey) return true;

  const suffixes = new Set(
    [left.suffixKey, right.suffixKey].filter(
      (value): value is string => Boolean(value),
    ),
  );
  if (suffixes.size === 1 && suffixes.has("sr")) return true;
  return false;
}

export function pickPreferredRankableEntry(
  candidates: RankableEntry[],
  externalId?: string | null,
): RankableEntry | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  if (externalId) {
    const bySlug = candidates.find(
      (entry) =>
        entry.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
        entry.externalId === externalId,
    );
    if (bySlug) return bySlug;
  }

  const nflcom = candidates.filter(
    (entry) => entry.provider === NFL_COM_BOOTSTRAP_PROVIDER,
  );
  if (nflcom.length === 1) return nflcom[0]!;
  if (nflcom.length > 1) {
    return (
      nflcom.find((entry) => entry.externalId === externalId) ??
      nflcom.find((entry) => entry.active) ??
      nflcom[0] ??
      null
    );
  }

  const active = candidates.filter((entry) => entry.active);
  if (active.length >= 1) {
    return (
      active.find((entry) => entry.provider === "manual") ??
      active.find((entry) => entry.provider === "mock") ??
      active[0] ??
      null
    );
  }

  return candidates[0] ?? null;
}

export type PlayerMatchInput = {
  externalId: string;
  name: string;
  team: string;
  fantasyPosition: ContestPosition;
};

export type PlayerMatchResult =
  | { kind: "matched"; entry: RankableEntry; strategy: string }
  | { kind: "ambiguous"; candidates: RankableEntry[] }
  | { kind: "create" };

export function scoreIdentityCandidate(
  entry: RankableEntry,
  input: PlayerMatchInput,
): number {
  let score = 0;
  if (
    entry.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
    entry.externalId === input.externalId
  ) {
    score += 100;
  } else if (entry.externalId === input.externalId) {
    score += 80;
  }
  if (entry.provider === NFL_COM_BOOTSTRAP_PROVIDER) score += 20;
  if (entry.active) score += 10;
  if (entry.team === input.team) score += 5;
  if (entry.name === input.name) score += 3;
  if (rankableEntryMatchesImportName(entry, input.name)) score += 15;
  return score;
}

export function resolvePlayerMatchFromCandidates(
  candidates: RankableEntry[],
  input: PlayerMatchInput,
): PlayerMatchResult {
  const mergeable = candidates.filter(
    (entry) =>
      entry.position === input.fantasyPosition &&
      rankableEntryMatchesImportName(entry, input.name),
  );

  if (mergeable.length === 0) {
    return { kind: "create" };
  }

  const byExternal = mergeable.find(
    (entry) =>
      entry.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
      entry.externalId === input.externalId,
  );
  if (byExternal) {
    return { kind: "matched", entry: byExternal, strategy: "externalId" };
  }

  const byAnyExternal = mergeable.find(
    (entry) => entry.externalId === input.externalId,
  );
  if (byAnyExternal) {
    return { kind: "matched", entry: byAnyExternal, strategy: "sharedExternalId" };
  }

  const preferred = pickPreferredRankableEntry(mergeable, input.externalId);
  if (preferred) {
    const competing = mergeable.filter(
      (entry) =>
        entry.id !== preferred.id &&
        entry.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
        entry.active,
    );
    if (competing.length > 0) {
      return { kind: "ambiguous", candidates: mergeable };
    }
    return {
      kind: "matched",
      entry: preferred,
      strategy:
        preferred.provider === NFL_COM_BOOTSTRAP_PROVIDER
          ? "nflcomIdentity"
          : "legacyIdentity",
    };
  }

  return { kind: "ambiguous", candidates: mergeable };
}
