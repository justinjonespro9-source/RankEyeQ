import type { NflGameStatus } from "@/lib/generated/prisma/client";
import {
  SNG_EVENT_DISPOSITIONS,
  SNG_PARTICIPANT_DISPOSITIONS,
  SNG_PARTICIPATION_STATES,
  type SngEventDisposition,
  type SngParticipantDisposition,
  type SngParticipationState,
} from "@/lib/waivers/canonical/contract";

/**
 * Explicit SNG ↔ RankEyeQ vocabulary. Unknown values throw: nothing defaults.
 * Spelling differs by design: SNG CANCELLED ↔ RankEyeQ NflGameStatus CANCELED.
 */
export class CanonicalDispositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalDispositionError";
  }
}

function assertKnown<T extends string>(value: string, options: readonly T[], what: string): T {
  if (!(options as readonly string[]).includes(value)) throw new CanonicalDispositionError(`Unknown ${what}: ${value}`);
  return value as T;
}

export const parseSngEventDisposition = (value: string) => assertKnown<SngEventDisposition>(value, SNG_EVENT_DISPOSITIONS, "SNG event disposition");
export const parseSngParticipantDisposition = (value: string) =>
  assertKnown<SngParticipantDisposition>(value, SNG_PARTICIPANT_DISPOSITIONS, "SNG participant disposition");
export const parseSngParticipationState = (value: string) =>
  assertKnown<SngParticipationState>(value, SNG_PARTICIPATION_STATES, "SNG participation state");

const RANKEYEQ_GAME_STATUSES = ["SCHEDULED", "IN_PROGRESS", "FINAL", "POSTPONED", "CANCELED", "OTHER"] as const satisfies readonly NflGameStatus[];

/**
 * The RankEyeQ game status that corresponds to an SNG event disposition.
 * MOVED_OUT_OF_WEEK has no RankEyeQ equivalent (POSTPONED does not prove the
 * game left the week), so it maps to null rather than a guess.
 */
export function rankEyeQGameStatusForSngEvent(disposition: string): NflGameStatus | null {
  const parsed = parseSngEventDisposition(disposition);
  if (parsed === "PLAYED") return "FINAL";
  if (parsed === "CANCELLED") return "CANCELED";
  return null;
}

/** The SNG event disposition a terminal RankEyeQ game status corresponds to; null when not terminal. */
export function sngEventDispositionForRankEyeQGame(status: string): SngEventDisposition | null {
  const parsed = assertKnown<NflGameStatus>(status, RANKEYEQ_GAME_STATUSES, "RankEyeQ game status");
  if (parsed === "FINAL") return "PLAYED";
  if (parsed === "CANCELED") return "CANCELLED";
  return null;
}

/**
 * Approved Waivers handling class for a frozen-pool member's canonical result.
 *   RANKED              PARTICIPATED_WITH_STATS / PARTICIPATED_ZERO (0 is a real score)
 *   NON_PARTICIPANT     D1: VERIFIED_NON_PARTICIPANT via DNP / NO_ROSTER_ASSIGNMENT
 *   SYSTEMIC_NEUTRALIZE D2: CANCELLED_GAME / MOVED_OUT_OF_WEEK
 *   SNAPSHOT_CONFLICT   D3: BYE contradicts a frozen pool member's scheduled game
 *   BLOCKED             unresolved or incoherent; never scoreable
 */
export type WaiverCanonicalClass = "RANKED" | "NON_PARTICIPANT" | "SYSTEMIC_NEUTRALIZE" | "SNAPSHOT_CONFLICT" | "BLOCKED";

export function classifyCanonicalParticipation(stateValue: string, dispositionValue: string): { cls: WaiverCanonicalClass; reason: string } {
  const state = parseSngParticipationState(stateValue);
  const disposition = parseSngParticipantDisposition(dispositionValue);
  if (state === "UNKNOWN_INCOMPLETE" || state === "ABSENT_UNRESOLVED") {
    return { cls: "BLOCKED", reason: `${state} is not authoritative` };
  }
  if (state === "PARTICIPATED_WITH_STATS" || state === "PARTICIPATED_ZERO") {
    return disposition === "PLAYED"
      ? { cls: "RANKED", reason: state }
      : { cls: "BLOCKED", reason: `${state} with disposition ${disposition} is incoherent` };
  }
  switch (disposition) {
    case "DNP":
    case "NO_ROSTER_ASSIGNMENT":
      return { cls: "NON_PARTICIPANT", reason: disposition };
    case "CANCELLED_GAME":
    case "MOVED_OUT_OF_WEEK":
      return { cls: "SYSTEMIC_NEUTRALIZE", reason: disposition };
    case "BYE":
      return { cls: "SNAPSHOT_CONFLICT", reason: "BYE contradicts the frozen snapshot's scheduled game" };
    case "PLAYED":
    case "UNRESOLVED":
      return { cls: "BLOCKED", reason: `VERIFIED_NON_PARTICIPANT with disposition ${disposition} is incoherent` };
  }
}
