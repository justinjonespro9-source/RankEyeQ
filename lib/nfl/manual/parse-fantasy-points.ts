import { findNameMatches, normalizePlayerName } from "@/lib/admin/ai-parser";
import {
  isHeaderRow,
  parseContestPosition,
  splitDelimitedLine,
} from "@/lib/nfl/manual/parse-common";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type FantasyPointCandidate = {
  id: string;
  rankableEntryId: string;
  name: string;
  team: string;
  position: ContestPosition;
  shortName?: string | null;
};

export type FantasyPointIssue =
  | "missing_name"
  | "missing_points"
  | "malformed_points"
  | "unknown"
  | "ambiguous"
  | "duplicate_player"
  | "wrong_position";

export type ParsedFantasyPointRow = {
  lineNumber: number;
  raw: string;
  name: string;
  position: ContestPosition | null;
  fantasyPoints: number | null;
  /** True when the pasted value was explicitly 0 / 0.0 */
  explicitZero: boolean;
  matchedContestEntryId: string | null;
  matchedName: string | null;
  candidates: Array<{ id: string; name: string }>;
  issues: FantasyPointIssue[];
};

export type FantasyPointsParseResult = {
  rows: ParsedFantasyPointRow[];
  ready: boolean;
  blockers: string[];
  matchedCount: number;
  zeroCount: number;
};

function parsePointsToken(raw: string): {
  value: number | null;
  explicitZero: boolean;
  malformed: boolean;
  missing: boolean;
} {
  const token = raw.trim().replace(/,/g, "");
  if (!token) return { value: null, explicitZero: false, malformed: false, missing: true };
  if (!/^-?\d+(\.\d+)?$/.test(token)) {
    return { value: null, explicitZero: false, malformed: true, missing: false };
  }
  const value = Number(token);
  if (!Number.isFinite(value)) {
    return { value: null, explicitZero: false, malformed: true, missing: false };
  }
  return {
    value,
    explicitZero: value === 0,
    malformed: false,
    missing: false,
  };
}

export function parseFantasyPointsPaste(input: {
  text: string;
  eligible: FantasyPointCandidate[];
  /** When set, rows without position must match this contest. */
  fixedPosition?: ContestPosition;
}): FantasyPointsParseResult {
  const rows: ParsedFantasyPointRow[] = [];
  const seenPlayers = new Map<string, number>();

  for (const [index, rawLine] of input.text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const cleaned = line.replace(/^\d+\s*[\.\)\-]\s+/, "");
    const cols = splitDelimitedLine(cleaned);
    if (cols.length < 2) continue;
    if (isHeaderRow(cols)) continue;

    let name = "";
    let position: ContestPosition | null = input.fixedPosition ?? null;
    let pointsRaw = "";

    if (cols.length >= 3 && parseContestPosition(cols[1] ?? "")) {
      name = cols[0] ?? "";
      position = parseContestPosition(cols[1] ?? "");
      pointsRaw = cols[2] ?? "";
    } else {
      name = cols[0] ?? "";
      pointsRaw = cols[cols.length - 1] ?? "";
      if (cols.length >= 3 && !input.fixedPosition) {
        const maybePos = parseContestPosition(cols[1] ?? "");
        if (maybePos) position = maybePos;
      }
    }

    const points = parsePointsToken(pointsRaw);
    const issues: FantasyPointIssue[] = [];
    if (!name.trim()) issues.push("missing_name");
    if (points.missing) issues.push("missing_points");
    if (points.malformed) issues.push("malformed_points");

    const pool = input.eligible.filter((entry) =>
      position ? entry.position === position : true,
    );
    const matches = name.trim()
      ? findNameMatches(
          name,
          pool.map((entry) => ({
            id: entry.id,
            name: entry.name,
            team: entry.team,
            shortName: entry.shortName,
          })),
        )
      : [];

    let matchedContestEntryId: string | null = null;
    let matchedName: string | null = null;
    if (matches.length === 1) {
      matchedContestEntryId = matches[0].id;
      matchedName = matches[0].name;
    } else if (matches.length > 1) {
      issues.push("ambiguous");
    } else if (name.trim()) {
      const other = findNameMatches(
        name,
        input.eligible.map((entry) => ({
          id: entry.id,
          name: entry.name,
          team: entry.team,
          shortName: entry.shortName,
        })),
      );
      if (other.length > 0 && position) issues.push("wrong_position");
      else issues.push("unknown");
    }

    if (matchedContestEntryId) {
      if (seenPlayers.has(matchedContestEntryId)) issues.push("duplicate_player");
      else seenPlayers.set(matchedContestEntryId, index + 1);
    } else {
      const key = normalizePlayerName(name);
      if (key && seenPlayers.has(key)) issues.push("duplicate_player");
      else if (key) seenPlayers.set(key, index + 1);
    }

    rows.push({
      lineNumber: index + 1,
      raw: line,
      name: name.trim(),
      position,
      fantasyPoints: points.value,
      explicitZero: points.explicitZero,
      matchedContestEntryId,
      matchedName,
      candidates: matches.map((m) => ({ id: m.id, name: m.name })),
      issues: [...new Set(issues)],
    });
  }

  const blockers = rows.flatMap((row) =>
    row.issues.map(
      (issue) =>
        `Line ${row.lineNumber}: ${issue.replaceAll("_", " ")} (${row.name || row.raw})`,
    ),
  );

  return {
    rows,
    ready: rows.length > 0 && blockers.length === 0,
    blockers,
    matchedCount: rows.filter((row) => Boolean(row.matchedContestEntryId)).length,
    zeroCount: rows.filter((row) => row.explicitZero).length,
  };
}
