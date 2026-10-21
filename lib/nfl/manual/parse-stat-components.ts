import {
  DEFENSE_STAT_COLUMNS,
  PLAYER_STAT_COLUMNS,
  STAT_COMPONENTS_FORMAT_VERSION,
  type DefenseStatColumn,
  type PlayerStatColumn,
} from "@/lib/nfl/manual/stat-components-format";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";

/**
 * CSV splitter that preserves empty cells (unlike splitDelimitedLine, which
 * drops blanks via filter(Boolean) — blank ≠ zero for this format).
 */
function splitCsvLinePreserveEmpty(line: string): string[] {
  if (line.includes("|")) {
    return line.split("|").map((part) => part.trim());
  }
  if (line.includes("\t")) {
    return line.split("\t").map((part) => part.trim());
  }
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

export type StatComponentParseIssue =
  | "missing_header"
  | "unknown_column"
  | "missing_column"
  | "invalid_record_type"
  | "invalid_format_version"
  | "missing_identity"
  | "missing_game"
  | "missing_source"
  | "invalid_observed_at"
  | "blank_stat_cell"
  | "malformed_number"
  | "out_of_range"
  | "wrong_columns_for_type"
  | "duplicate_in_file"
  | "empty_file";

export type ParsedStatComponentRow = {
  lineNumber: number;
  recordType: "PLAYER" | "DEF";
  formatVersion: string;
  seasonYear: number | null;
  weekNumber: number | null;
  rankableEntryId: string;
  provider: string;
  externalId: string;
  gameExternalId: string;
  team: string;
  position: ContestPosition | null;
  displayName: string;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  playerStats: Required<PlayerStatLine> | null;
  defenseStats: Required<DefenseStatLine> | null;
  issues: StatComponentParseIssue[];
};

export type StatComponentsParseResult = {
  rows: ParsedStatComponentRow[];
  header: string[];
  contentSha256: string;
  blockers: string[];
  readyForMatch: boolean;
};

const PLAYER_RANGES: Record<PlayerStatColumn, { min: number; max: number; int?: boolean }> = {
  passingYards: { min: -50, max: 800 },
  passingTds: { min: 0, max: 12, int: true },
  interceptions: { min: 0, max: 12, int: true },
  rushingYards: { min: -50, max: 400 },
  rushingTds: { min: 0, max: 10, int: true },
  receptions: { min: 0, max: 30, int: true },
  receivingYards: { min: -50, max: 400 },
  receivingTds: { min: 0, max: 10, int: true },
  twoPointConversions: { min: 0, max: 6, int: true },
  fumblesLost: { min: 0, max: 10, int: true },
  returnTds: { min: 0, max: 6, int: true },
};

const DEFENSE_RANGES: Record<DefenseStatColumn, { min: number; max: number; int?: boolean }> = {
  sacks: { min: 0, max: 20 },
  interceptions: { min: 0, max: 12, int: true },
  fumbleRecoveries: { min: 0, max: 12, int: true },
  defensiveTds: { min: 0, max: 8, int: true },
  specialTeamsTds: { min: 0, max: 8, int: true },
  safeties: { min: 0, max: 6, int: true },
  blockedKicks: { min: 0, max: 8, int: true },
  pointsAllowed: { min: 0, max: 100, int: true },
};

function parseCsvRows(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line) => splitCsvLinePreserveEmpty(line));
}

function parseRequiredNumber(
  raw: string | undefined,
  range: { min: number; max: number; int?: boolean },
): { value: number | null; issues: StatComponentParseIssue[] } {
  const issues: StatComponentParseIssue[] = [];
  if (raw == null || raw.trim() === "") {
    return { value: null, issues: ["blank_stat_cell"] };
  }
  const token = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(token)) {
    return { value: null, issues: ["malformed_number"] };
  }
  const value = Number(token);
  if (!Number.isFinite(value)) {
    return { value: null, issues: ["malformed_number"] };
  }
  if (range.int && !Number.isInteger(value)) {
    return { value: null, issues: ["malformed_number"] };
  }
  if (value < range.min || value > range.max) {
    return { value: null, issues: ["out_of_range"] };
  }
  return { value, issues };
}

function parsePosition(raw: string): ContestPosition | null {
  const value = raw.trim().toUpperCase();
  if (value === "QB" || value === "RB" || value === "WR" || value === "TE" || value === "DEF") {
    return value;
  }
  return null;
}

export function parseStatComponentsCsv(text: string): Omit<StatComponentsParseResult, "contentSha256"> {
  const table = parseCsvRows(text);
  if (table.length === 0) {
    return {
      rows: [],
      header: [],
      blockers: ["CSV is empty"],
      readyForMatch: false,
    };
  }

  const header = table[0]!.map((cell) => cell.trim());
  const headerIndex = new Map(header.map((name, index) => [name, index]));
  const requiredCommon = [
    "recordType",
    "formatVersion",
    "rankableEntryId",
    "provider",
    "externalId",
    "gameExternalId",
    "team",
    "position",
    "displayName",
    "sourceLabel",
    "sourceUrl",
    "observedAt",
  ];

  const blockers: string[] = [];
  for (const col of requiredCommon) {
    if (!headerIndex.has(col)) blockers.push(`Missing required column: ${col}`);
  }

  const known = new Set<string>([
    ...requiredCommon,
    "seasonYear",
    "weekNumber",
    ...PLAYER_STAT_COLUMNS,
    ...DEFENSE_STAT_COLUMNS,
  ]);
  for (const col of header) {
    if (!known.has(col)) blockers.push(`Unknown column: ${col}`);
  }

  if (blockers.length > 0) {
    return {
      rows: [],
      header,
      blockers,
      readyForMatch: false,
    };
  }

  const cell = (cols: string[], name: string) => {
    const index = headerIndex.get(name);
    if (index == null) return "";
    return cols[index] ?? "";
  };

  const rows: ParsedStatComponentRow[] = [];
  const seenKeys = new Map<string, number>();

  for (let i = 1; i < table.length; i += 1) {
    const cols = table[i]!;
    const lineNumber = i + 1;
    const issues: StatComponentParseIssue[] = [];
    const recordTypeRaw = cell(cols, "recordType").trim().toUpperCase();
    const recordType =
      recordTypeRaw === "PLAYER" || recordTypeRaw === "DEF" ? recordTypeRaw : null;
    if (!recordType) issues.push("invalid_record_type");

    const formatVersion = cell(cols, "formatVersion").trim();
    if (formatVersion !== STAT_COMPONENTS_FORMAT_VERSION) {
      issues.push("invalid_format_version");
    }

    const rankableEntryId = cell(cols, "rankableEntryId").trim();
    const provider = cell(cols, "provider").trim();
    const externalId = cell(cols, "externalId").trim();
    if (!rankableEntryId && !(provider && externalId)) {
      issues.push("missing_identity");
    }

    const gameExternalId = cell(cols, "gameExternalId").trim();
    if (!gameExternalId) issues.push("missing_game");

    const sourceLabel = cell(cols, "sourceLabel").trim();
    const sourceUrl = cell(cols, "sourceUrl").trim();
    const observedAt = cell(cols, "observedAt").trim();
    if (!sourceLabel || !sourceUrl || !observedAt) issues.push("missing_source");
    if (observedAt && Number.isNaN(Date.parse(observedAt))) {
      issues.push("invalid_observed_at");
    }

    const seasonRaw = cell(cols, "seasonYear").trim();
    const weekRaw = cell(cols, "weekNumber").trim();
    const seasonYear = seasonRaw ? Number(seasonRaw) : null;
    const weekNumber = weekRaw ? Number(weekRaw) : null;

    let playerStats: Required<PlayerStatLine> | null = null;
    let defenseStats: Required<DefenseStatLine> | null = null;

    if (recordType === "PLAYER") {
      const stats: Partial<Required<PlayerStatLine>> = {};
      for (const key of PLAYER_STAT_COLUMNS) {
        const parsed = parseRequiredNumber(cell(cols, key), PLAYER_RANGES[key]);
        issues.push(...parsed.issues);
        if (parsed.value != null) {
          (stats as Record<string, number>)[key] = parsed.value;
        }
      }
      if (PLAYER_STAT_COLUMNS.every((key) => stats[key] != null)) {
        playerStats = stats as Required<PlayerStatLine>;
      }
    } else if (recordType === "DEF") {
      const stats: Partial<Required<DefenseStatLine>> = {};
      for (const key of DEFENSE_STAT_COLUMNS) {
        const parsed = parseRequiredNumber(cell(cols, key), DEFENSE_RANGES[key]);
        issues.push(...parsed.issues);
        if (parsed.value != null) {
          (stats as Record<string, number>)[key] = parsed.value;
        }
      }
      if (DEFENSE_STAT_COLUMNS.every((key) => stats[key] != null)) {
        defenseStats = stats as Required<DefenseStatLine>;
      }
    }

    const identityKey = rankableEntryId || `${provider}|${externalId}`;
    if (identityKey) {
      const prior = seenKeys.get(identityKey);
      if (prior != null) issues.push("duplicate_in_file");
      else seenKeys.set(identityKey, lineNumber);
    }

    rows.push({
      lineNumber,
      recordType: recordType ?? "PLAYER",
      formatVersion,
      seasonYear: Number.isFinite(seasonYear) ? seasonYear : null,
      weekNumber: Number.isFinite(weekNumber) ? weekNumber : null,
      rankableEntryId,
      provider,
      externalId,
      gameExternalId,
      team: cell(cols, "team").trim(),
      position: parsePosition(cell(cols, "position")),
      displayName: cell(cols, "displayName").trim(),
      sourceLabel,
      sourceUrl,
      observedAt,
      playerStats,
      defenseStats,
      issues,
    });
  }

  if (rows.length === 0) {
    blockers.push("CSV has a header but no data rows");
  }

  const rowIssues = rows.filter((row) => row.issues.length > 0).length;
  if (rowIssues > 0) {
    blockers.push(`${rowIssues} row(s) failed strict parse validation`);
  }

  return {
    rows,
    header,
    blockers,
    readyForMatch: blockers.length === 0,
  };
}
