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

/** Numbered lists plus tab-delimited rank/player columns. First rank wins. */
export function parseRankingPaste(text: string): ParsedRankLine[] {
  const numbered = parseNumberedRankingLines(text);
  const tabulated = parseTabDelimitedRankingLines(text);
  const byRank = new Map<number, ParsedRankLine>();
  for (const row of [...numbered, ...tabulated]) {
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
  /** Broader player universe used to distinguish unknown vs ineligible. */
  universe?: EligibleParserEntry[];
  /** Same-name matches at other positions (wrong_position vs unknown). */
  otherPositions?: EligibleParserEntry[];
}): ParsedPickPreview[] {
  const seenRanks = new Map<number, number>();
  const seenPlayers = new Map<string, number>();
  const previews: ParsedPickPreview[] = [];

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

    previews.push({
      rank: line.rank,
      rawName: line.rawName,
      matchedEntryId,
      matchedName,
      issue,
      candidates: matches.map((entry) => ({ id: entry.id, name: entry.name })),
    });
  }

  for (let rank = 1; rank <= input.rankingDepth; rank += 1) {
    if (!seenRanks.has(rank)) {
      previews.push({
        rank,
        rawName: "",
        matchedEntryId: null,
        matchedName: null,
        issue: "missing_rank",
        candidates: [],
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
