import {
  CANONICAL_NFL_TEAM_ABBR_LIST,
  CANONICAL_NFL_TEAM_ABBRS,
  isCanonicalNflTeamAbbr,
  normalizeTeamAbbr,
  parseManualKickoff,
  isHeaderRow,
  splitDelimitedLine,
} from "@/lib/nfl/manual/parse-common";
import { toChicagoDateTimeLocal } from "@/lib/timing/chicago";

export type ScheduleRowIssue =
  | "missing_away"
  | "missing_home"
  | "missing_kickoff"
  | "invalid_kickoff"
  | "unknown_team"
  | "self_matchup"
  | "duplicate_game"
  | "duplicate_team";

export type ParsedScheduleRow = {
  lineNumber: number;
  awayTeam: string;
  homeTeam: string;
  kickoff: Date | null;
  /** Kickoff formatted for operator review: YYYY-MM-DD HH:MM CT */
  kickoffLabel: string | null;
  raw: string;
  issues: ScheduleRowIssue[];
};

export type ScheduleCompleteness = {
  gameCount: number;
  teamAppearanceCount: number;
  uniqueTeamCount: number;
  teamsAppearingMoreThanOnce: string[];
  absentTeams: string[];
  /** Structural validation passed (ready to save). */
  structuralPassed: boolean;
  /**
   * FULL when all 32 canonical teams appear once.
   * VERIFY_SLATE when structurally ok but bye/partial slate (or incomplete).
   * BLOCKED when structural validation failed.
   */
  completeness: "FULL" | "VERIFY_SLATE" | "BLOCKED";
};

export type ScheduleParseResult = {
  rows: ParsedScheduleRow[];
  ready: boolean;
  blockers: string[];
  summary: ScheduleCompleteness;
};

function formatKickoffCtLabel(kickoff: Date | null): string | null {
  if (!kickoff) return null;
  const local = toChicagoDateTimeLocal(kickoff);
  return `${local.replace("T", " ")} CT`;
}

function buildSummary(rows: ParsedScheduleRow[]): ScheduleCompleteness {
  const appearances: string[] = [];
  for (const row of rows) {
    if (row.awayTeam) appearances.push(row.awayTeam);
    if (row.homeTeam) appearances.push(row.homeTeam);
  }
  const counts = new Map<string, number>();
  for (const team of appearances) {
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  const uniqueTeams = [...counts.keys()].sort();
  const teamsAppearingMoreThanOnce = uniqueTeams.filter(
    (team) => (counts.get(team) ?? 0) > 1,
  );
  const absentTeams = CANONICAL_NFL_TEAM_ABBR_LIST.filter(
    (abbr) => !counts.has(abbr),
  );
  const structuralPassed =
    rows.length > 0 && rows.every((row) => row.issues.length === 0);
  let completeness: ScheduleCompleteness["completeness"] = "BLOCKED";
  if (structuralPassed) {
    completeness =
      uniqueTeams.length === CANONICAL_NFL_TEAM_ABBRS.size &&
      teamsAppearingMoreThanOnce.length === 0 &&
      absentTeams.length === 0
        ? "FULL"
        : "VERIFY_SLATE";
  }
  return {
    gameCount: rows.length,
    teamAppearanceCount: appearances.length,
    uniqueTeamCount: uniqueTeams.length,
    teamsAppearingMoreThanOnce,
    absentTeams,
    structuralPassed,
    completeness,
  };
}

export function parseWeeklySchedulePaste(text: string): ScheduleParseResult {
  const rows: ParsedScheduleRow[] = [];
  const teamSeen = new Map<string, number>();
  const pairSeen = new Map<string, number>();

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = splitDelimitedLine(line);
    if (cols.length < 3) continue;
    if (isHeaderRow(cols)) continue;

    const awayTeam = normalizeTeamAbbr(cols[0] ?? "");
    const homeTeam = normalizeTeamAbbr(cols[1] ?? "");
    const kickoffRaw = cols.slice(2).join(" ");
    const kickoff = parseManualKickoff(kickoffRaw);
    const issues: ScheduleRowIssue[] = [];

    if (!awayTeam) issues.push("missing_away");
    else if (!isCanonicalNflTeamAbbr(awayTeam)) issues.push("unknown_team");
    if (!homeTeam) issues.push("missing_home");
    else if (!isCanonicalNflTeamAbbr(homeTeam)) issues.push("unknown_team");
    if (!kickoffRaw.trim()) issues.push("missing_kickoff");
    else if (!kickoff) issues.push("invalid_kickoff");
    if (awayTeam && homeTeam && awayTeam === homeTeam) issues.push("self_matchup");

    const pairKey = [awayTeam, homeTeam].sort().join("@");
    if (awayTeam && homeTeam) {
      if (pairSeen.has(pairKey)) issues.push("duplicate_game");
      else pairSeen.set(pairKey, index + 1);
    }
    for (const team of [awayTeam, homeTeam]) {
      if (!team) continue;
      if (teamSeen.has(team)) issues.push("duplicate_team");
      else teamSeen.set(team, index + 1);
    }

    rows.push({
      lineNumber: index + 1,
      awayTeam,
      homeTeam,
      kickoff,
      kickoffLabel: formatKickoffCtLabel(kickoff),
      raw: line,
      issues: [...new Set(issues)],
    });
  }

  const blockers = rows.flatMap((row) =>
    row.issues.map(
      (issue) => `Line ${row.lineNumber}: ${issue.replaceAll("_", " ")} (${row.raw})`,
    ),
  );

  const summary = buildSummary(rows);

  return {
    rows,
    ready: summary.structuralPassed,
    blockers,
    summary,
  };
}
