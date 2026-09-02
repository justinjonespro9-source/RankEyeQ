/**
 * Canonical FantasyTrack NFL fantasy scoring configuration.
 *
 * RankEyeQ and FantasyTrack both consume these rules for weekly player/D/ST
 * fantasy points and positional finishes. RankEyeQ ranking-accuracy scoring
 * (EYEQ) is separate — see lib/scoring.ts.
 */

/** Primary version slug — persist on Season/Week stat rows for reproducibility. */
export const FANTASYTRACK_NFL_FULL_PPR_V1 = "FANTASYTRACK_NFL_FULL_PPR_V1" as const;

/**
 * @deprecated Legacy slug stored on 2026 weeks — resolves to the same rules as
 * FANTASYTRACK_NFL_FULL_PPR_V1.
 */
export const RANKIQ_NFL_PPR_V1 = "RANKIQ_NFL_PPR_V1" as const;

export type FantasyScoringVersion = typeof FANTASYTRACK_NFL_FULL_PPR_V1;

export const DEFAULT_FANTASY_SCORING_VERSION = FANTASYTRACK_NFL_FULL_PPR_V1;

const VERSION_ALIASES: Record<string, FantasyScoringVersion> = {
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

export const PLAYER_FANTASY_RULES_V1: PlayerFantasyScoringRules = {
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
};

export const DEFENSE_FANTASY_RULES_V1: DefenseFantasyScoringRules = {
  version: FANTASYTRACK_NFL_FULL_PPR_V1,
  label: "Standard D/ST",
  sack: 1,
  interception: 2,
  fumbleRecovery: 2,
  defensiveOrStTd: 6,
  safety: 2,
  blockedKick: 2,
  pointsAllowedTiers: [
    { maxPoints: 0, fantasyPoints: 10 },
    { maxPoints: 6, fantasyPoints: 7 },
    { maxPoints: 13, fantasyPoints: 4 },
    { maxPoints: 20, fantasyPoints: 1 },
    { maxPoints: 27, fantasyPoints: 0 },
    { maxPoints: 34, fantasyPoints: -1 },
    { maxPoints: Number.POSITIVE_INFINITY, fantasyPoints: -4 },
  ],
};

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

export function getFantasyRules(version: string = DEFAULT_FANTASY_SCORING_VERSION) {
  const normalized = normalizeFantasyScoringVersion(version);
  if (normalized !== FANTASYTRACK_NFL_FULL_PPR_V1) {
    throw new Error(`Unsupported fantasy scoring version: ${version}`);
  }
  return {
    version: normalized,
    player: PLAYER_FANTASY_RULES_V1,
    defense: DEFENSE_FANTASY_RULES_V1,
  };
}
