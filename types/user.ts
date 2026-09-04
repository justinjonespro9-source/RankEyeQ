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
  isCreator?: boolean;
  suspended?: boolean;
  bio?: string;
  /** Expert analyst name when different from displayName. */
  expertAnalystName?: string | null;
  /** Expert publisher affiliation (Yahoo Fantasy, ESPN, …). */
  expertPublicationName?: string | null;
  /** Creator person name when different from displayName. */
  creatorPersonName?: string | null;
  /** Creator brand / show affiliation. */
  creatorBrandName?: string | null;
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
