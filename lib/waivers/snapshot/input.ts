import { createHash } from "node:crypto";
import {
  isCanonicalNflTeamAbbr,
  isMissingTeam,
  normalizeTeamAbbr,
  parseContestPosition,
  parseManualKickoff,
} from "@/lib/nfl/manual/parse-common";
import { parseChicagoDateTimeLocal } from "@/lib/timing/chicago";
import { WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";

/**
 * Fixed-column paste contract for an official Waiver ownership snapshot:
 * Player | Pos | Team | Rostered% | [RankEyeQ ID] | [Source] | [Observed at]
 * Separated by `|`, tab, or comma (quotes supported). Column positions are
 * preserved, so optional middle columns may be left empty.
 */
export const WAIVER_INPUT_COLUMNS = ["Player", "Pos", "Team", "Rostered%", "RankEyeQ ID", "Source", "Observed at"] as const;
export const WAIVER_INPUT_MAX_ROWS = 1500;
export const WAIVER_INPUT_MAX_CHARS = 200_000;
const REQUIRED_COLUMNS = 4;

/** Team token for a player the source lists without an NFL team. */
export const WAIVER_SOURCE_FREE_AGENT = "FA";

export type WaiverInputIssue =
  | "TOO_FEW_COLUMNS"
  | "TOO_MANY_COLUMNS"
  | "MISSING_PLAYER"
  | "INVALID_POSITION"
  | "INVALID_TEAM"
  | "INVALID_PERCENT"
  | "INVALID_OBSERVED_AT";

export type WaiverInputRow = {
  lineNumber: number;
  line: string;
  playerName: string;
  positionRaw: string;
  position: WaiverPosition | null;
  teamRaw: string;
  /** Canonical abbreviation, `FA` for source-listed free agents, or null when invalid. */
  team: string | null;
  percentRaw: string;
  rosteredBps: number | null;
  rankEyeQId: string | null;
  sourceLabel: string | null;
  observedAtRaw: string | null;
  observedAt: Date | null;
  issues: WaiverInputIssue[];
};

export type WaiverInputError = "EMPTY" | "TOO_LARGE" | "TOO_MANY_ROWS";

export type WaiverInputParse = {
  rows: WaiverInputRow[];
  rawInputSha256: string;
  headerSkipped: boolean;
  ignoredLines: number;
  error: WaiverInputError | null;
};

export function normalizeWaiverInputText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function waiverRawInputSha256(text: string): string {
  return createHash("sha256").update(normalizeWaiverInputText(text), "utf8").digest("hex");
}

/** Splits one line into trimmed cells, keeping empty cells so columns never shift. */
export function splitWaiverColumns(line: string): string[] {
  if (line.includes("|")) {
    let body = line.trim();
    if (body.startsWith("|")) body = body.slice(1);
    if (body.endsWith("|")) body = body.slice(0, -1);
    return body.split("|").map((cell) => cell.trim());
  }
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Exact percent → basis points: 0–100 with at most two decimals and an
 * optional `%`. Never rounds (`49.995` is invalid, not 5000).
 */
export function parseRosteredPercentToBps(raw: string): number | null {
  const match = raw.trim().replace(/\s*%$/, "").match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const bps = whole * 100 + fraction;
  return bps <= 10_000 ? bps : null;
}

const CHICAGO_LOCAL_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?:\s*(?:CT|CDT|CST))?$/i;
const ISO_ZONED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Observation time: America/Chicago wall clock (`YYYY-MM-DD HH:MM [CT]`) or ISO with an explicit zone. */
export function parseWaiverObservedAt(raw: string): Date | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return parseChicagoDateTimeLocal(value);
  if (CHICAGO_LOCAL_RE.test(value)) return parseManualKickoff(`${value.slice(0, 10)} ${value.slice(11)}`);
  if (ISO_ZONED_RE.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parseTeam(raw: string): string | null {
  if (!raw.trim()) return null;
  if (isMissingTeam(raw)) return WAIVER_SOURCE_FREE_AGENT;
  return isCanonicalNflTeamAbbr(raw) ? normalizeTeamAbbr(raw) : null;
}

function parsePosition(raw: string): WaiverPosition | null {
  const position = parseContestPosition(raw);
  return position && (WAIVER_POSITIONS as readonly string[]).includes(position) ? (position as WaiverPosition) : null;
}

function isHeaderCells(cells: string[]): boolean {
  const first = (cells[0] ?? "").toLowerCase();
  return first === "player" || first === "player name" || first === "name";
}

export function parseWaiverInputRow(lineNumber: number, line: string): WaiverInputRow {
  const cells = splitWaiverColumns(line);
  const issues: WaiverInputIssue[] = [];
  const cell = (index: number) => cells[index] ?? "";
  if (cells.length < REQUIRED_COLUMNS) issues.push("TOO_FEW_COLUMNS");
  if (cells.slice(WAIVER_INPUT_COLUMNS.length).some((extra) => extra !== "")) issues.push("TOO_MANY_COLUMNS");

  const playerName = cell(0);
  if (!playerName) issues.push("MISSING_PLAYER");
  const positionRaw = cell(1);
  const position = parsePosition(positionRaw);
  if (!position) issues.push("INVALID_POSITION");
  const teamRaw = cell(2);
  const team = parseTeam(teamRaw);
  if (!team) issues.push("INVALID_TEAM");
  const percentRaw = cell(3);
  const rosteredBps = parseRosteredPercentToBps(percentRaw);
  if (rosteredBps === null) issues.push("INVALID_PERCENT");
  const observedAtRaw = cell(6) || null;
  const observedAt = observedAtRaw ? parseWaiverObservedAt(observedAtRaw) : null;
  if (observedAtRaw && !observedAt) issues.push("INVALID_OBSERVED_AT");

  return {
    lineNumber,
    line,
    playerName,
    positionRaw,
    position,
    teamRaw,
    team,
    percentRaw,
    rosteredBps,
    rankEyeQId: cell(4) || null,
    sourceLabel: cell(5) || null,
    observedAtRaw,
    observedAt,
    issues: [...new Set(issues)],
  };
}

export function parseWaiverInput(text: string): WaiverInputParse {
  const normalized = normalizeWaiverInputText(text);
  const rawInputSha256 = waiverRawInputSha256(text);
  const empty = (error: WaiverInputError): WaiverInputParse => ({
    rows: [],
    rawInputSha256,
    headerSkipped: false,
    ignoredLines: 0,
    error,
  });
  if (normalized.length > WAIVER_INPUT_MAX_CHARS) return empty("TOO_LARGE");

  const rows: WaiverInputRow[] = [];
  let headerSkipped = false;
  let ignoredLines = 0;
  const lines = normalized.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      ignoredLines += 1;
      continue;
    }
    if (!headerSkipped && rows.length === 0 && isHeaderCells(splitWaiverColumns(line))) {
      headerSkipped = true;
      continue;
    }
    rows.push(parseWaiverInputRow(index + 1, line));
    if (rows.length > WAIVER_INPUT_MAX_ROWS) return empty("TOO_MANY_ROWS");
  }
  if (rows.length === 0) return { ...empty("EMPTY"), headerSkipped, ignoredLines };
  return { rows, rawInputSha256, headerSkipped, ignoredLines, error: null };
}
