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
  formatPlayerInjuryPromptBlock,
  type WeeklyDesignation,
} from "@/lib/eligibility/player-week-availability";
import { isSelectableAvailability } from "@/lib/eligibility/weekly-status";

/** Stable identifier for the weekly AI competition prompt. Bump when instructions change. */
export const RANKEYEQ_AI_WEEKLY_PROMPT_VERSION = "RANKEYEQ_AI_WEEKLY_V6" as const;

export type AiPromptPlayer = {
  name: string;
  team: string;
  opponent: string;
  gameStartsAt: Date | null;
  /** Compat EntryAvailability (ACTIVE/Q/D/OUT/…). */
  availability?: EntryAvailability | string;
  /** Week-specific designation when known. */
  designation?: WeeklyDesignation | string;
  injuryDescription?: string | null;
  /** Raw NFL.com practice status (informational only). */
  practiceStatus?: string | null;
  /** Whether the player may be newly selected. */
  selectable?: boolean;
  /** Roster reason when excluded for IR/PUP/etc. */
  unavailableReason?: string | null;
  rankableEntryId?: string;
};

/** @deprecated Profile-specific locks are not included in universal V5 prompts. */
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
  /** All field players (eligible + unavailable + kicked off). */
  players: AiPromptPlayer[];
  unavailablePlayers?: AiPromptPlayer[];
  /** Ignored by universal V5 prompt builders (profile locks stay on import). */
  lockedSelections?: AiLockedSelection[];
};

/** Universal prompts are always fresh; locks are applied only at profile-scoped import. */
export type AiPromptMode = "fresh";

export type AiPromptBundle = {
  version: typeof RANKEYEQ_AI_WEEKLY_PROMPT_VERSION;
  prompt: string;
  poolText: string;
  meta: AiPromptMeta;
};

export type AiPromptMeta = {
  version: typeof RANKEYEQ_AI_WEEKLY_PROMPT_VERSION;
  seasonYear: number;
  weekLabel: string;
  weekNumber: number;
  position: ContestPosition;
  fieldSize: number;
  scoringDepth: number;
  eligiblePoolCount: number;
  unavailableCount: number;
  kickedOffCount: number;
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

function playerIsSelectable(player: AiPromptPlayer): boolean {
  if (player.unavailableReason) return false;
  const designation = String(player.designation ?? "").toUpperCase();
  if (designation === "OUT" || designation === "INACTIVE") return false;
  if (
    designation === "AVAILABLE" ||
    designation === "QUESTIONABLE" ||
    designation === "DOUBTFUL" ||
    designation === "UNKNOWN"
  ) {
    return true;
  }
  return isSelectableAvailability(player.availability ?? "ACTIVE");
}

function playerHasKickedOff(player: AiPromptPlayer, now: Date): boolean {
  return player.gameStartsAt != null && now >= player.gameStartsAt;
}

/**
 * Split pool for the universal prompt.
 * Kicked-off players are NOT classified as officially unavailable/OUT.
 */
export function partitionAiPromptPlayers(
  players: AiPromptPlayer[],
  now: Date = new Date(),
): {
  eligible: AiPromptPlayer[];
  unavailable: AiPromptPlayer[];
  kickedOff: AiPromptPlayer[];
} {
  const eligible: AiPromptPlayer[] = [];
  const unavailable: AiPromptPlayer[] = [];
  const kickedOff: AiPromptPlayer[] = [];
  for (const player of players) {
    if (!playerIsSelectable(player)) {
      unavailable.push(player);
      continue;
    }
    if (playerHasKickedOff(player, now)) {
      kickedOff.push(player);
      continue;
    }
    eligible.push(player);
  }
  return { eligible, unavailable, kickedOff };
}

function designationLabel(player: AiPromptPlayer): string {
  if (player.unavailableReason) return String(player.unavailableReason);
  const designation = String(
    player.designation ??
      (player.availability === "ACTIVE"
        ? "AVAILABLE"
        : (player.availability ?? "AVAILABLE")),
  ).toUpperCase();
  if (designation === "ACTIVE") return "AVAILABLE";
  return designation;
}

function formatPlayerLine(
  player: AiPromptPlayer,
  _position: ContestPosition,
  opts?: { forceStatus?: string | null; includeKickoff?: boolean },
) {
  const status = opts?.forceStatus ?? designationLabel(player);
  const selectable =
    player.selectable ??
    (player.unavailableReason == null && playerIsSelectable(player));
  const block = formatPlayerInjuryPromptBlock({
    name: player.name,
    team: player.team,
    resolvedAvailabilityLabel: status,
    selectable,
    injuryDescription: player.injuryDescription,
    practiceStatus: player.practiceStatus,
    designation: player.designation ?? status,
  });
  const extras: string[] = [];
  if (player.opponent) extras.push(player.opponent);
  if (opts?.includeKickoff !== false) {
    const kickoff = formatKickoff(player.gameStartsAt);
    if (kickoff) extras.push(kickoff);
  }
  if (extras.length === 0) return `- ${block}`;
  return `- ${block}\n  Matchup: ${extras.join(" — ")}`;
}

/**
 * Eligible pool block for prompts.
 * Selectable: AVAILABLE / QUESTIONABLE / DOUBTFUL / UNKNOWN (not kicked off).
 */
export function formatEligiblePlayerPool(
  players: AiPromptPlayer[],
  position: ContestPosition,
) {
  if (players.length === 0) {
    return [
      "ELIGIBLE PLAYER POOL",
      "(empty — eligible pool count is 0; do not invent players)",
    ].join("\n");
  }
  const lines = players.map((player) => formatPlayerLine(player, position));
  return ["ELIGIBLE PLAYER POOL", ...lines].join("\n");
}

export function formatUnavailablePlayerPool(
  players: AiPromptPlayer[],
  position: ContestPosition,
) {
  if (players.length === 0) return "";
  const lines = players.map((player) =>
    formatPlayerLine(player, position, {
      forceStatus: designationLabel(player),
    }),
  );
  return ["UNAVAILABLE — DO NOT SELECT", ...lines].join("\n");
}

/** Players whose games have started — cannot be newly added; not official OUT. */
export function formatKickedOffPlayerPool(
  players: AiPromptPlayer[],
  position: ContestPosition,
) {
  if (players.length === 0) return "";
  const lines = players.map((player) =>
    formatPlayerLine(player, position, {
      forceStatus: "Kicked off",
      includeKickoff: true,
    }),
  );
  return ["KICKED OFF — CANNOT BE ADDED", ...lines].join("\n");
}

/** @deprecated Universal V5 prompts do not include profile-specific locked selections. */
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
    generatedAt?: Date;
    eligibleCount?: number;
    unavailableCount?: number;
    kickedOffCount?: number;
  },
): AiPromptMeta {
  const generatedAt = options?.generatedAt ?? new Date();
  return {
    version: RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
    seasonYear: contest.seasonYear,
    weekLabel: contest.weekLabel,
    weekNumber: contest.weekNumber,
    position: contest.position,
    fieldSize: contest.submissionDepth,
    scoringDepth: contest.rankingDepth,
    eligiblePoolCount: options?.eligibleCount ?? contest.players.length,
    unavailableCount: options?.unavailableCount ?? 0,
    kickedOffCount: options?.kickedOffCount ?? 0,
    mode: "fresh",
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

function refreshInstruction(contest: AiPromptContest): string {
  return `Refresh / re-rank instruction:
Refresh your Week ${contest.weekNumber} rankings using the current player pool and latest availability information. Rank independently from scratch.

Do not reuse or anchor on any previous ranking you may have produced for this week.
Do not select unavailable players.
Do not select kicked-off players.`;
}

export function buildAiRankingPrompt(
  contest: AiPromptContest,
  options?: {
    /** Ignored — universal prompts never include AI profile/model identity. */
    aiDisplayName?: string | null;
    generatedAt?: Date;
    /** Ignored — universal prompts are always fresh; locks apply at import. */
    mode?: string;
    now?: Date;
  },
): string {
  const depth = contest.submissionDepth;
  const scoringDepth = contest.rankingDepth;
  const now = options?.now ?? options?.generatedAt ?? new Date();

  const partitioned = partitionAiPromptPlayers(contest.players, now);
  const unavailable = [
    ...partitioned.unavailable,
    ...(contest.unavailablePlayers ?? []),
  ];
  const seenUnavailable = new Set<string>();
  const unavailableDeduped = unavailable.filter((player) => {
    const key = `${player.name}|${player.team}`;
    if (seenUnavailable.has(key)) return false;
    seenUnavailable.add(key);
    return true;
  });
  const kickedOff = partitioned.kickedOff;

  const eligible = partitioned.eligible;
  const pool = formatEligiblePlayerPool(eligible, contest.position);
  const unavailableBlock = formatUnavailablePlayerPool(
    unavailableDeduped,
    contest.position,
  );
  const kickedOffBlock = formatKickedOffPlayerPool(kickedOff, contest.position);
  const meta = buildAiPromptMeta(contest, {
    generatedAt: options?.generatedAt ?? now,
    eligibleCount: eligible.length,
    unavailableCount: unavailableDeduped.length,
    kickedOffCount: kickedOff.length,
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
- QUESTIONABLE and DOUBTFUL players remain selectable — weigh availability risk, but do not treat them as automatic outs
- OUT and INACTIVE players are not selectable
- Roster-unavailable players (IR / PUP / SUSPENDED / FREE_AGENT) are not selectable
- Players listed under KICKED OFF — CANNOT BE ADDED have already started and must not be newly selected
- Injury Watch (DNP / Limited) and practice participation are risk/context signals only — never interpret DNP or Limited as OUT, QUESTIONABLE, or DOUBTFUL
- Only the resolved availability / Selectable field determines whether a player is eligible
- You may use legitimate injury body-part and practice information when deciding where to rank an otherwise eligible player
- Rank reserves honestly as your next-best choices — do not treat them as throwaway picks
- ${AI_WEEKLY_SCORING_RULES[0]}
- ${AI_WEEKLY_SCORING_RULES[1]}
- ${AI_WEEKLY_SCORING_RULES[2]}
- ${AI_WEEKLY_SCORING_RULES[3]}
- ${AI_WEEKLY_SCORING_RULES[4]}

${refreshInstruction(contest)}

Use projections and market expectations as inputs, but do not simply average or reproduce consensus.

Make an independent football forecast considering:
- projected workload/opportunity
- snap share / routes / touches
- injuries and depth-chart changes
- official Game Status when issued (Questionable / Doubtful / Out)
- Injury Watch / practice participation (DNP, Limited, Full) as context only — never as automatic outs
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

Select players only from the ELIGIBLE PLAYER POOL below.
Never select anyone listed under UNAVAILABLE — DO NOT SELECT.
Never select anyone listed under KICKED OFF — CANNOT BE ADDED.
QUESTIONABLE and DOUBTFUL players appear in the eligible pool and may be selected; consider their availability risk.
OUT and INACTIVE players are not selectable.
Roster-unavailable players are not selectable.
Kicked-off players are not newly selectable (their games have started).
DNP and Limited practice statuses are Injury Watch context only — do not treat them as OUT.
Only resolved availability (Selectable: yes/no) determines eligibility.

Return only the final ordered ranking as a numbered list (1 through ${depth}).

Lock context (for awareness — do not invent players):
- Each player or defense locks at their own NFL kickoff.
- Remaining unlocked slots lock at ${lockAt}.

${pool}${
    unavailableBlock ? `\n\n${unavailableBlock}` : ""
  }${kickedOffBlock ? `\n\n${kickedOffBlock}` : ""}

---
Prompt version: ${meta.version}
Generated: ${meta.generatedAtLabel}
Mode: ${meta.mode}
Eligible pool count: ${meta.eligiblePoolCount}
Unavailable count: ${meta.unavailableCount}
Kicked off count: ${meta.kickedOffCount}
Field size: ${meta.fieldSize}
Scoring depth: ${meta.scoringDepth}`;
}

export function buildAiPromptBundle(
  contest: AiPromptContest,
  options?: {
    aiDisplayName?: string | null;
    generatedAt?: Date;
    mode?: string;
    now?: Date;
  },
): AiPromptBundle {
  const now = options?.now ?? options?.generatedAt ?? new Date();
  const partitioned = partitionAiPromptPlayers(contest.players, now);
  const meta = buildAiPromptMeta(contest, {
    generatedAt: options?.generatedAt ?? now,
    eligibleCount: partitioned.eligible.length,
    unavailableCount:
      partitioned.unavailable.length + (contest.unavailablePlayers?.length ?? 0),
    kickedOffCount: partitioned.kickedOff.length,
  });
  return {
    version: RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
    prompt: buildAiRankingPrompt(contest, options),
    poolText: formatEligiblePlayerPool(partitioned.eligible, contest.position),
    meta,
  };
}

export function buildAllPositionPrompts(contests: AiPromptContest[]) {
  const header = [
    `RankEyeQ AI ranking prompts`,
    `Prompt version: ${RANKEYEQ_AI_WEEKLY_PROMPT_VERSION}`,
    "",
  ].join("\n");

  return (
    header +
    contests
      .map(
        (contest) =>
          `===== ${contest.position} · Top ${contest.rankingDepth} + 2 reserves =====\n${buildAiRankingPrompt(contest)}`,
      )
      .join("\n\n")
  );
}
