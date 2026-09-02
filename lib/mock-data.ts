import type { LeaderboardEntry, UniversalProfile } from "@/types/user";

export { getSamplePlayers, getPlayerById, getPlayersByIds } from "@/lib/mock-players";

export const SAMPLE_LEADERBOARD: LeaderboardEntry[] = [
  {
    rank: 1,
    username: "gridironmind",
    displayName: "Gridiron Mind",
    isBot: false,
    score: 94.2,
    universalUserId: "uu_demo_001",
  },
  {
    rank: 2,
    username: "rankbot-alpha",
    displayName: "RankBot Alpha",
    isBot: true,
    score: 91.8,
    universalUserId: "uu_bot_alpha",
  },
  {
    rank: 3,
    username: "sundayscientist",
    displayName: "Sunday Scientist",
    isBot: false,
    score: 89.5,
    universalUserId: "uu_demo_002",
  },
  {
    rank: 4,
    username: "filmroom",
    displayName: "Film Room",
    isBot: false,
    score: 87.1,
    universalUserId: null,
  },
  {
    rank: 5,
    username: "consensus-ai",
    displayName: "Consensus AI",
    isBot: true,
    score: 85.4,
    universalUserId: "uu_bot_consensus",
  },
];

export function getSampleProfile(username: string): UniversalProfile {
  const fromLeaderboard = SAMPLE_LEADERBOARD.find(
    (e) => e.username.toLowerCase() === username.toLowerCase(),
  );

  return {
    universalUserId: fromLeaderboard?.universalUserId ?? null,
    username: fromLeaderboard?.username ?? username,
    displayName:
      fromLeaderboard?.displayName ??
      username
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
    isBot: fromLeaderboard?.isBot ?? false,
    bio: "Universal-profile-ready RankEYEQ competitor.",
    rankiq: {
      overallRank: fromLeaderboard?.rank ?? 42,
      averageRankingScore: fromLeaderboard?.score ?? 72.4,
      topHitRate: 0.61,
      exactRankingHits: 18,
      numberOneHits: 7,
      podiumHits: 22,
      bestWeek: "Week 14 · 98.6",
      currentStreak: 3,
      positionRanks: {
        qb: 12,
        rb: 8,
        wr: 21,
        te: 15,
        def: 6,
      },
    },
  };
}
