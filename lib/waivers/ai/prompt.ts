import { WAIVEREYEQ_AI_PROMPT_VERSION } from "@/lib/waivers/ai/constants";
import { sha256Utf8 } from "@/lib/waivers/ai/text";
import { effectiveMaxCalls } from "@/lib/waivers/board-shape";
import type { WaiverPosition } from "@/lib/waivers/constants";

/**
 * WAIVEREYEQ_AI_V1: the WaiverEyeQ prediction prompt, built only from a
 * contest's pinned frozen Waiver snapshot. Deterministic: the same snapshot,
 * position and contest settings always give the same text and sha256 (no
 * generation time, AI identity or live data).
 */

export type WaiverAiPromptPoolRow = {
  displayName: string;
  team: string | null;
  opponent: string | null;
  rosteredBps: number;
};

export type WaiverAiPromptInput = {
  seasonYear: number;
  weekNumber: number;
  position: WaiverPosition;
  /** The contest's configured maximum calls. */
  maxCalls: number;
  snapshot: { version: number; entriesFingerprint: string; thresholdBps: number };
  /** ELIGIBLE CANDIDATE rows of the pinned snapshot at this position, in frozen order. */
  pool: ReadonlyArray<WaiverAiPromptPoolRow>;
};

export type WaiverAiPrompt = {
  version: typeof WAIVEREYEQ_AI_PROMPT_VERSION;
  text: string;
  sha256: string;
  availableSlots: number;
  poolSize: number;
};

const POSITION_NAMES: Readonly<Record<WaiverPosition, string>> = {
  QB: "quarterback (QB)",
  RB: "running back (RB)",
  WR: "wide receiver (WR)",
  TE: "tight end (TE)",
  DEF: "team defense (DEF)",
};

function percent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function poolLine(row: WaiverAiPromptPoolRow): string {
  const details = [row.team, row.opponent ? `opp. ${row.opponent}` : null].filter(Boolean).join(", ");
  return `- ${row.displayName}${details ? ` (${details})` : ""} — rostered ${percent(row.rosteredBps)}`;
}

export function buildWaiverAiPrompt(input: WaiverAiPromptInput): WaiverAiPrompt {
  const slots = effectiveMaxCalls(input.maxCalls, input.pool.length);
  const position = POSITION_NAMES[input.position];
  const header = [
    `WaiverEyeQ prediction — ${WAIVEREYEQ_AI_PROMPT_VERSION}`,
    "",
    "This is WaiverEyeQ, RankEyeQ's Waivers game. It is NOT RankEyeQ Rankings: do not rank every player at the position.",
    "",
    `Task: from the frozen eligible waiver pool below, predict which ${position} players will score the most Half-PPR fantasy points in the ${input.seasonYear} NFL season, Week ${input.weekNumber}.`,
    "",
  ];
  if (slots === 0) {
    const text = [
      ...header,
      "The frozen eligible pool for this position is empty, so no picks are possible.",
      "",
      "Reply with exactly:",
      "NO CALLS",
      "",
      `Frozen eligible pool: none (Official Waiver ownership snapshot v${input.snapshot.version}, fingerprint ${input.snapshot.entriesFingerprint}).`,
    ].join("\n");
    return { version: WAIVEREYEQ_AI_PROMPT_VERSION, text, sha256: sha256Utf8(text), availableSlots: 0, poolSize: 0 };
  }

  const text = [
    ...header,
    "Rules:",
    `- Make up to ${slots} pick${slots === 1 ? "" : "s"}. Fewer picks are allowed.`,
    "- No reserves or alternates.",
    "- Rank your picks in order starting at #1. #1 is the player you expect to score the most Half-PPR points.",
    "- Scoring is Half-PPR (0.5 points per reception).",
    "- Use only players from the frozen eligible pool below, and copy each name exactly as written.",
    "- Do not invent, substitute or add players who are not in the pool.",
    "- If you would not pick anyone, reply with exactly: NO CALLS",
    "- Return only the ordered list: no title, explanation, notes or any other text.",
    "",
    "Response format:",
    ...Array.from({ length: slots }, (_, index) => `${index + 1}. Player Name`),
    "",
    `Frozen eligible pool — ${input.pool.length} player${input.pool.length === 1 ? "" : "s"} rostered below ${percent(input.snapshot.thresholdBps)} (Official Waiver ownership snapshot v${input.snapshot.version}, fingerprint ${input.snapshot.entriesFingerprint}):`,
    ...input.pool.map(poolLine),
  ].join("\n");
  return { version: WAIVEREYEQ_AI_PROMPT_VERSION, text, sha256: sha256Utf8(text), availableSlots: slots, poolSize: input.pool.length };
}

/**
 * Whether a rebuilt prompt is the one AI submissions answered, judged against
 * the prompt version and sha256 stored on AI responses for the same pinned
 * snapshot. CONFIRMED: every recorded prompt equals the rebuilt one.
 * MISMATCH: some recorded prompt differs. UNRECORDED: none was recorded.
 */
export type WaiverAiPromptProvenance = {
  status: "CONFIRMED" | "MISMATCH" | "UNRECORDED";
  recordedResponses: number;
  recordedHashes: Array<{ version: string; sha256: string }>;
};

export function waiverAiPromptProvenance(
  prompt: Pick<WaiverAiPrompt, "version" | "sha256">,
  recorded: ReadonlyArray<{ version: string; sha256: string; responses: number }>,
): WaiverAiPromptProvenance {
  return {
    status:
      recorded.length === 0
        ? "UNRECORDED"
        : recorded.every((row) => row.version === prompt.version && row.sha256 === prompt.sha256)
          ? "CONFIRMED"
          : "MISMATCH",
    recordedResponses: recorded.reduce((sum, row) => sum + row.responses, 0),
    recordedHashes: recorded.map(({ version, sha256 }) => ({ version, sha256 })),
  };
}
