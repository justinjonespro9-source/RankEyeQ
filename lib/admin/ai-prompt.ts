import { formatInChicago, RANKIQ_TIMEZONE } from "@/lib/timing/chicago";
import {
  rankingDepthForPosition,
  submissionDepthForPosition,
} from "@/lib/contest-defaults";
import type {
  ContestPosition,
  EntryAvailability,
} from "@/lib/generated/prisma/client";
import {
  availabilityPromptMarker,
  isSelectableAvailability,
} from "@/lib/eligibility/weekly-status";

/** Stable identifier for the weekly AI competition prompt. Bump when instructions change. */
export const RANKEYEQ_AI_WEEKLY_PROMPT_VERSION = "RANKEYEQ_AI_WEEKLY_V3" as const;

export type AiPromptPlayer = {
  name: string;
  team: string;
  opponent: string;
  gameStartsAt: Date | null;
  availability?: EntryAvailability | string;
  rankableEntryId?: string;
};

export type AiLockedSelection = {
  rank: number;
  name: string;
  team: string;
  rankableEntryId?: string;
};

export type AiPromptContest = {
  title: string;
  seasonYear: number;
  sport: string;
  weekLabel: string;
  weekNumber: number;
  position: ContestPosition;
  /** Scoring depth (Top 10 / Top 15). */
  rankingDepth: number;
  /** Submission depth including ordered reserves (12 / 17). */
  submissionDepth: number;
  rankingsOpenAt: Date | null;
  fullLockAt: Date | null;
  /** All field players (eligible + unavailable). Caller may also split. */
  players: AiPromptPlayer[];
  unavailablePlayers?: AiPromptPlayer[];
  lockedSelections?: AiLockedSelection[];
};

export type AiPromptMode = "fresh" | "rerank-with-locks";

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
  scoringDepth: number;
  eligiblePoolCount: number;
  unavailableCount: number;
  lockedCount: number;
  mode: AiPromptMode;
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
  return submissionDepthForPosition(position);
}

export function expectedAiScoringDepth(position: ContestPosition): number {
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

export function partitionAiPromptPlayers(
  players: AiPromptPlayer[],
  now: Date = new Date(),
): {
  eligible: AiPromptPlayer[];
  unavailable: AiPromptPlayer[];
} {
  const eligible: AiPromptPlayer[] = [];
  const unavailable: AiPromptPlayer[] = [];
  for (const player of players) {
    const started =
      player.gameStartsAt != null && now >= player.gameStartsAt;
    if (started || !isSelectableAvailability(player.availability ?? "ACTIVE")) {
      unavailable.push(player);
    } else {
      eligible.push(player);
    }
  }
  return { eligible, unavailable };
}

function formatPlayerLine(
  player: AiPromptPlayer,
  position: ContestPosition,
  opts?: { forceStatus?: string | null },
) {
  const parts = [`${player.name} — ${player.team} — ${position}`];
  if (player.opponent) parts.push(player.opponent);
  const kickoff = formatKickoff(player.gameStartsAt);
  if (kickoff) parts.push(kickoff);
  const marker =
    opts?.forceStatus ??
    availabilityPromptMarker(player.availability ?? "ACTIVE");
  if (marker) parts.push(marker);
  return `- ${parts.join(" — ")}`;
}

/**
 * Eligible pool block for prompts.
 * Only selectable (ACTIVE / Q / D) and not-yet-started players.
 */
export function formatEligiblePlayerPool(
  players: AiPromptPlayer[],
  position: ContestPosition,
) {
  const lines = players.map((player) => formatPlayerLine(player, position));
  return ["ELIGIBLE PLAYER POOL", ...lines].join("\n");
}

export function formatUnavailablePlayerPool(
  players: AiPromptPlayer[],
  position: ContestPosition,
  now: Date = new Date(),
) {
  if (players.length === 0) return "";
  const lines = players.map((player) => {
    const started =
      player.gameStartsAt != null && now >= player.gameStartsAt;
    const status = started
      ? "Game started"
      : availabilityPromptMarker(player.availability ?? "OUT") ?? "Unavailable";
    return formatPlayerLine(player, position, { forceStatus: status });
  });
  return ["UNAVAILABLE — DO NOT SELECT", ...lines].join("\n");
}

export function formatLockedSelections(locked: AiLockedSelection[]) {
  if (locked.length === 0) return "";
  const lines = locked
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map(
      (row) =>
        `#${row.rank} ${row.name}${row.team ? ` — ${row.team}` : ""} — game already started`,
    );
  return [
    "LOCKED SELECTIONS — MUST REMAIN IN THESE EXACT SLOTS",
    ...lines,
  ].join("\n");
}

export function buildAiPromptMeta(
  contest: AiPromptContest,
  options?: {
    aiDisplayName?: string | null;
    generatedAt?: Date;
    mode?: AiPromptMode;
    eligibleCount?: number;
    unavailableCount?: number;
    lockedCount?: number;
  },
): AiPromptMeta {
  const generatedAt = options?.generatedAt ?? new Date();
  const mode =
    options?.mode ??
    ((contest.lockedSelections?.length ?? 0) > 0
      ? "rerank-with-locks"
      : "fresh");
  return {
    version: RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
    aiDisplayName: options?.aiDisplayName ?? null,
    seasonYear: contest.seasonYear,
    weekLabel: contest.weekLabel,
    weekNumber: contest.weekNumber,
    position: contest.position,
    fieldSize: contest.submissionDepth,
    scoringDepth: contest.rankingDepth,
    eligiblePoolCount: options?.eligibleCount ?? contest.players.length,
    unavailableCount: options?.unavailableCount ?? 0,
    lockedCount: options?.lockedCount ?? contest.lockedSelections?.length ?? 0,
    mode,
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

function refreshInstruction(
  contest: AiPromptContest,
  mode: AiPromptMode,
): string {
  if (mode === "rerank-with-locks") {
    return `Refresh / re-rank instruction:
Some selections are already locked because their games have started. Keep every locked player in the exact listed slot. Re-rank all remaining unlocked slots independently using the current eligible player pool.

Do not move, remove, or replace any locked selection.
Do not select unavailable players.
Do not use any prior unlocked ranking order as an anchor — re-rank unlocked slots from scratch.`;
  }
  return `Refresh / re-rank instruction:
Refresh your Week ${contest.weekNumber} rankings using the current player pool and latest availability information. Rank independently from scratch.

Do not reuse or anchor on any previous ranking you may have produced for this week.
Do not select unavailable players.`;
}

export function buildAiRankingPrompt(
  contest: AiPromptContest,
  options?: {
    aiDisplayName?: string | null;
    generatedAt?: Date;
    mode?: AiPromptMode;
    now?: Date;
  },
): string {
  const depth = contest.submissionDepth;
  const scoringDepth = contest.rankingDepth;
  const now = options?.now ?? options?.generatedAt ?? new Date();
  const locked = contest.lockedSelections ?? [];
  const mode =
    options?.mode ??
    (locked.length > 0 ? "rerank-with-locks" : "fresh");

  const partitioned = partitionAiPromptPlayers(contest.players, now);
  const unavailable = [
    ...partitioned.unavailable,
    ...(contest.unavailablePlayers ?? []),
  ];
  // Dedupe unavailable by name+team
  const seenUnavailable = new Set<string>();
  const unavailableDeduped = unavailable.filter((player) => {
    const key = `${player.name}|${player.team}`;
    if (seenUnavailable.has(key)) return false;
    seenUnavailable.add(key);
    return true;
  });

  // Locked players should not appear as newly selectable
  const lockedIds = new Set(
    locked
      .map((row) => row.rankableEntryId)
      .filter((id): id is string => Boolean(id)),
  );
  const lockedNames = new Set(
    locked.map((row) => `${row.name}|${row.team}`.toLowerCase()),
  );
  const eligible = partitioned.eligible.filter((player) => {
    if (player.rankableEntryId && lockedIds.has(player.rankableEntryId)) {
      return false;
    }
    return !lockedNames.has(`${player.name}|${player.team}`.toLowerCase());
  });

  const pool = formatEligiblePlayerPool(eligible, contest.position);
  const unavailableBlock = formatUnavailablePlayerPool(
    unavailableDeduped,
    contest.position,
    now,
  );
  const lockedBlock = formatLockedSelections(locked);
  const meta = buildAiPromptMeta(contest, {
    ...options,
    mode,
    eligibleCount: eligible.length,
    unavailableCount: unavailableDeduped.length,
    lockedCount: locked.length,
  });

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

  const topLabel = `Top ${scoringDepth}`;
  const reserveRanks = `${scoringDepth + 1}–${depth}`;

  return `You are competing in RankEyeQ, a weekly fantasy-football player-ranking competition.

Your goal is not to reproduce consensus rankings. Your goal is to predict which players will actually finish highest at this position this week.

Contest:
- Season: ${contest.seasonYear} ${contest.sport}
- Week: ${contest.weekLabel} (Week ${contest.weekNumber})
- Position: ${contest.position}
- Rank EXACTLY ${depth} players (numbered 1 through ${depth})
- Slots 1–${scoringDepth} are your scoring board (${topLabel})
- Slots ${reserveRanks} are ordered reserves (R1 then R2)
- Reserves may automatically promote into the scoring board if an active pick becomes officially unavailable (OUT / INACTIVE / IR / PUP / SUSPENDED / FREE_AGENT) before that player's kickoff
- Rank reserves honestly as your next-best choices — do not treat them as throwaway picks
- ${AI_WEEKLY_SCORING_RULES[0]}
- ${AI_WEEKLY_SCORING_RULES[1]}
- ${AI_WEEKLY_SCORING_RULES[2]}
- ${AI_WEEKLY_SCORING_RULES[3]}
- ${AI_WEEKLY_SCORING_RULES[4]}

${refreshInstruction(contest, mode)}

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

Only select players from the ELIGIBLE PLAYER POOL below.
Never select anyone listed under UNAVAILABLE — DO NOT SELECT.
${
  locked.length > 0
    ? "Keep every LOCKED SELECTION in its exact listed slot (including locked reserves) and fill only unlocked slots from the eligible pool."
    : ""
}

Return only the final ordered ranking as a numbered list (1 through ${depth}).

Lock context (for awareness — do not invent players):
- Each player or defense locks at their own NFL kickoff.
- Remaining unlocked slots lock at ${lockAt}.

${lockedBlock ? `${lockedBlock}\n\n` : ""}${pool}${
    unavailableBlock ? `\n\n${unavailableBlock}` : ""
  }

---
Prompt version: ${meta.version}
Generated: ${meta.generatedAtLabel}${
    meta.aiDisplayName ? `\nAI competitor: ${meta.aiDisplayName}` : ""
  }
Mode: ${meta.mode}
Eligible pool count: ${meta.eligiblePoolCount}
Unavailable count: ${meta.unavailableCount}
Locked slots: ${meta.lockedCount}
Field size: ${meta.fieldSize}
Scoring depth: ${meta.scoringDepth}`;
}

export function buildAiPromptBundle(
  contest: AiPromptContest,
  options?: {
    aiDisplayName?: string | null;
    generatedAt?: Date;
    mode?: AiPromptMode;
    now?: Date;
  },
): AiPromptBundle {
  const now = options?.now ?? options?.generatedAt ?? new Date();
  const locked = contest.lockedSelections ?? [];
  const mode =
    options?.mode ??
    (locked.length > 0 ? "rerank-with-locks" : "fresh");
  const partitioned = partitionAiPromptPlayers(contest.players, now);
  const meta = buildAiPromptMeta(contest, {
    ...options,
    mode,
    eligibleCount: partitioned.eligible.length,
    unavailableCount:
      partitioned.unavailable.length + (contest.unavailablePlayers?.length ?? 0),
    lockedCount: locked.length,
  });
  return {
    version: RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
    prompt: buildAiRankingPrompt(contest, options),
    poolText: formatEligiblePlayerPool(partitioned.eligible, contest.position),
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
          `===== ${contest.position} · Top ${contest.rankingDepth} + 2 reserves =====\n${buildAiRankingPrompt(contest, { aiDisplayName: botDisplayName })}`,
      )
      .join("\n\n")
  );
}
