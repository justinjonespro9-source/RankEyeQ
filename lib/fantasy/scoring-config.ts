/**
 * Canonical FantasyTrack NFL fantasy scoring configuration.
 *
 * RankEyeQ and FantasyTrack both consume these rules for weekly player/D/ST
 * fantasy points and positional finishes. RankEyeQ ranking-accuracy scoring
 * (EYEQ) is separate — see lib/scoring.ts.
 *
 * Versioning: persist the slug on Season/Week and on PlayerWeekStat /
 * DefenseWeekStat so historical weeks stay reproducible after rule changes.
 */

/**
 * Current canonical standard for new 2026 weekly scoring:
 * Half PPR + one-time yardage milestone bonuses.
 */
export const FANTASYTRACK_NFL_HALF_PPR_V2 =
  "FANTASYTRACK_NFL_HALF_PPR_V2" as const;

/**
 * Half PPR without milestone bonuses (pre-bonus Half PPR).
 * Kept for reproducibility if any week was frozen to this slug.
 */
export const FANTASYTRACK_NFL_HALF_PPR_V1 =
  "FANTASYTRACK_NFL_HALF_PPR_V1" as const;

/** Historical Full-PPR standard — keep for reproducibility of past weeks. */
export const FANTASYTRACK_NFL_FULL_PPR_V1 =
  "FANTASYTRACK_NFL_FULL_PPR_V1" as const;

/**
 * @deprecated Legacy slug — resolves to Full PPR (same rules as
 * FANTASYTRACK_NFL_FULL_PPR_V1). Do not use for new weeks.
 */
export const RANKIQ_NFL_PPR_V1 = "RANKIQ_NFL_PPR_V1" as const;

export type FantasyScoringVersion =
  | typeof FANTASYTRACK_NFL_HALF_PPR_V2
  | typeof FANTASYTRACK_NFL_HALF_PPR_V1
  | typeof FANTASYTRACK_NFL_FULL_PPR_V1;

export const DEFAULT_FANTASY_SCORING_VERSION = FANTASYTRACK_NFL_HALF_PPR_V2;

const VERSION_ALIASES: Record<string, FantasyScoringVersion> = {
  [FANTASYTRACK_NFL_HALF_PPR_V2]: FANTASYTRACK_NFL_HALF_PPR_V2,
  [FANTASYTRACK_NFL_HALF_PPR_V1]: FANTASYTRACK_NFL_HALF_PPR_V1,
  [FANTASYTRACK_NFL_FULL_PPR_V1]: FANTASYTRACK_NFL_FULL_PPR_V1,
  [RANKIQ_NFL_PPR_V1]: FANTASYTRACK_NFL_FULL_PPR_V1,
};

export type PlayerFantasyScoringRules = {
  version: FantasyScoringVersion;
  label: string;
  receptionPoints: number;
  passingYardsPerPoint: number;
  passingTd: number;
  interception: number;
  rushingYardsPerPoint: number;
  rushingTd: number;
  reception: number;
  receivingYardsPerPoint: number;
  receivingTd: number;
  twoPointConversion: number;
  fumbleLost: number;
  returnTd: number;
  /** One-time bonus when passing yards >= threshold (0 = disabled). */
  passingYardsBonus: number;
  passingYardsBonusAt: number;
  /** One-time bonus when rushing yards >= threshold (0 = disabled). */
  rushingYardsBonus: number;
  rushingYardsBonusAt: number;
  /** One-time bonus when receiving yards >= threshold (0 = disabled). */
  receivingYardsBonus: number;
  receivingYardsBonusAt: number;
};

export type DefenseFantasyScoringRules = {
  version: FantasyScoringVersion;
  label: string;
  sack: number;
  interception: number;
  fumbleRecovery: number;
  defensiveOrStTd: number;
  safety: number;
  blockedKick: number;
  pointsAllowedTiers: Array<{ maxPoints: number; fantasyPoints: number }>;
};

const SHARED_DEFENSE_TIERS: DefenseFantasyScoringRules["pointsAllowedTiers"] = [
  { maxPoints: 0, fantasyPoints: 10 },
  { maxPoints: 6, fantasyPoints: 7 },
  { maxPoints: 13, fantasyPoints: 4 },
  { maxPoints: 20, fantasyPoints: 1 },
  { maxPoints: 27, fantasyPoints: 0 },
  { maxPoints: 34, fantasyPoints: -1 },
  { maxPoints: Number.POSITIVE_INFINITY, fantasyPoints: -4 },
];

const NO_MILESTONE_BONUSES = {
  passingYardsBonus: 0,
  passingYardsBonusAt: 300,
  rushingYardsBonus: 0,
  rushingYardsBonusAt: 100,
  receivingYardsBonus: 0,
  receivingYardsBonusAt: 100,
} as const;

const HALF_PPR_MILESTONE_BONUSES = {
  passingYardsBonus: 5,
  passingYardsBonusAt: 300,
  rushingYardsBonus: 5,
  rushingYardsBonusAt: 100,
  receivingYardsBonus: 5,
  receivingYardsBonusAt: 100,
} as const;

/** Historical Full PPR (1.0 / reception), no yardage milestones. */
export const PLAYER_FANTASY_RULES_FULL_PPR_V1: PlayerFantasyScoringRules = {
  version: FANTASYTRACK_NFL_FULL_PPR_V1,
  label: "Full PPR (1.0 point per reception)",
  receptionPoints: 1,
  passingYardsPerPoint: 25,
  passingTd: 4,
  interception: -2,
  rushingYardsPerPoint: 10,
  rushingTd: 6,
  reception: 1,
  receivingYardsPerPoint: 10,
  receivingTd: 6,
  twoPointConversion: 2,
  fumbleLost: -2,
  returnTd: 6,
  ...NO_MILESTONE_BONUSES,
};

export const DEFENSE_FANTASY_RULES_FULL_PPR_V1: DefenseFantasyScoringRules = {
  version: FANTASYTRACK_NFL_FULL_PPR_V1,
  label: "Standard D/ST",
  sack: 1,
  interception: 2,
  fumbleRecovery: 2,
  defensiveOrStTd: 6,
  safety: 2,
  blockedKick: 2,
  pointsAllowedTiers: SHARED_DEFENSE_TIERS,
};

/** Half PPR without milestones (historical). */
export const PLAYER_FANTASY_RULES_HALF_PPR_V1: PlayerFantasyScoringRules = {
  version: FANTASYTRACK_NFL_HALF_PPR_V1,
  label: "Half PPR (0.5 point per reception)",
  receptionPoints: 0.5,
  passingYardsPerPoint: 25,
  passingTd: 4,
  interception: -2,
  rushingYardsPerPoint: 10,
  rushingTd: 6,
  reception: 0.5,
  receivingYardsPerPoint: 10,
  receivingTd: 6,
  twoPointConversion: 2,
  fumbleLost: -2,
  returnTd: 6,
  ...NO_MILESTONE_BONUSES,
};

export const DEFENSE_FANTASY_RULES_HALF_PPR_V1: DefenseFantasyScoringRules = {
  version: FANTASYTRACK_NFL_HALF_PPR_V1,
  label: "Standard D/ST",
  sack: 1,
  interception: 2,
  fumbleRecovery: 2,
  defensiveOrStTd: 6,
  safety: 2,
  blockedKick: 2,
  pointsAllowedTiers: SHARED_DEFENSE_TIERS,
};

/** Canonical Half PPR + stackable yardage milestone bonuses. */
export const PLAYER_FANTASY_RULES_HALF_PPR_V2: PlayerFantasyScoringRules = {
  version: FANTASYTRACK_NFL_HALF_PPR_V2,
  label: "Half PPR (0.5 / reception) + yardage bonuses",
  receptionPoints: 0.5,
  passingYardsPerPoint: 25,
  passingTd: 4,
  interception: -2,
  rushingYardsPerPoint: 10,
  rushingTd: 6,
  reception: 0.5,
  receivingYardsPerPoint: 10,
  receivingTd: 6,
  twoPointConversion: 2,
  fumbleLost: -2,
  returnTd: 6,
  ...HALF_PPR_MILESTONE_BONUSES,
};

export const DEFENSE_FANTASY_RULES_HALF_PPR_V2: DefenseFantasyScoringRules = {
  version: FANTASYTRACK_NFL_HALF_PPR_V2,
  label: "Standard D/ST",
  sack: 1,
  interception: 2,
  fumbleRecovery: 2,
  defensiveOrStTd: 6,
  safety: 2,
  blockedKick: 2,
  pointsAllowedTiers: SHARED_DEFENSE_TIERS,
};

/** @deprecated Prefer explicit FULL / HALF_V1 / HALF_V2 rule constants. */
export const PLAYER_FANTASY_RULES_V1 = PLAYER_FANTASY_RULES_FULL_PPR_V1;
/** @deprecated Prefer explicit FULL / HALF_V1 / HALF_V2 rule constants. */
export const DEFENSE_FANTASY_RULES_V1 = DEFENSE_FANTASY_RULES_FULL_PPR_V1;

export function normalizeFantasyScoringVersion(
  version: string | null | undefined,
): FantasyScoringVersion {
  if (!version) return DEFAULT_FANTASY_SCORING_VERSION;
  const normalized = VERSION_ALIASES[version];
  if (!normalized) {
    throw new Error(`Unsupported fantasy scoring version: ${version}`);
  }
  return normalized;
}

export function isCanonicalNewWeekFantasyVersion(
  version: string | null | undefined,
) {
  return (
    normalizeFantasyScoringVersion(version ?? DEFAULT_FANTASY_SCORING_VERSION) ===
    FANTASYTRACK_NFL_HALF_PPR_V2
  );
}

export function getFantasyRules(
  version: string = DEFAULT_FANTASY_SCORING_VERSION,
) {
  const normalized = normalizeFantasyScoringVersion(version);
  if (normalized === FANTASYTRACK_NFL_HALF_PPR_V2) {
    return {
      version: normalized,
      player: PLAYER_FANTASY_RULES_HALF_PPR_V2,
      defense: DEFENSE_FANTASY_RULES_HALF_PPR_V2,
    };
  }
  if (normalized === FANTASYTRACK_NFL_HALF_PPR_V1) {
    return {
      version: normalized,
      player: PLAYER_FANTASY_RULES_HALF_PPR_V1,
      defense: DEFENSE_FANTASY_RULES_HALF_PPR_V1,
    };
  }
  return {
    version: normalized,
    player: PLAYER_FANTASY_RULES_FULL_PPR_V1,
    defense: DEFENSE_FANTASY_RULES_FULL_PPR_V1,
  };
}
