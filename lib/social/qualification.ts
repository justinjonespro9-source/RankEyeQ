export type QualificationRules = {
  minGradedContests: number;
  requireActive: boolean;
  requireHuman: boolean;
  requireNoRestrictions: boolean;
  /** Lower is better. Null disables the check. */
  minSeasonPercentile: number | null;
  /** Lower is better. Null disables the check. */
  minPositionPercentile: number | null;
};

export const DEFAULT_QUALIFICATION_RULES: QualificationRules = {
  minGradedContests: 10,
  requireActive: true,
  requireHuman: true,
  requireNoRestrictions: true,
  minSeasonPercentile: null,
  minPositionPercentile: null,
};

export type QualificationStatus = "NOT_ELIGIBLE" | "ELIGIBLE" | "ENABLED";

export type QualificationInput = {
  profileType: "HUMAN" | "AI" | "BENCHMARK";
  status: "ACTIVE" | "SUSPENDED";
  gradedContestCount: number;
  creatorEnabled: boolean;
  seasonPercentile?: number | null;
  positionPercentile?: number | null;
};

export type QualificationResult = {
  status: QualificationStatus;
  eligible: boolean;
  reasons: string[];
  rules: QualificationRules;
};

export function getQualificationRules(
  overrides?: Partial<QualificationRules>,
): QualificationRules {
  return {
    ...DEFAULT_QUALIFICATION_RULES,
    ...overrides,
  };
}

/**
 * Derived creator qualification. Opt-in (`creatorEnabled`) is persisted separately.
 * V1 defaults to sample size + good standing, not performance thresholds.
 */
export function evaluateCreatorQualification(
  input: QualificationInput,
  rules: QualificationRules = DEFAULT_QUALIFICATION_RULES,
): QualificationResult {
  const reasons: string[] = [];

  if (rules.requireHuman && input.profileType !== "HUMAN") {
    reasons.push("Only human profiles can become payout creators");
  }
  if (rules.requireActive && input.status !== "ACTIVE") {
    reasons.push("Profile must be ACTIVE");
  }
  if (rules.requireNoRestrictions && input.status === "SUSPENDED") {
    reasons.push("Account restrictions block creator eligibility");
  }
  if (input.gradedContestCount < rules.minGradedContests) {
    reasons.push(
      `Need at least ${rules.minGradedContests} graded contests (${input.gradedContestCount} so far)`,
    );
  }
  if (rules.minSeasonPercentile != null) {
    if (
      input.seasonPercentile == null ||
      input.seasonPercentile > rules.minSeasonPercentile
    ) {
      reasons.push(
        `Season rank percentile must be ${rules.minSeasonPercentile} or better`,
      );
    }
  }
  if (rules.minPositionPercentile != null) {
    if (
      input.positionPercentile == null ||
      input.positionPercentile > rules.minPositionPercentile
    ) {
      reasons.push(
        `Position rank percentile must be ${rules.minPositionPercentile} or better`,
      );
    }
  }

  const eligible = reasons.length === 0;
  const status: QualificationStatus = !eligible
    ? "NOT_ELIGIBLE"
    : input.creatorEnabled
      ? "ENABLED"
      : "ELIGIBLE";

  return { status, eligible, reasons, rules };
}
