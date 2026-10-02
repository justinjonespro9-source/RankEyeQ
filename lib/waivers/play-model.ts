import {
  WAIVER_MAX_CALLS,
  WAIVER_POSITIONS,
  WAIVER_SLOT_LABELS,
  type WaiverPosition,
  type WaiverSlotLabel,
} from "@/lib/waivers/constants";

/**
 * Pure model for the public weekly Waivers play surface: week selection,
 * per-position state, board editing, and display copy. No DB, no clock — the
 * server supplies the authoritative instant and every fact.
 */

export const DEFAULT_WAIVER_PLAY_POSITION: WaiverPosition = "QB";

/** `?position=` value → Waivers position (case-insensitive); anything else → QB. */
export function parseWaiverPlayPosition(raw: unknown): WaiverPosition {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return DEFAULT_WAIVER_PLAY_POSITION;
  const upper = value.trim().toUpperCase();
  return (WAIVER_POSITIONS as readonly string[]).includes(upper) ? (upper as WaiverPosition) : DEFAULT_WAIVER_PLAY_POSITION;
}

export function waiverPlayHref(position: WaiverPosition): string {
  return `/waivers?position=${position}`;
}

export function waiverSignInHref(position: WaiverPosition): string {
  return `/signin?callbackUrl=${encodeURIComponent(waiverPlayHref(position))}`;
}

export type WaiverPlayWeekCandidate = {
  weekId: string;
  weekNumber: number;
  /** A current snapshot or at least one contest exists for the week. */
  hasWaiverActivity: boolean;
  firstKickoffAt: Date | null;
};

/**
 * The week the Waivers surface shows: the latest week with Waivers activity;
 * otherwise the next week whose first kickoff is still ahead (pool being
 * prepared); otherwise none.
 */
export function selectWaiverPlayWeek(
  candidates: ReadonlyArray<WaiverPlayWeekCandidate>,
  now: Date,
): { weekId: string; hasWaiverActivity: boolean } | null {
  let active: WaiverPlayWeekCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.hasWaiverActivity && (!active || candidate.weekNumber > active.weekNumber)) active = candidate;
  }
  if (active) return { weekId: active.weekId, hasWaiverActivity: true };

  let upcoming: WaiverPlayWeekCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate.firstKickoffAt || candidate.firstKickoffAt.getTime() <= now.getTime()) continue;
    if (!upcoming || candidate.weekNumber < upcoming.weekNumber) upcoming = candidate;
  }
  return upcoming ? { weekId: upcoming.weekId, hasWaiverActivity: false } : null;
}

export type WaiverPlayState =
  | "NO_WEEK"
  | "POOL_PREPARING"
  | "POOL_READY"
  | "NO_PLAYERS"
  | "OPEN"
  | "LOCKED";

/** Per-position state from server facts. `contest.locked` must come from the server clock. */
export function resolveWaiverPlayState(input: {
  hasWeek: boolean;
  hasCurrentSnapshot: boolean;
  /** Eligible players at this position in the current snapshot (when no contest). */
  snapshotEligibleAtPosition: number;
  contest: null | { locked: boolean; poolSize: number };
}): WaiverPlayState {
  if (!input.hasWeek) return "NO_WEEK";
  if (input.contest) {
    if (input.contest.locked) return "LOCKED";
    return input.contest.poolSize === 0 ? "NO_PLAYERS" : "OPEN";
  }
  if (!input.hasCurrentSnapshot) return "POOL_PREPARING";
  return input.snapshotEligibleAtPosition === 0 ? "NO_PLAYERS" : "POOL_READY";
}

export const WAIVER_PLAY_STATE_COPY: Readonly<Record<Exclude<WaiverPlayState, "OPEN" | "LOCKED">, string>> = {
  NO_WEEK: "Waivers aren't open yet.",
  POOL_PREPARING: "This week's waiver pool is being prepared.",
  POOL_READY: "This week's waiver pool is ready. Check back when Waivers opens.",
  NO_PLAYERS: "No eligible waiver players were available for this position in the official snapshot.",
};

export const WAIVER_NO_BOARD_AFTER_LOCK = "No submitted Waiver board for this position.";
export const WAIVER_RESULTS_PENDING = "Results pending.";
export const WAIVER_EYEQ_FUTURE_COPY =
  "Your Waiver EyeQ will measure how accurately you spotted the week's best available fantasy performers.";

/** The viewer's own board standing at one position. */
export type WaiverViewerBoardStatus =
  | "NONE"
  | "DRAFT"
  | "SUBMITTED"
  | "ABSTAINED"
  | "LOCKED_IN"
  | "LOCKED_ABSTAINED"
  | "MISSED";

export function resolveWaiverViewerBoardStatus(input: {
  locked: boolean;
  board: null | { competitive: boolean; callCount: number };
}): WaiverViewerBoardStatus {
  const board = input.board;
  if (input.locked) {
    if (!board || !board.competitive) return "MISSED";
    return board.callCount === 0 ? "LOCKED_ABSTAINED" : "LOCKED_IN";
  }
  if (!board) return "NONE";
  if (!board.competitive) return board.callCount === 0 ? "NONE" : "DRAFT";
  return board.callCount === 0 ? "ABSTAINED" : "SUBMITTED";
}

export const WAIVER_VIEWER_STATUS_LABEL: Readonly<Record<WaiverViewerBoardStatus, string>> = {
  NONE: "Not started",
  DRAFT: "Draft — not submitted",
  SUBMITTED: "Submitted",
  ABSTAINED: "Submitted with no calls",
  LOCKED_IN: "Locked",
  LOCKED_ABSTAINED: "Locked — no calls",
  MISSED: "No submitted board",
};

export function waiverSlotLabels(availableSlots: number): WaiverSlotLabel[] {
  return WAIVER_SLOT_LABELS.slice(0, Math.max(0, Math.min(availableSlots, WAIVER_SLOT_LABELS.length)));
}

/** Maximum calls for a position after the eligible-pool cap. */
export function waiverAvailableSlots(position: WaiverPosition, poolSize: number): number {
  return Math.max(0, Math.min(WAIVER_MAX_CALLS[position], poolSize));
}

export type WaiverBoardEditResult =
  | { ok: true; calls: string[] }
  | { ok: false; reason: "FULL" | "DUPLICATE" | "NOT_IN_POOL" | "OUT_OF_RANGE" };

/**
 * Board edits on a contiguous call list (index 0 = WIN). Every result stays
 * contiguous, so a gap can never be produced client-side; the server
 * re-validates regardless.
 */
export function addWaiverCall(
  calls: ReadonlyArray<string>,
  playerId: string,
  input: { availableSlots: number; poolIds: ReadonlySet<string> },
): WaiverBoardEditResult {
  if (!input.poolIds.has(playerId)) return { ok: false, reason: "NOT_IN_POOL" };
  if (calls.includes(playerId)) return { ok: false, reason: "DUPLICATE" };
  if (calls.length >= input.availableSlots) return { ok: false, reason: "FULL" };
  return { ok: true, calls: [...calls, playerId] };
}

export function removeWaiverCall(calls: ReadonlyArray<string>, index: number): WaiverBoardEditResult {
  if (!Number.isInteger(index) || index < 0 || index >= calls.length) return { ok: false, reason: "OUT_OF_RANGE" };
  return { ok: true, calls: calls.filter((_, i) => i !== index) };
}

export function moveWaiverCall(calls: ReadonlyArray<string>, index: number, direction: -1 | 1): WaiverBoardEditResult {
  const target = index + direction;
  if (!Number.isInteger(index) || index < 0 || index >= calls.length || target < 0 || target >= calls.length) {
    return { ok: false, reason: "OUT_OF_RANGE" };
  }
  const next = [...calls];
  [next[index], next[target]] = [next[target], next[index]];
  return { ok: true, calls: next };
}

export function sameWaiverCalls(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Why a pool player can't be added right now (null = addable). */
export function waiverAddBlockReason(input: {
  playerId: string;
  calls: ReadonlyArray<string>;
  availableSlots: number;
}): null | "ON_BOARD" | "FULL" {
  if (input.calls.includes(input.playerId)) return "ON_BOARD";
  if (input.calls.length >= input.availableSlots) return "FULL";
  return null;
}

export function waiverCallCountLabel(callCount: number, availableSlots: number): string {
  return `${callCount} of ${availableSlots} ${availableSlots === 1 ? "call" : "calls"}`;
}

/** Short hint under the board; never exposes the coverage formula. */
export function waiverBoardHint(callCount: number, availableSlots: number): string {
  if (callCount === 0) return "Add players from the pool, or submit with no calls to sit this position out.";
  if (callCount < availableSlots) return "Fewer calls are allowed. Fuller boards will earn more coverage credit in Waiver EyeQ.";
  return "Board full. Reorder or swap players any time before lock.";
}

/**
 * Frozen ownership (basis points) as "11.5%": truncated to a tenth so a
 * sub-threshold value is never displayed at or above the threshold.
 */
export function formatRosteredPercent(rosteredBps: number): string {
  if (!Number.isFinite(rosteredBps) || rosteredBps <= 0) return "0%";
  const tenths = Math.floor(rosteredBps / 10);
  if (tenths === 0) return "<0.1%";
  const whole = Math.floor(tenths / 10);
  const fraction = tenths % 10;
  return fraction === 0 ? `${whole}%` : `${whole}.${fraction}%`;
}

export type WaiverMatchupSide = "HOME" | "AWAY";

/**
 * Home/away from the snapshot's pinned game, accepted only when that game's
 * two teams are exactly the frozen team and frozen opponent. Anything else is
 * unknown (null) rather than guessed. Team codes must already be normalized.
 */
export function resolveWaiverMatchupSide(input: {
  teamAtFreeze: string | null;
  opponentAtFreeze: string | null;
  pinnedGame: null | { homeTeam: string; awayTeam: string };
}): WaiverMatchupSide | null {
  const { teamAtFreeze: team, opponentAtFreeze: opponent, pinnedGame: game } = input;
  if (!team || !opponent || !game || team === opponent) return null;
  if (game.homeTeam === team && game.awayTeam === opponent) return "HOME";
  if (game.awayTeam === team && game.homeTeam === opponent) return "AWAY";
  return null;
}

/** "@ DET" away, "vs DET" home, "Opp DET" when orientation is unknown. */
export function formatWaiverMatchup(opponent: string | null, side: WaiverMatchupSide | null): string | null {
  if (!opponent) return null;
  if (side === "AWAY") return `@ ${opponent}`;
  if (side === "HOME") return `vs ${opponent}`;
  return `Opp ${opponent}`;
}

export type WaiverDraftSaveState = "idle" | "saving" | "saved" | "error";

/**
 * Board progress line ("1 of 3 calls · Submitted"). Signed-out visitors have
 * no board, so a locked position reads only "Locked". After lock, draft calls
 * that never competed are not progress. Revision numbers stay internal.
 */
export function waiverBoardSummary(input: {
  signedIn: boolean;
  locked: boolean;
  boardStatus: WaiverViewerBoardStatus | null;
  editable: boolean;
  revising: boolean;
  draftSave: WaiverDraftSaveState;
  callCount: number;
  availableSlots: number;
}): string {
  if (input.locked) {
    if (!input.signedIn) return "Locked";
    if (input.boardStatus !== "LOCKED_IN" && input.boardStatus !== "LOCKED_ABSTAINED") return "No submission · Locked";
  }
  const count = waiverCallCountLabel(input.callCount, input.availableSlots);
  const status = waiverBoardStatusLine(input);
  return status ? `${count} · ${status}` : count;
}

function waiverBoardStatusLine(input: {
  locked: boolean;
  boardStatus: WaiverViewerBoardStatus | null;
  editable: boolean;
  revising: boolean;
  draftSave: WaiverDraftSaveState;
  callCount: number;
}): string | null {
  if (input.locked) return "Locked";
  if (input.revising) return "Revising — not yet submitted";
  if (input.boardStatus === "SUBMITTED") return "Submitted";
  if (input.boardStatus === "ABSTAINED") return "Submitted with no calls";
  if (!input.editable) return null;
  if (input.callCount === 0) return "Not submitted";
  switch (input.draftSave) {
    case "saving":
      return "Saving draft…";
    case "saved":
      return "Draft saved · not submitted";
    case "error":
      return "Draft not saved";
    default:
      return "Draft · not submitted";
  }
}

/** Feedback after a successful submit. Revision numbers stay internal. */
export function waiverSubmitFeedback(input: {
  position: string;
  changed: boolean;
  callCount: number;
  revised: boolean;
}): string {
  if (!input.changed) return "No changes. Your submitted picks are unchanged.";
  if (input.callCount === 0) {
    return `Submitted with no calls. You're sitting out ${input.position} this week unless you revise before lock.`;
  }
  return input.revised ? "Picks updated." : "Picks submitted.";
}

const DESIGNATION_LABEL: Readonly<Record<string, string>> = {
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  INACTIVE: "Inactive",
};

/** Availability tag recorded at freeze; healthy/unknown players get none. */
export function waiverAvailabilityLabel(designation: string | null | undefined): string | null {
  return designation ? (DESIGNATION_LABEL[designation] ?? null) : null;
}
