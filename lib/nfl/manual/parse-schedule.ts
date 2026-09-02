import {
  isHeaderRow,
  normalizeTeamAbbr,
  parseManualKickoff,
  splitDelimitedLine,
} from "@/lib/nfl/manual/parse-common";

export type ScheduleRowIssue =
  | "missing_away"
  | "missing_home"
  | "missing_kickoff"
  | "invalid_kickoff"
  | "self_matchup"
  | "duplicate_game"
  | "duplicate_team";

export type ParsedScheduleRow = {
  lineNumber: number;
  awayTeam: string;
  homeTeam: string;
  kickoff: Date | null;
  raw: string;
  issues: ScheduleRowIssue[];
};

export type ScheduleParseResult = {
  rows: ParsedScheduleRow[];
  ready: boolean;
  blockers: string[];
};

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
    if (!homeTeam) issues.push("missing_home");
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
      raw: line,
      issues: [...new Set(issues)],
    });
  }

  const blockers = rows.flatMap((row) =>
    row.issues.map(
      (issue) => `Line ${row.lineNumber}: ${issue.replaceAll("_", " ")} (${row.raw})`,
    ),
  );

  return {
    rows,
    ready: rows.length > 0 && blockers.length === 0,
    blockers,
  };
}
