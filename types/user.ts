import type { Position } from "./contest";

/**
 * Product surfaces that can attach to a universal Handicap Hero profile.
 * RankIQ does not own master identity — it references universalUserId when linked.
 */
export type ProductKey =
  | "overview"
  | "handicap-hero"
  | "rankiq"
  | "fantasytrack";

export type RankIQProfileStats = {
  overallRank: number | null;
  averageRankingScore: number | null;
  topHitRate: number | null;
  exactRankingHits: number | null;
  numberOneHits: number | null;
  podiumHits: number | null;
  bestWeek: string | null;
  currentStreak: number | null;
  positionRanks: Record<Position, number | null>;
};

/**
 * Universal-profile-ready user record.
 * `universalUserId` is the future cross-platform key (humans and AI bots).
 * RankIQ-local fields are display/contest projections, not a master identity.
 */
export type UniversalProfile = {
  universalUserId: string | null;
  username: string;
  displayName: string;
  isBot: boolean;
  isBenchmark?: boolean;
  suspended?: boolean;
  bio?: string;
  rankiq: RankIQProfileStats | null;
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  displayName: string;
  isBot: boolean;
  score: number;
  universalUserId: string | null;
};
