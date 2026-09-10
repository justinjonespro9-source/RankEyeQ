import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import { DEFAULT_FANTASY_SCORING_VERSION } from "@/lib/fantasy/scoring-config";
import {
  scoreWeeklyDefenseFantasy,
  scoreWeeklyPlayerFantasy,
} from "@/lib/fantasy/shared-engine";
import type {
  ContestPosition,
  NflGameStatus,
} from "@/lib/generated/prisma/client";

/** Manual live provider key — distinct from sports-data providers. */
export const LIVE_MANUAL_PROVIDER = "manual";

export type LivePlayerStatsInput = PlayerStatLine;
export type LiveDefenseStatsInput = DefenseStatLine;

export type LiveScoringGameSummary = {
  id: string;
  awayTeam: string;
  homeTeam: string;
  startsAt: Date;
  status: NflGameStatus;
  scoredEntries: number;
  totalEntries: number;
};

export type LiveScoringEntryRow = {
  contestEntryId: string;
  contestId: string;
  contestPosition: ContestPosition;
  contestStatus: string;
  rankableEntryId: string;
  externalId: string;
  name: string;
  team: string;
  opponent: string;
  position: ContestPosition;
  fantasyPoints: number | null;
  hasLiveStatRecord: boolean;
  actualRank: number | null;
  updatedAt: Date;
  gameId: string | null;
  gameStatus: NflGameStatus | null;
  startsAt: Date | null;
  lockedByFinal: boolean;
  scoringVersion: string;
  playerStats: Required<PlayerStatLine> | null;
  defenseStats: Required<DefenseStatLine> | null;
};

export const EMPTY_PLAYER: Required<PlayerStatLine> = {
  passingYards: 0,
  passingTds: 0,
  interceptions: 0,
  rushingYards: 0,
  rushingTds: 0,
  receptions: 0,
  receivingYards: 0,
  receivingTds: 0,
  twoPointConversions: 0,
  fumblesLost: 0,
  returnTds: 0,
};

export const EMPTY_DEFENSE: Required<DefenseStatLine> = {
  sacks: 0,
  interceptions: 0,
  fumbleRecoveries: 0,
  defensiveTds: 0,
  specialTeamsTds: 0,
  safeties: 0,
  blockedKicks: 0,
  pointsAllowed: 0,
};

export function calculatePlayerLiveFantasyPoints(
  stats: PlayerStatLine,
  scoringVersion: string = DEFAULT_FANTASY_SCORING_VERSION,
) {
  return scoreWeeklyPlayerFantasy(stats, scoringVersion).fantasyPoints;
}

export function calculateDefenseLiveFantasyPoints(
  stats: DefenseStatLine,
  scoringVersion: string = DEFAULT_FANTASY_SCORING_VERSION,
) {
  return scoreWeeklyDefenseFantasy(stats, scoringVersion).fantasyPoints;
}
