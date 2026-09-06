import { formatInChicago, RANKIQ_TIMEZONE } from "@/lib/timing/chicago";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

/** Stable identifier for the weekly AI competition prompt. Bump when instructions change. */
export const RANKEYEQ_AI_WEEKLY_PROMPT_VERSION = "RANKEYEQ_AI_WEEKLY_V1" as const;

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

export type AiPromptBundle = {
  version: typeof RANKEYEQ_AI_WEEKLY_PROMPT_VERSION;
  prompt: string;
  poolText: string;
  meta: AiPromptMeta;
};

export type AiPromptMeta = {
  version: typeof RANKEYEQ_AI_WEEKLY_PROMPT_VERSION;
  aiDisplayName: string | null;
  seasonYear: number;
  weekLabel: string;
  weekNumber: number;
  position: ContestPosition;
  fieldSize: number;
  eligiblePoolCount: number;
  generatedAt: Date;
  generatedAtLabel: string;
};

/** Canonical scoring bullets shared by every AI competitor prompt. */
export const AI_WEEKLY_SCORING_RULES = [
  "Scoring: Half-PPR",
  "+5 bonus for 300+ passing yards",
  "+5 bonus for 100+ rushing yards",
  "+5 bonus for 100+ receiving yards",
  "Rankings are graded against actual league-wide positional finish",
] as const;

export function expectedAiFieldSize(position: ContestPosition): number {
  return rankingDepthForPosition(position);
}

function formatKickoff(date: Date | null) {
  if (!date) return null;
  return formatInChicago(date, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Eligible pool block for prompts.
 * Uses ContestEntry-eligible players only (caller must omit excluded).
 */
export function formatEligiblePlayerPool(
  players: AiPromptPlayer[],
  position: ContestPosition,
) {
  const lines = players.map((player) => {
    const parts = [`${player.name} — ${player.team} — ${position}`];
    if (player.opponent) parts.push(player.opponent);
    const kickoff = formatKickoff(player.gameStartsAt);
    if (kickoff) parts.push(kickoff);
    return `- ${parts.join(" — ")}`;
  });
  return ["PLAYER POOL", ...lines].join("\n");
}

export function buildAiPromptMeta(
  contest: AiPromptContest,
  options?: {
    aiDisplayName?: string | null;
    generatedAt?: Date;
  },
): AiPromptMeta {
  const generatedAt = options?.generatedAt ?? new Date();
  return {
    version: RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
    aiDisplayName: options?.aiDisplayName ?? null,
    seasonYear: contest.seasonYear,
    weekLabel: contest.weekLabel,
    weekNumber: contest.weekNumber,
    position: contest.position,
    fieldSize: contest.rankingDepth,
    eligiblePoolCount: contest.players.length,
    generatedAt,
    generatedAtLabel: formatInChicago(generatedAt, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }),
  };
}

export function buildAiRankingPrompt(
  contest: AiPromptContest,
  options?: {
    aiDisplayName?: string | null;
    generatedAt?: Date;
  },
): string {
  const depth = contest.rankingDepth;
  const pool = formatEligiblePlayerPool(contest.players, contest.position);
  const meta = buildAiPromptMeta(contest, options);

  const lockAt = contest.fullLockAt
    ? formatInChicago(contest.fullLockAt, {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : `Sunday 10:00 AM ${RANKIQ_TIMEZONE}`;

  const topLabel = `Top ${depth}`;

  return `You are competing in RankEyeQ, a weekly fantasy-football player-ranking competition.

Your goal is not to reproduce consensus rankings. Your goal is to predict which players will actually finish highest at this position this week.

Contest:
- Season: ${contest.seasonYear} ${contest.sport}
- Week: ${contest.weekLabel} (Week ${contest.weekNumber})
- Position: ${contest.position}
- Rank exactly ${depth} players (${topLabel})
- ${AI_WEEKLY_SCORING_RULES[0]}
- ${AI_WEEKLY_SCORING_RULES[1]}
- ${AI_WEEKLY_SCORING_RULES[2]}
- ${AI_WEEKLY_SCORING_RULES[3]}
- ${AI_WEEKLY_SCORING_RULES[4]}

Use projections and market expectations as inputs, but do not simply average or reproduce consensus.

Make an independent football forecast considering:
- projected workload/opportunity
- snap share / routes / touches
- injuries and depth-chart changes
- opponent and positional matchup
- offensive line / defensive front
- likely game script
- pace / scoring environment
- touchdown opportunity
- receiving involvement
- weather where relevant
- recent changes in role or team context

A player commonly ranked outside the ${topLabel} may be moved up if the matchup and role justify it.

A highly ranked consensus player may be moved down if context creates meaningful downside.

Do not be contrarian merely to be different.
Differences from consensus should come from football reasoning.

Before finalizing, internally check where your ranking meaningfully differs from conventional expectations and make sure those differences are intentional.

The objective is:
PREDICTION ACCURACY, NOT CONSENSUS AGREEMENT.

Only select players from the eligible pool below.

Return only the final ordered ranking as a numbered list (1 through ${depth}).

Lock context (for awareness — do not invent players):
- Each player or defense locks at their own NFL kickoff.
- Remaining unlocked slots lock at ${lockAt}.

${pool}

---
Prompt version: ${meta.version}
Generated: ${meta.generatedAtLabel}${
    meta.aiDisplayName ? `\nAI competitor: ${meta.aiDisplayName}` : ""
  }
Eligible pool count: ${meta.eligiblePoolCount}
Field size: ${meta.fieldSize}`;
}

export function buildAiPromptBundle(
  contest: AiPromptContest,
  options?: {
    aiDisplayName?: string | null;
    generatedAt?: Date;
  },
): AiPromptBundle {
  const meta = buildAiPromptMeta(contest, options);
  return {
    version: RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
    prompt: buildAiRankingPrompt(contest, options),
    poolText: formatEligiblePlayerPool(contest.players, contest.position),
    meta,
  };
}

export function buildAllPositionPrompts(
  contests: AiPromptContest[],
  botDisplayName?: string,
) {
  const header = [
    `RankEyeQ AI ranking prompts`,
    botDisplayName ? `AI competitor: ${botDisplayName}` : null,
    `Prompt version: ${RANKEYEQ_AI_WEEKLY_PROMPT_VERSION}`,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return (
    header +
    contests
      .map(
        (contest) =>
          `===== ${contest.position} · Top ${contest.rankingDepth} =====\n${buildAiRankingPrompt(contest, { aiDisplayName: botDisplayName })}`,
      )
      .join("\n\n")
  );
}
