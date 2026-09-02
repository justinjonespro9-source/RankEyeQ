export type Position = "qb" | "rb" | "wr" | "te" | "def";

export type ContestStatus = "open" | "locked";

/** Dev/test contest lifecycle for the ranking prototype. */
export type ContestMode = "open" | "locked" | "final";

export type PlayerAvailability =
  | "active"
  | "questionable"
  | "doubtful"
  | "out";

export type ContestPositionConfig = {
  position: Position;
  label: string;
  shortLabel: string;
  slotCount: number;
  description: string;
};

export type RankingPlayer = {
  id: string;
  name: string;
  team: string;
  opponent: string;
  position: Position;
  /** Optional remote image; UI falls back to initials. */
  headshotUrl?: string;
  gameDay: string;
  gameTime: string;
  availability: PlayerAvailability;
  /** Factual research stats — never projections or house rankings. */
  research?: PlayerResearchStats | null;
  /** Name + alias variants for client-side pool search. */
  searchKeys?: string[];
};

export type PlayerResearchStats = {
  gamesPlayed: number;
  weeksInWindow: number;
  fantasyPointsPerGame: number | null;
  fantasyPointsTotal: number;
  averageFinish: number | null;
  top10Finishes: number;
  top5Finishes: number;
  numberOneFinishes: number;
  receptions?: number;
  rushingYards?: number;
  receivingYards?: number;
  totalYards?: number;
  touchdowns?: number;
  passingYards?: number;
  passingTds?: number;
  interceptions?: number;
};

export type RankingSlot = {
  rank: number;
  player: RankingPlayer | null;
};

export type PositionChallenge = ContestPositionConfig & {
  status: ContestStatus;
  lockLabel: string;
  weekLabel: string;
  weekKey: string;
};

export type RankingSubmissionStatus = "draft" | "submitted";

export type StoredRankingState = {
  rankedPlayerIds: (string | null)[];
  submissionStatus: RankingSubmissionStatus;
  savedAt: string;
};
