import { findNameMatches, normalizePlayerName } from "@/lib/admin/ai-parser";
import {
  isHeaderRow,
  isMissingTeam,
  normalizeTeamAbbr,
  parseContestPosition,
  parseManualKickoff,
  shortNameFromFull,
  splitDelimitedLine,
} from "@/lib/nfl/manual/parse-common";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type PoolMasterCandidate = {
  id: string;
  name: string;
  team: string;
  position: ContestPosition;
  shortName?: string | null;
  active: boolean;
};

export type PoolRowIssue =
  | "missing_name"
  | "missing_team"
  | "missing_opponent"
  | "missing_kickoff"
  | "invalid_kickoff"
  | "invalid_position"
  | "position_mismatch"
  | "no_team"
  | "unknown"
  | "ambiguous"
  | "duplicate_row"
  | "create_new";

export type ParsedPoolRow = {
  lineNumber: number;
  raw: string;
  name: string;
  position: ContestPosition | null;
  team: string;
  opponent: string;
  kickoff: Date | null;
  matchedEntryId: string | null;
  matchedName: string | null;
  candidates: Array<{ id: string; name: string; team: string }>;
  issues: PoolRowIssue[];
  createNew: boolean;
};

export type PoolParseResult = {
  rows: ParsedPoolRow[];
  ready: boolean;
  blockers: string[];
  createCount: number;
  matchCount: number;
};

function classifyMatch(
  name: string,
  team: string,
  position: ContestPosition | null,
  masters: PoolMasterCandidate[],
) {
  const pool = masters.filter((entry) =>
    position ? entry.position === position : true,
  );
  const matches = findNameMatches(
    name,
    pool.map((entry) => ({
      id: entry.id,
      name: entry.name,
      team: entry.team,
      shortName: entry.shortName,
    })),
  );

  if (matches.length === 1) {
    const exact = pool.find((entry) => entry.id === matches[0].id)!;
    if (team && exact.team && exact.team !== team && !isMissingTeam(exact.team)) {
      // Prefer same-team if available among last-name matches
      const sameTeam = matches.filter((_, i) => {
        const master = pool.find((entry) => entry.id === matches[i]?.id);
        return master?.team === team;
      });
      if (sameTeam.length === 0) {
        // still accept unique name match
      }
    }
    return {
      matchedEntryId: exact.id,
      matchedName: exact.name,
      candidates: matches.map((m) => {
        const master = pool.find((entry) => entry.id === m.id)!;
        return { id: master.id, name: master.name, team: master.team };
      }),
      issue: null as PoolRowIssue | null,
    };
  }

  if (matches.length > 1) {
    const sameTeam = matches.filter((m) => {
      const master = pool.find((entry) => entry.id === m.id);
      return master?.team === team;
    });
    if (sameTeam.length === 1) {
      const master = pool.find((entry) => entry.id === sameTeam[0].id)!;
      return {
        matchedEntryId: master.id,
        matchedName: master.name,
        candidates: matches.map((m) => {
          const item = pool.find((entry) => entry.id === m.id)!;
          return { id: item.id, name: item.name, team: item.team };
        }),
        issue: null as PoolRowIssue | null,
      };
    }
    return {
      matchedEntryId: null,
      matchedName: null,
      candidates: matches.map((m) => {
        const master = pool.find((entry) => entry.id === m.id)!;
        return { id: master.id, name: master.name, team: master.team };
      }),
      issue: "ambiguous" as PoolRowIssue,
    };
  }

  return {
    matchedEntryId: null,
    matchedName: null,
    candidates: [],
    issue: "create_new" as PoolRowIssue,
  };
}

/**
 * Full weekly paste: Player | Position | Team | Opponent | Kickoff
 * Or position-scoped: Player | Team | Opponent | Kickoff (position inferred).
 */
export function parseWeeklyPoolPaste(input: {
  text: string;
  masters: PoolMasterCandidate[];
  fixedPosition?: ContestPosition;
}): PoolParseResult {
  const rows: ParsedPoolRow[] = [];
  const seenKeys = new Map<string, number>();

  for (const [index, rawLine] of input.text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    // Strip leading list numbers: "1. Name | ..."
    const cleaned = line.replace(/^\d+\s*[\.\)\-]\s+/, "");
    const cols = splitDelimitedLine(cleaned);
    if (cols.length < 3) continue;
    if (isHeaderRow(cols)) continue;

    let name = "";
    let position: ContestPosition | null = input.fixedPosition ?? null;
    let team = "";
    let opponent = "";
    let kickoffRaw = "";

    if (input.fixedPosition) {
      name = cols[0] ?? "";
      team = normalizeTeamAbbr(cols[1] ?? "");
      opponent = normalizeTeamAbbr(cols[2] ?? "");
      kickoffRaw = cols.slice(3).join(" ");
    } else if (cols.length >= 5) {
      name = cols[0] ?? "";
      position = parseContestPosition(cols[1] ?? "");
      team = normalizeTeamAbbr(cols[2] ?? "");
      opponent = normalizeTeamAbbr(cols[3] ?? "");
      kickoffRaw = cols.slice(4).join(" ");
    } else {
      // Player | Team | Opponent | Kickoff without position when fixed missing
      name = cols[0] ?? "";
      team = normalizeTeamAbbr(cols[1] ?? "");
      opponent = normalizeTeamAbbr(cols[2] ?? "");
      kickoffRaw = cols.slice(3).join(" ");
    }

    const kickoff = kickoffRaw ? parseManualKickoff(kickoffRaw) : null;
    const issues: PoolRowIssue[] = [];
    if (!name.trim()) issues.push("missing_name");
    if (!position) issues.push("invalid_position");
    if (isMissingTeam(team)) issues.push("no_team");
    else if (!team) issues.push("missing_team");
    if (!opponent) issues.push("missing_opponent");
    if (!kickoffRaw.trim()) issues.push("missing_kickoff");
    else if (!kickoff) issues.push("invalid_kickoff");

    const match = name.trim()
      ? classifyMatch(name, team, position, input.masters)
      : {
          matchedEntryId: null,
          matchedName: null,
          candidates: [],
          issue: "missing_name" as PoolRowIssue,
        };

    if (match.issue === "ambiguous") issues.push("ambiguous");
    if (match.issue === "create_new" && name.trim() && position) {
      issues.push("create_new");
      const crossPosition = findNameMatches(
        name,
        input.masters
          .filter((entry) => entry.position !== position)
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            team: entry.team,
            shortName: entry.shortName,
          })),
      );
      if (crossPosition.length > 0) {
        issues.push("position_mismatch");
      }
    }
    if (match.matchedEntryId) {
      const master = input.masters.find((entry) => entry.id === match.matchedEntryId);
      if (
        master &&
        position &&
        master.position !== position
      ) {
        issues.push("position_mismatch");
      }
    }

    const key = `${normalizePlayerName(name)}|${team}|${position ?? ""}`;
    if (seenKeys.has(key)) issues.push("duplicate_row");
    else seenKeys.set(key, index + 1);

    rows.push({
      lineNumber: index + 1,
      raw: line,
      name: name.trim(),
      position,
      team,
      opponent,
      kickoff,
      matchedEntryId: match.matchedEntryId,
      matchedName: match.matchedName,
      candidates: match.candidates,
      issues: [...new Set(issues)],
      createNew: issues.includes("create_new"),
    });
  }

  const blockers = rows.flatMap((row) =>
    row.issues
      .filter((issue) => issue !== "create_new")
      .map(
        (issue) =>
          `Line ${row.lineNumber}: ${issue.replaceAll("_", " ")} (${row.name || row.raw})`,
      ),
  );

  // create_new is allowed when admin confirms — treated as ready if no other blockers
  const ready = rows.length > 0 && blockers.length === 0;

  return {
    rows,
    ready,
    blockers,
    createCount: rows.filter((row) => row.createNew).length,
    matchCount: rows.filter((row) => Boolean(row.matchedEntryId)).length,
  };
}

export { shortNameFromFull };
