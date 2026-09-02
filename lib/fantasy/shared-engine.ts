import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import {
  scoreDefenseFantasy,
  type DefenseStatLine,
} from "@/lib/fantasy/defense-scoring";
import {
  scorePlayerFantasy,
  type PlayerStatLine,
} from "@/lib/fantasy/player-scoring";
import {
  DEFAULT_FANTASY_SCORING_VERSION,
  getFantasyRules,
  type FantasyScoringVersion,
} from "@/lib/fantasy/scoring-config";

export type WeeklyFantasyEntry = {
  id: string;
  fantasyPoints: number;
};

/**
 * Shared weekly fantasy scoring used by RankEyeQ (actual finishes) and
 * FantasyTrack (player performance). Same stats + version → same points.
 */
export function scoreWeeklyPlayerFantasy(
  stats: PlayerStatLine,
  scoringVersion: string = DEFAULT_FANTASY_SCORING_VERSION,
) {
  const { player } = getFantasyRules(scoringVersion);
  return scorePlayerFantasy(stats, player);
}

export function scoreWeeklyDefenseFantasy(
  stats: DefenseStatLine,
  scoringVersion: string = DEFAULT_FANTASY_SCORING_VERSION,
) {
  const { defense } = getFantasyRules(scoringVersion);
  return scoreDefenseFantasy(stats, defense);
}

export function rankWeeklyFantasyFinishes<T extends WeeklyFantasyEntry>(
  entries: T[],
) {
  return assignCompetitionRanks(entries, (entry) => entry.fantasyPoints);
}

export function resolveFantasyScoringVersion(input: {
  weekVersion?: string | null;
  seasonVersion?: string | null;
}): FantasyScoringVersion {
  return getFantasyRules(
    input.weekVersion ?? input.seasonVersion ?? DEFAULT_FANTASY_SCORING_VERSION,
  ).version;
}

/** Explicit product facades — identical implementation, separate import paths. */
export const rankEyeQFantasyScoring = {
  scorePlayer: scoreWeeklyPlayerFantasy,
  scoreDefense: scoreWeeklyDefenseFantasy,
  rankFinishes: rankWeeklyFantasyFinishes,
};

export const fantasyTrackFantasyScoring = {
  scorePlayer: scoreWeeklyPlayerFantasy,
  scoreDefense: scoreWeeklyDefenseFantasy,
  rankFinishes: rankWeeklyFantasyFinishes,
};
