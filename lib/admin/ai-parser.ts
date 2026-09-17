import {
  parserEntryMatchesRawName,
  parsePlayerAliases,
} from "@/lib/nfl/player-aliases";

export type EligibleParserEntry = {
  id: string;
  name: string;
  team: string;
  shortName?: string | null;
  aliases?: string[];
};

export function toEligibleParserEntry(row: {
  id: string;
  name: string;
  team: string;
  shortName?: string | null;
  adminNotes?: string | null;
}): EligibleParserEntry {
  return {
    id: row.id,
    name: row.name,
    team: row.team,
    shortName: row.shortName,
    aliases: parsePlayerAliases(row.adminNotes),
  };
}

export type ParsedRankLine = {
  rank: number;
  rawName: string;
};

export type ParserIssue =
  | "unknown"
  | "ambiguous"
  | "ineligible"
  | "wrong_position"
  | "duplicate_player"
  | "duplicate_rank"
  | "missing_rank"
  | "too_many";

export type ParsedPickPreview = {
  rank: number;
  rawName: string;
  matchedEntryId: string | null;
  matchedName: string | null;
  issue: ParserIssue | null;
  candidates: Array<{ id: string; name: string }>;
  /** True when rank is beyond scoring depth (ordered reserve). */
  isReserve?: boolean;
  reserveSlot?: number | null;
};

import {
  normalizePlayerName,
} from "@/lib/nfl/player-identity";

export { normalizePlayerName } from "@/lib/nfl/player-identity";

function cleanParsedName(value: string) {
  return value
    .replace(/^[-*+]\s+/, "")
    .replace(/\*\*(.+)\*\*/, "$1")
    .replace(/__(.+)__/, "$1")
    .replace(/\s+\(.*\)$/, "")
    .trim();
}

export function parseNumberedRankingLines(text: string): ParsedRankLine[] {
  const lines: ParsedRankLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(
      /^(?:#{1,6}\s*)?(?:\d+)\s*(?:[\.\)\:\-\]]\s+|\s+)(.+)$/,
    );
    if (!match) continue;
    const rankMatch = line.match(/(\d+)/);
    if (!rankMatch) continue;
    const rank = Number(rankMatch[1]);
    if (!Number.isInteger(rank) || rank < 1) continue;
    const rawName = cleanParsedName(match[1]);
    if (!rawName) continue;
    lines.push({ rank, rawName });
  }
  return lines;
}

const HEADER_TOKENS = new Set(["rank", "player", "name", "pos", "position", "team"]);

export function parseTabDelimitedRankingLines(text: string): ParsedRankLine[] {
  const lines: ParsedRankLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.includes("\t")) continue;
    const cols = rawLine
      .split("\t")
      .map((col) => col.trim())
      .filter(Boolean);
    if (cols.length < 2) continue;
    const headerish = cols.every((col) => HEADER_TOKENS.has(col.toLowerCase()));
    if (headerish) continue;

    const rankCol = cols.findIndex((col) => /^\d+$/.test(col));
    if (rankCol < 0) continue;
    const rank = Number(cols[rankCol]);
    if (!Number.isInteger(rank) || rank < 1) continue;

    const nameCol = cols.find((col, index) => {
      if (index === rankCol) return false;
      if (/^\d+$/.test(col)) return false;
      if (HEADER_TOKENS.has(col.toLowerCase())) return false;
      if (col.length < 2) return false;
      return /[a-zA-Z]/.test(col);
    });
    if (!nameCol) continue;
    const rawName = cleanParsedName(nameCol);
    if (!rawName) continue;
    lines.push({ rank, rawName });
  }
  return lines;
}

export function parseCommaCsvRankingLines(text: string): ParsedRankLine[] {
  const lines: ParsedRankLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes(",")) continue;
    const cols = line.split(",").map((col) => col.trim().replace(/^"|"$/g, ""));
    if (cols.length < 2) continue;
    const headerish = cols.every((col) => HEADER_TOKENS.has(col.toLowerCase()));
    if (headerish) continue;

    const rankCol = cols.findIndex((col) => /^\d+$/.test(col));
    if (rankCol < 0) continue;
    const rank = Number(cols[rankCol]);
    if (!Number.isInteger(rank) || rank < 1) continue;

    const nameCol = cols.find((col, index) => {
      if (index === rankCol) return false;
      if (/^\d+$/.test(col)) return false;
      if (HEADER_TOKENS.has(col.toLowerCase())) return false;
      if (col.length < 2) return false;
      return /[a-zA-Z]/.test(col);
    });
    if (!nameCol) continue;
    const rawName = cleanParsedName(nameCol);
    if (!rawName) continue;
    lines.push({ rank, rawName });
  }
  return lines;
}

/**
 * Unnumbered ordered list — document order becomes rank 1..N.
 * Skips when numbered/CSV/tab rows already dominate the paste.
 */
export function parsePlainOrderedRankingLines(text: string): ParsedRankLine[] {
  const lines: ParsedRankLine[] = [];
  let rank = 1;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(?:#{1,6}\s*)?\d+\s*(?:[\.\)\:\-\]]\s+|\s+)/.test(line)) continue;
    if (line.includes("\t")) continue;
    if (/^\d+\s*,/.test(line)) continue;
    if (/^(rank|player|name)\b/i.test(line)) continue;
    if (/^tier\s*\d+/i.test(line)) continue;
    if (/^(qb|rb|wr|te|def)\s*$/i.test(line)) continue;
    // Reject bare section headers / bullets that are not names
    if (/^[-*•]\s*$/.test(line)) continue;

    const cleaned = cleanParsedName(line.replace(/^[-*•]\s+/, ""));
    if (!cleaned || cleaned.length < 2) continue;
    if (!/[a-zA-Z]/.test(cleaned)) continue;
    lines.push({ rank, rawName: cleaned });
    rank += 1;
  }
  return lines;
}

/** Numbered lists, CSV, tab-delimited, then plain ordered names. First rank wins. */
export function parseRankingPaste(text: string): ParsedRankLine[] {
  const numbered = parseNumberedRankingLines(text);
  const tabulated = parseTabDelimitedRankingLines(text);
  const csv = parseCommaCsvRankingLines(text);
  const structured = [...numbered, ...tabulated, ...csv];
  const plain =
    structured.length === 0 ? parsePlainOrderedRankingLines(text) : [];
  const byRank = new Map<number, ParsedRankLine>();
  for (const row of [...structured, ...plain]) {
    if (!byRank.has(row.rank)) byRank.set(row.rank, row);
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

function lastToken(name: string) {
  const parts = normalizePlayerName(name).split(" ");
  return parts[parts.length - 1] ?? "";
}

export function findNameMatches(rawName: string, entries: EligibleParserEntry[]) {
  const needle = normalizePlayerName(rawName);
  if (!needle) return [];

  const exact = entries.filter((entry) => parserEntryMatchesRawName(entry, rawName));
  if (exact.length > 0) return exact;

  const short = entries.filter(
    (entry) =>
      entry.shortName && normalizePlayerName(entry.shortName) === needle,
  );
  if (short.length === 1) return short;

  const last = lastToken(rawName);
  if (last.length >= 3) {
    const lastMatches = entries.filter((entry) => lastToken(entry.name) === last);
    if (lastMatches.length > 0) return lastMatches;
  }

  const contains = entries.filter((entry) => {
    const hay = normalizePlayerName(entry.name);
    return hay.includes(needle) || needle.includes(hay);
  });
  return contains;
}

export function matchParsedRankings(input: {
  lines: ParsedRankLine[];
  eligible: EligibleParserEntry[];
  rankingDepth: number;
  /** Scoring board size; ranks above this are labeled reserves. Defaults to rankingDepth. */
  scoringDepth?: number;
  /** Broader player universe used to distinguish unknown vs ineligible. */
  universe?: EligibleParserEntry[];
  /** Same-name matches at other positions (wrong_position vs unknown). */
  otherPositions?: EligibleParserEntry[];
}): ParsedPickPreview[] {
  const seenRanks = new Map<number, number>();
  const seenPlayers = new Map<string, number>();
  const previews: ParsedPickPreview[] = [];
  const scoringDepth = input.scoringDepth ?? input.rankingDepth;

  for (const line of input.lines) {
    const matches = findNameMatches(line.rawName, input.eligible);
    const universeMatches = input.universe
      ? findNameMatches(line.rawName, input.universe)
      : [];
    let issue: ParserIssue | null = null;
    let matchedEntryId: string | null = null;
    let matchedName: string | null = null;

    if (seenRanks.has(line.rank)) issue = "duplicate_rank";
    else seenRanks.set(line.rank, 1);

    if (matches.length === 0) {
      const otherPositionMatches = input.otherPositions
        ? findNameMatches(line.rawName, input.otherPositions)
        : [];
      issue =
        issue ??
        (otherPositionMatches.length > 0
          ? "wrong_position"
          : universeMatches.length > 0
            ? "ineligible"
            : "unknown");
    } else if (matches.length > 1) {
      issue = issue ?? "ambiguous";
    } else {
      matchedEntryId = matches[0].id;
      matchedName = matches[0].name;
      if (seenPlayers.has(matchedEntryId)) issue = issue ?? "duplicate_player";
      else seenPlayers.set(matchedEntryId, line.rank);
    }

    if (line.rank > input.rankingDepth) {
      issue = "too_many";
    }

    const isReserve = line.rank > scoringDepth && line.rank <= input.rankingDepth;
    previews.push({
      rank: line.rank,
      rawName: line.rawName,
      matchedEntryId,
      matchedName,
      issue,
      candidates: matches.map((entry) => ({ id: entry.id, name: entry.name })),
      isReserve,
      reserveSlot: isReserve ? line.rank - scoringDepth : null,
    });
  }

  for (let rank = 1; rank <= input.rankingDepth; rank += 1) {
    if (!seenRanks.has(rank)) {
      const isReserve = rank > scoringDepth;
      previews.push({
        rank,
        rawName: "",
        matchedEntryId: null,
        matchedName: null,
        issue: "missing_rank",
        candidates: [],
        isReserve,
        reserveSlot: isReserve ? rank - scoringDepth : null,
      });
    }
  }

  return previews.sort((a, b) => a.rank - b.rank);
}

export function previewIsReadyToSubmit(
  preview: ParsedPickPreview[],
  rankingDepth: number,
) {
  if (preview.some((row) => row.issue)) return false;
  const ids = preview
    .filter((row) => row.rank >= 1 && row.rank <= rankingDepth)
    .map((row) => row.matchedEntryId);
  return (
    ids.length === rankingDepth &&
    ids.every((id): id is string => Boolean(id)) &&
    new Set(ids).size === rankingDepth
  );
}

export function previewToRankedIds(
  preview: ParsedPickPreview[],
  rankingDepth: number,
): (string | null)[] {
  const slots: (string | null)[] = Array.from(
    { length: rankingDepth },
    () => null,
  );
  for (const row of preview) {
    if (row.rank >= 1 && row.rank <= rankingDepth) {
      slots[row.rank - 1] = row.matchedEntryId;
    }
  }
  return slots;
}

export type ImmutableLockedPick = {
  /** 1-based board slot that must remain fixed. */
  rank: number;
  rankableEntryId: string;
};

export type UniversalMergeResult =
  | {
      ok: true;
      rankedEntryIds: string[];
      filledUnlocked: number;
      preservedLocks: number;
      skippedDuplicateLocks: number;
      skippedKickedOff: number;
      truncated: number;
    }
  | {
      ok: false;
      error: string;
      rankedEntryIds: (string | null)[];
      filledUnlocked: number;
      preservedLocks: number;
      skippedDuplicateLocks: number;
      skippedKickedOff: number;
      truncated: number;
    };

/**
 * Merge a universal model response (ordered selectable players) into a
 * profile board that may already have immutable kickoff-locked picks.
 *
 * - Preserves locked picks in their original slots
 * - Fills only unlocked slots from the response order
 * - Skips duplicates of locked players and kicked-off IDs
 * - Truncates excess response players safely
 * - Rejects when the merged board cannot be completed
 */
export function mergeUniversalRankingIntoLockedBoard(input: {
  submissionDepth: number;
  lockedPicks: ImmutableLockedPick[];
  orderedResponseIds: string[];
  kickedOffIds?: Iterable<string>;
}): UniversalMergeResult {
  const depth = input.submissionDepth;
  const slots: (string | null)[] = Array.from({ length: depth }, () => null);
  const kickedOff = new Set(input.kickedOffIds ?? []);
  let preservedLocks = 0;
  let skippedDuplicateLocks = 0;
  let skippedKickedOff = 0;
  let truncated = 0;

  const used = new Set<string>();
  for (const pick of input.lockedPicks) {
    if (pick.rank < 1 || pick.rank > depth) {
      return {
        ok: false,
        error: `Locked pick rank ${pick.rank} is outside the ${depth}-player board`,
        rankedEntryIds: slots,
        filledUnlocked: 0,
        preservedLocks,
        skippedDuplicateLocks,
        skippedKickedOff,
        truncated,
      };
    }
    const index = pick.rank - 1;
    if (slots[index] != null && slots[index] !== pick.rankableEntryId) {
      return {
        ok: false,
        error: `Two locked picks claim slot #${pick.rank}`,
        rankedEntryIds: slots,
        filledUnlocked: 0,
        preservedLocks,
        skippedDuplicateLocks,
        skippedKickedOff,
        truncated,
      };
    }
    if (used.has(pick.rankableEntryId) && slots[index] !== pick.rankableEntryId) {
      return {
        ok: false,
        error: `Locked player appears in multiple slots`,
        rankedEntryIds: slots,
        filledUnlocked: 0,
        preservedLocks,
        skippedDuplicateLocks,
        skippedKickedOff,
        truncated,
      };
    }
    slots[index] = pick.rankableEntryId;
    used.add(pick.rankableEntryId);
    preservedLocks += 1;
  }

  let filledUnlocked = 0;
  for (const id of input.orderedResponseIds) {
    if (!id) continue;
    if (used.has(id)) {
      skippedDuplicateLocks += 1;
      continue;
    }
    if (kickedOff.has(id)) {
      skippedKickedOff += 1;
      continue;
    }
    const emptyIndex = slots.findIndex((slot) => slot == null);
    if (emptyIndex < 0) {
      truncated += 1;
      continue;
    }
    slots[emptyIndex] = id;
    used.add(id);
    filledUnlocked += 1;
  }

  const incomplete = slots.some((slot) => slot == null);
  if (incomplete) {
    return {
      ok: false,
      error: `Merged board incomplete (${slots.filter(Boolean).length}/${depth} slots). Need more selectable players after preserving locks.`,
      rankedEntryIds: slots,
      filledUnlocked,
      preservedLocks,
      skippedDuplicateLocks,
      skippedKickedOff,
      truncated,
    };
  }

  return {
    ok: true,
    rankedEntryIds: slots as string[],
    filledUnlocked,
    preservedLocks,
    skippedDuplicateLocks,
    skippedKickedOff,
    truncated,
  };
}

/**
 * Collect ordered matched entry IDs from a universal paste.
 * Skips unresolved / duplicate / kicked-off lines rather than failing the whole paste.
 */
export function orderedMatchedIdsFromUniversalPaste(input: {
  text: string;
  eligible: EligibleParserEntry[];
  kickedOffIds?: Iterable<string>;
}): string[] {
  const kickedOff = new Set(input.kickedOffIds ?? []);
  const lines = parseRankingPaste(input.text);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const matches = findNameMatches(line.rawName, input.eligible);
    if (matches.length !== 1) continue;
    const id = matches[0].id;
    if (seen.has(id) || kickedOff.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}
