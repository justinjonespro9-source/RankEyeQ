import { NFL_TEAMS } from "@/lib/nfl-schedule";
import { CANONICAL_NFL_TEAM_ABBRS, normalizeTeamAbbr, splitDelimitedLine } from "@/lib/nfl/manual/parse-common";
import { playerNamesCanMerge } from "@/lib/nfl/player-identity";
import {
  cleanRankedListName,
  isRankedListHeaderRow,
  matchNumberedRankedLine,
  pickRankedListColumns,
} from "@/lib/text/ranked-list-lines";
import { WAIVEREYEQ_AI_PARSER_VERSION, WAIVER_AI_RESPONSE_MAX_BYTES } from "@/lib/waivers/ai/constants";
import { isStorableText, utf8ByteLength } from "@/lib/waivers/ai/text";
import { effectiveMaxCalls } from "@/lib/waivers/board-shape";
import type { WaiverPosition } from "@/lib/waivers/constants";

/**
 * Strict WaiverEyeQ AI response parser. Pure.
 *
 * Accepts numbered lists, plain ordered lines, CSV/TSV/pipe rows and an
 * explicit NO CALLS. Every pick resolves by exact normalized name (suffix
 * aware) against the pinned frozen snapshot only. Any problem rejects the
 * whole response: lines are never skipped, picks are never replaced,
 * reordered or truncated. Only blank lines, code fences, table separators
 * and all-header rows are ignored.
 */

export type WaiverAiFrozenRow = {
  snapshotEntryId: string;
  rankableEntryId: string;
  position: string;
  displayName: string;
  team: string | null;
  /** CANDIDATE evidence row with ELIGIBLE eligibility. */
  eligible: boolean;
};

export type WaiverAiIssueCode =
  | "EMPTY"
  | "TOO_LONG"
  | "INVALID_TEXT"
  | "UNPARSEABLE_LINE"
  | "NO_CALLS_MIXED"
  | "MIXED_NUMBERING"
  | "UNKNOWN_PLAYER"
  | "AMBIGUOUS_PLAYER"
  | "INELIGIBLE_PLAYER"
  | "WRONG_POSITION"
  | "TEAM_MISMATCH"
  | "DUPLICATE_PLAYER"
  | "DUPLICATE_SLOT"
  | "MISSING_SLOT"
  | "OUT_OF_ORDER"
  | "TOO_MANY_CALLS";

export type WaiverAiIssue = { code: WaiverAiIssueCode; lineNumber: number | null; message: string };

export type WaiverAiMatch = {
  snapshotEntryId: string;
  rankableEntryId: string;
  displayName: string;
  team: string | null;
};

export type WaiverAiParsedLine = {
  lineNumber: number;
  text: string;
  kind: "BLANK" | "IGNORED" | "NO_CALLS" | "PICK" | "UNPARSEABLE";
  /** Stated rank for numbered lines; document order for plain lines. */
  slot: number | null;
  rawName: string | null;
  match: WaiverAiMatch | null;
  issues: WaiverAiIssueCode[];
};

export type WaiverAiPick = WaiverAiMatch & { slot: number; lineNumber: number; rawName: string };

export type WaiverAiParseResult = {
  parserVersion: typeof WAIVEREYEQ_AI_PARSER_VERSION;
  ok: boolean;
  noCalls: boolean;
  /** Exact ordered picks; empty unless `ok`. */
  picks: WaiverAiPick[];
  issues: WaiverAiIssue[];
  lines: WaiverAiParsedLine[];
  availableSlots: number;
};

export type WaiverAiParseInput = {
  text: string;
  position: WaiverPosition;
  /** The contest's configured maximum calls. */
  maxCalls: number;
  /** Every row of the pinned snapshot (all positions, roles and eligibility). */
  rows: ReadonlyArray<WaiverAiFrozenRow>;
};

const NO_CALLS = /^[*_`"'\s]*no\s+calls[.!]?[*_`"'\s]*$/i;
const FENCE = /^(```|~~~)/;
const TABLE_SEPARATOR = /^\|?(\s*:?-{3,}:?\s*\|)*\s*:?-{3,}:?\s*\|?$/;
const POSITION_TOKENS: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE", "DEF", "D/ST", "DST"]);
const DEF_SUFFIX = /\s+(?:d\/st|dst|defense\/special teams|team defense|defense|def|d)\.?$/i;

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function defenseKey(value: string): string {
  return key(value.trim().replace(DEF_SUFFIX, ""));
}

function teamKeys(team: string | null): string[] {
  if (!team) return [];
  const abbr = normalizeTeamAbbr(team);
  const named = NFL_TEAMS.find((row) => row.abbr === abbr);
  if (!named) return [key(abbr)];
  const nickname = named.name.split(" ").at(-1) ?? "";
  return [key(abbr), key(named.name), key(nickname)].filter(Boolean);
}

function namesMatch(row: WaiverAiFrozenRow, rawName: string): boolean {
  if (playerNamesCanMerge(row.displayName, rawName)) return true;
  if (row.position !== "DEF") return false;
  const wanted = defenseKey(rawName);
  if (!wanted) return false;
  return defenseKey(row.displayName) === wanted || teamKeys(row.team).includes(wanted);
}

/** A pool line copied from the WAIVEREYEQ_AI_V1 prompt: "Name (BUF, opp. MIA) — rostered 12.00%". */
const PROMPT_POOL_SUFFIX = /\s+[-–—]\s+rostered\s+\d{1,3}(?:\.\d+)?%$/i;
const PROMPT_POOL_TEAM = /^(.*?)\s*\(\s*([A-Za-z]{2,3})(?:\s*,\s*opp\.\s*[A-Za-z]{2,3})?\s*\)$/i;

/** Splits a trailing team annotation ("Name (BUF)", "Name, BUF", "Name - BUF", a copied pool line) off a name. */
function splitTeamAnnotation(value: string): { name: string; team: string | null } {
  const trimmed = value.trim().replace(PROMPT_POOL_SUFFIX, "");
  const pooled = trimmed.match(PROMPT_POOL_TEAM);
  if (pooled) {
    const team = normalizeTeamAbbr(pooled[2]);
    if (CANONICAL_NFL_TEAM_ABBRS.has(team) && pooled[1].trim()) return { name: pooled[1].trim(), team };
  }
  const match = trimmed.match(/^(.*?)(?:\s*\(\s*([A-Za-z]{2,3})\s*\)|\s*,\s*([A-Za-z]{2,3})|\s+[-–—|]\s+([A-Za-z]{2,3}))$/);
  if (match) {
    const team = normalizeTeamAbbr(match[2] ?? match[3] ?? match[4] ?? "");
    if (CANONICAL_NFL_TEAM_ABBRS.has(team) && match[1].trim()) return { name: match[1].trim(), team };
  }
  return { name: trimmed, team: null };
}

type Extracted =
  | { kind: "IGNORED" }
  | { kind: "UNPARSEABLE" }
  | { kind: "PICK"; numbered: boolean; rank: number | null; rawName: string; team: string | null };

function extractLine(line: string): Extracted {
  // Tab and pipe rows are always delimited ("1<TAB>Name<TAB>TEAM" is not a numbered line).
  const numbered = /[\t|]/.test(line) ? null : matchNumberedRankedLine(line);
  if (numbered) {
    const annotated = splitTeamAnnotation(numbered.rawName);
    const rawName = cleanRankedListName(annotated.name);
    if (!rawName || !/[a-z]/i.test(rawName)) return { kind: "UNPARSEABLE" };
    return { kind: "PICK", numbered: true, rank: numbered.rank, rawName, team: annotated.team };
  }
  const cols = /[\t|,]/.test(line) ? splitDelimitedLine(line) : [];
  // "Name, TEAM" is a plain line with a team annotation, not a two-column row.
  const delimited =
    cols.length >= 2 && (/[\t|]/.test(line) || cols.length >= 3 || /^\d+$/.test(cols[0]) || isRankedListHeaderRow(cols));
  if (delimited) {
    if (isRankedListHeaderRow(cols)) return { kind: "IGNORED" };
    const { rank, rawName } = pickRankedListColumns(cols);
    if (!rawName || (rank !== null && rank < 1)) return { kind: "UNPARSEABLE" };
    const rankIndex = cols.findIndex((col) => /^\d+$/.test(col));
    const extras = cols.filter(
      (col, index) =>
        index !== rankIndex && col !== rawName && !CANONICAL_NFL_TEAM_ABBRS.has(normalizeTeamAbbr(col)) && !POSITION_TOKENS.has(col.toUpperCase()),
    );
    if (extras.length > 0) return { kind: "UNPARSEABLE" };
    const team =
      cols.map((col) => normalizeTeamAbbr(col)).find((col, index) => cols[index] !== rawName && CANONICAL_NFL_TEAM_ABBRS.has(col)) ?? null;
    const name = cleanRankedListName(rawName);
    if (!name) return { kind: "UNPARSEABLE" };
    return { kind: "PICK", numbered: rank !== null, rank, rawName: name, team };
  }
  const annotated = splitTeamAnnotation(line.replace(/^[-*•+]\s+/, ""));
  const rawName = cleanRankedListName(annotated.name);
  if (!rawName || rawName.length < 2 || !/[a-z]/i.test(rawName)) return { kind: "UNPARSEABLE" };
  return { kind: "PICK", numbered: false, rank: null, rawName, team: annotated.team };
}

type Resolution = { match: WaiverAiMatch | null; issue: WaiverAiIssueCode | null; message: string | null };

function toMatch(row: WaiverAiFrozenRow): WaiverAiMatch {
  return { snapshotEntryId: row.snapshotEntryId, rankableEntryId: row.rankableEntryId, displayName: row.displayName, team: row.team };
}

function distinctEntries(rows: WaiverAiFrozenRow[]): WaiverAiFrozenRow[] {
  const seen = new Map<string, WaiverAiFrozenRow>();
  for (const row of rows) if (!seen.has(row.rankableEntryId)) seen.set(row.rankableEntryId, row);
  return [...seen.values()];
}

function resolvePick(rawName: string, team: string | null, position: WaiverPosition, rows: ReadonlyArray<WaiverAiFrozenRow>): Resolution {
  const matches = rows.filter((row) => namesMatch(row, rawName));
  if (matches.length === 0) {
    return { match: null, issue: "UNKNOWN_PLAYER", message: `"${rawName}" is not in the frozen Waiver snapshot` };
  }
  const eligible = distinctEntries(matches.filter((row) => row.position === position && row.eligible));
  if (eligible.length > 0) {
    const narrowed = team ? eligible.filter((row) => row.team !== null && normalizeTeamAbbr(row.team) === team) : eligible;
    if (narrowed.length === 1) return { match: toMatch(narrowed[0]), issue: null, message: null };
    if (narrowed.length === 0 && eligible.length === 1) {
      return {
        match: null,
        issue: "TEAM_MISMATCH",
        message: `"${rawName}" is listed for ${team}, but the frozen pool has ${eligible[0].displayName} (${eligible[0].team ?? "no team"})`,
      };
    }
    return {
      match: null,
      issue: "AMBIGUOUS_PLAYER",
      message: `"${rawName}" matches ${eligible.length} eligible players: ${eligible.map((row) => `${row.displayName} (${row.team ?? "—"})`).join(", ")}`,
    };
  }
  if (matches.some((row) => row.position === position)) {
    return { match: null, issue: "INELIGIBLE_PLAYER", message: `"${rawName}" is in the frozen snapshot but not in the eligible ${position} pool` };
  }
  const positions = [...new Set(matches.map((row) => row.position))].join("/");
  return { match: null, issue: "WRONG_POSITION", message: `"${rawName}" is a ${positions} in the frozen snapshot, not ${position}` };
}

export function parseWaiverAiResponse(input: WaiverAiParseInput): WaiverAiParseResult {
  const eligibleCount = new Set(
    input.rows.filter((row) => row.position === input.position && row.eligible).map((row) => row.rankableEntryId),
  ).size;
  const availableSlots = effectiveMaxCalls(input.maxCalls, eligibleCount);
  const result = (issues: WaiverAiIssue[], lines: WaiverAiParsedLine[], noCalls: boolean, picks: WaiverAiPick[]): WaiverAiParseResult => ({
    parserVersion: WAIVEREYEQ_AI_PARSER_VERSION,
    ok: issues.length === 0,
    noCalls: issues.length === 0 && noCalls,
    picks: issues.length === 0 ? picks : [],
    issues,
    lines,
    availableSlots,
  });

  if (!isStorableText(input.text)) {
    return result([{ code: "INVALID_TEXT", lineNumber: null, message: "The response contains a NUL character or invalid Unicode" }], [], false, []);
  }
  if (utf8ByteLength(input.text) > WAIVER_AI_RESPONSE_MAX_BYTES) {
    return result(
      [{ code: "TOO_LONG", lineNumber: null, message: `The response is larger than ${WAIVER_AI_RESPONSE_MAX_BYTES} bytes` }],
      [],
      false,
      [],
    );
  }

  const issues: WaiverAiIssue[] = [];
  const lines: WaiverAiParsedLine[] = [];
  const pickLines: Array<{ line: WaiverAiParsedLine; numbered: boolean; rank: number | null }> = [];
  let noCallsLines = 0;

  for (const [index, raw] of input.text.split(/\r\n|\r|\n/).entries()) {
    const lineNumber = index + 1;
    const text = raw.trim();
    const base = { lineNumber, text: raw, slot: null, rawName: null, match: null, issues: [] as WaiverAiIssueCode[] };
    if (!text) {
      lines.push({ ...base, kind: "BLANK" });
      continue;
    }
    if (FENCE.test(text) || TABLE_SEPARATOR.test(text)) {
      lines.push({ ...base, kind: "IGNORED" });
      continue;
    }
    if (NO_CALLS.test(text)) {
      noCallsLines += 1;
      lines.push({ ...base, kind: "NO_CALLS" });
      continue;
    }
    const extracted = extractLine(text);
    if (extracted.kind === "IGNORED") {
      lines.push({ ...base, kind: "IGNORED" });
      continue;
    }
    if (extracted.kind === "UNPARSEABLE") {
      lines.push({ ...base, kind: "UNPARSEABLE", issues: ["UNPARSEABLE_LINE"] });
      issues.push({ code: "UNPARSEABLE_LINE", lineNumber, message: `Line ${lineNumber} is not a pick: "${text.slice(0, 120)}"` });
      continue;
    }
    const resolution = resolvePick(extracted.rawName, extracted.team, input.position, input.rows);
    const line: WaiverAiParsedLine = {
      ...base,
      kind: "PICK",
      rawName: extracted.rawName,
      match: resolution.match,
      issues: resolution.issue ? [resolution.issue] : [],
    };
    if (resolution.issue) issues.push({ code: resolution.issue, lineNumber, message: `Line ${lineNumber}: ${resolution.message}` });
    lines.push(line);
    pickLines.push({ line, numbered: extracted.numbered, rank: extracted.rank });
  }

  if (pickLines.length === 0 && noCallsLines === 0 && issues.length === 0) {
    issues.push({ code: "EMPTY", lineNumber: null, message: "The response has no picks and is not NO CALLS" });
  }
  if (noCallsLines > 0 && (pickLines.length > 0 || noCallsLines > 1)) {
    issues.push({ code: "NO_CALLS_MIXED", lineNumber: null, message: "NO CALLS must appear once, on its own, with no picks" });
  }

  const numberedCount = pickLines.filter((pick) => pick.numbered).length;
  if (numberedCount > 0 && numberedCount < pickLines.length) {
    issues.push({ code: "MIXED_NUMBERING", lineNumber: null, message: "Either every pick is numbered or none is" });
  } else {
    pickLines.forEach((pick, index) => {
      pick.line.slot = numberedCount > 0 ? pick.rank : index + 1;
    });
    if (numberedCount > 0) {
      const counts = new Map<number, number>();
      for (const pick of pickLines) counts.set(pick.rank!, (counts.get(pick.rank!) ?? 0) + 1);
      for (const pick of pickLines) {
        if ((counts.get(pick.rank!) ?? 0) > 1) {
          pick.line.issues.push("DUPLICATE_SLOT");
          issues.push({ code: "DUPLICATE_SLOT", lineNumber: pick.line.lineNumber, message: `Line ${pick.line.lineNumber}: #${pick.rank} is used more than once` });
        }
      }
      const highest = Math.max(...pickLines.map((pick) => pick.rank!));
      for (let slot = 1; slot <= highest; slot += 1) {
        if (!counts.has(slot)) issues.push({ code: "MISSING_SLOT", lineNumber: null, message: `#${slot} is missing` });
      }
      const ascending = pickLines.every((pick, index) => index === 0 || pick.rank! > pickLines[index - 1].rank!);
      if (!ascending && ![...counts.values()].some((count) => count > 1)) {
        issues.push({ code: "OUT_OF_ORDER", lineNumber: null, message: "Picks must be listed in order from #1" });
      }
    }
  }

  const seenPlayers = new Map<string, number>();
  for (const pick of pickLines) {
    const match = pick.line.match;
    if (!match) continue;
    const first = seenPlayers.get(match.rankableEntryId);
    if (first !== undefined) {
      pick.line.issues.push("DUPLICATE_PLAYER");
      issues.push({
        code: "DUPLICATE_PLAYER",
        lineNumber: pick.line.lineNumber,
        message: `Line ${pick.line.lineNumber}: ${match.displayName} is already picked on line ${first}`,
      });
    } else {
      seenPlayers.set(match.rankableEntryId, pick.line.lineNumber);
    }
  }

  if (pickLines.length > availableSlots) {
    issues.push({
      code: "TOO_MANY_CALLS",
      lineNumber: null,
      message: `${pickLines.length} picks; at most ${availableSlots} ${availableSlots === 1 ? "is" : "are"} allowed for ${input.position}`,
    });
  }

  const picks: WaiverAiPick[] = pickLines.map((pick) => ({
    ...pick.line.match!,
    slot: pick.line.slot!,
    lineNumber: pick.line.lineNumber,
    rawName: pick.line.rawName!,
  }));
  return result(issues, lines, noCallsLines === 1 && pickLines.length === 0, picks);
}
