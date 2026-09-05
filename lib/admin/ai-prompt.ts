import { formatInChicago, RANKIQ_TIMEZONE } from "@/lib/timing/chicago";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type AiPromptPlayer = {
  name: string;
  team: string;
  opponent: string;
  gameStartsAt: Date | null;
};

export type AiPromptContest = {
  title: string;
  seasonYear: number;
  sport: string;
  weekLabel: string;
  weekNumber: number;
  position: ContestPosition;
  rankingDepth: number;
  rankingsOpenAt: Date | null;
  fullLockAt: Date | null;
  players: AiPromptPlayer[];
};

function formatKickoff(date: Date | null) {
  if (!date) return "kickoff TBD";
  return formatInChicago(date, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatEligiblePlayerPool(players: AiPromptPlayer[]) {
  return players
    .map((player) => {
      const opponent = player.opponent || "TBD";
      return `- ${player.name} (${player.team}) ${opponent} — ${formatKickoff(player.gameStartsAt)}`;
    })
    .join("\n");
}

export function buildAiRankingPrompt(contest: AiPromptContest) {
  const depth = contest.rankingDepth;
  const exampleLines = Array.from(
    { length: Math.min(3, depth) },
    (_, index) => `${index + 1}. Player Name`,
  );
  if (depth > 3) {
    exampleLines.push("...");
    exampleLines.push(`${depth}. Player Name`);
  }

  const lockAt = contest.fullLockAt
    ? formatInChicago(contest.fullLockAt, {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Sunday 10:00 AM America/Chicago";

  return `You are ranking for RankEYEQ.

Contest: ${contest.title}
Season: ${contest.seasonYear} ${contest.sport}
Week: ${contest.weekLabel} (Week ${contest.weekNumber})
Position: ${contest.position}
Required ranking depth: Top ${depth}
Scoring format: FantasyTrack Half PPR (0.5 / reception) + one-time +5 bonuses at 300+ pass / 100+ rush / 100+ receiving yards

Rank ONLY from this eligible ${contest.position} field. Do not invent names. No outside rankings or other bot boards. No projection columns are included.

Eligible field:
${formatEligiblePlayerPool(contest.players) || "- (no eligible players loaded)"}

Lock rules:
- Each player or defense locks when their own NFL game begins. After kickoff you cannot add, remove, or move that entry.
- Remaining unlocked rankings lock at ${lockAt} (${RANKIQ_TIMEZONE}).
- Incomplete or unsubmitted boards do not compete.

Return ONLY a numbered list in this exact format:

${exampleLines.join("\n")}

For ${contest.position}, provide ranks 1 through ${depth}.`;
}

export function buildAllPositionPrompts(
  contests: AiPromptContest[],
  botDisplayName?: string,
) {
  const header = botDisplayName
    ? `RankEYEQ AI ranking prompts for ${botDisplayName}\n\n`
    : "RankEYEQ AI ranking prompts\n\n";
  return (
    header +
    contests
      .map(
        (contest) =>
          `===== ${contest.position} =====\n${buildAiRankingPrompt(contest)}`,
      )
      .join("\n\n")
  );
}
