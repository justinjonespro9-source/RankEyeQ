import { isMissingTeam } from "@/lib/nfl/manual/parse-common";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type EligibilityInput = {
  position: ContestPosition;
  contestPosition: ContestPosition;
  team: string;
  opponent: string | null | undefined;
  kickoffAt: Date | null | undefined;
  active: boolean;
  excluded: boolean;
  hasWeeklyGame: boolean;
};

export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
};

/**
 * Explicit weekly eligibility — master directory presence alone is never enough.
 */
export function evaluateWeeklyEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const reasons: string[] = [];
  if (input.excluded) reasons.push("manually excluded");
  if (!input.active) reasons.push("inactive");
  if (input.position !== input.contestPosition) {
    reasons.push("position mismatch");
  }
  if (isMissingTeam(input.team)) reasons.push("no team / free agent");
  if (!input.hasWeeklyGame) reasons.push("team has no game this week");
  if (!input.opponent || input.opponent === "TBD") {
    reasons.push("missing opponent");
  }
  if (!input.kickoffAt) reasons.push("missing kickoff");
  return { eligible: reasons.length === 0, reasons };
}
