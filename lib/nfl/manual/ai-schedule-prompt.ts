import { CANONICAL_NFL_TEAM_ABBR_LIST } from "@/lib/nfl/manual/parse-common";

/**
 * Build a reusable operator prompt for generating a paste-ready NFL weekly schedule.
 * No AI/API call — clipboard helper only.
 */
export function buildAiSchedulePrompt(input: {
  seasonYear: number;
  weekNumber: number;
}): string {
  const { seasonYear, weekNumber } = input;
  const abbrs = CANONICAL_NFL_TEAM_ABBR_LIST.join(", ");

  return `Find and verify the complete official ${seasonYear} NFL Week ${weekNumber} regular-season schedule.

Use a reliable current source, preferably NFL.com.

Return ONLY the games in the following exact paste-ready format:

AWAY | HOME | YYYY-MM-DD HH:MM CT

Requirements:
- Include every NFL game that belongs to ${seasonYear} NFL Week ${weekNumber}.
- Use these official RankEyeQ/NFL team abbreviations only:
  ${abbrs}
- Away team must be first.
- Home team must be second.
- Convert every kickoff to Central Time (CT).
- Use 24-hour time.
- Use the actual calendar date of each game.
- Include Thursday, Sunday, Monday, Saturday, holiday, international, or other standalone games that belong to NFL Week ${weekNumber}.
- Do not include preseason, another NFL week, or college games.
- Verify the complete slate before answering.
- Do not guess a kickoff time.
- Do not include headers, bullets, numbering, citations, explanations, markdown tables, or code fences in the output.
- One game per line.

Before returning the answer, internally verify:
1. There are no duplicate teams unless the official Week ${weekNumber} schedule genuinely requires it.
2. Every game has exactly one away and one home team.
3. Every kickoff has been converted correctly to Central Time.
4. The output represents the complete NFL Week ${weekNumber} slate for ${seasonYear}.

Return ONLY the paste-ready schedule lines.`;
}
