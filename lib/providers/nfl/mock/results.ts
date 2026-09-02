import { mockDefenses, mockGames, mockPlayers } from "@/lib/providers/nfl/mock/fixtures";
import type {
  ProviderDefenseGameStats,
  ProviderPlayerGameStats,
  ProviderWeekResults,
} from "@/lib/providers/nfl/types";

/** Deterministic pseudo-random in [0, 1) from a string seed. */
function unit(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return (hash % 10_000) / 10_000;
}

function int(seed: string, maxInclusive: number) {
  return Math.floor(unit(seed) * (maxInclusive + 1));
}

/**
 * Mock weekly results. Marks all games FINAL so Finalize Week can be exercised
 * locally without a live stats vendor.
 */
export function buildMockWeekResults(
  seasonYear: number,
  weekNumber: number,
): ProviderWeekResults {
  const games = mockGames(
    seasonYear,
    weekNumber,
    new Date(Date.UTC(seasonYear, 8, 3 + (weekNumber - 1) * 7)),
  ).map((game) => ({ ...game, status: "FINAL" as const }));

  const byTeam = new Map(games.flatMap((g) => [
    [g.homeTeam, g] as const,
    [g.awayTeam, g] as const,
  ]));

  const playerStats: ProviderPlayerGameStats[] = [];
  for (const player of mockPlayers()) {
    const game = byTeam.get(player.team);
    if (!game) continue;
    const s = `${seasonYear}-${weekNumber}-${player.externalId}`;
    const position = player.position;
    playerStats.push({
      externalPlayerId: player.externalId,
      gameExternalId: game.externalId,
      team: player.team,
      isGameFinal: true,
      passingYards: position === "QB" ? 180 + int(`${s}-py`, 160) : int(`${s}-py`, 20),
      passingTds: position === "QB" ? int(`${s}-ptd`, 3) : 0,
      interceptions: position === "QB" ? int(`${s}-int`, 2) : 0,
      rushingYards:
        position === "RB" || position === "QB"
          ? 20 + int(`${s}-ry`, 90)
          : int(`${s}-ry`, 15),
      rushingTds: position === "RB" ? int(`${s}-rtd`, 2) : int(`${s}-rtd`, 1) > 0 ? 0 : 0,
      receptions:
        position === "WR" || position === "TE" || position === "RB"
          ? int(`${s}-rec`, 8)
          : 0,
      receivingYards:
        position === "WR" || position === "TE"
          ? 30 + int(`${s}-rey`, 90)
          : position === "RB"
            ? int(`${s}-rey`, 40)
            : 0,
      receivingTds:
        position === "WR" || position === "TE" ? int(`${s}-retd`, 2) : 0,
      twoPointConversions: int(`${s}-2pt`, 10) === 0 ? 1 : 0,
      fumblesLost: int(`${s}-fl`, 8) === 0 ? 1 : 0,
      returnTds: int(`${s}-ret`, 40) === 0 ? 1 : 0,
    });
  }

  // Ensure at least one true zero-point line exists for audit tests / demos.
  if (playerStats[0]) {
    playerStats[0] = {
      ...playerStats[0],
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
  }

  const defenseStats: ProviderDefenseGameStats[] = [];
  for (const defense of mockDefenses()) {
    const game = byTeam.get(defense.team);
    if (!game) continue;
    const s = `${seasonYear}-${weekNumber}-${defense.team}`;
    defenseStats.push({
      externalId: defense.externalId,
      team: defense.team,
      gameExternalId: game.externalId,
      isGameFinal: true,
      sacks: int(`${s}-sack`, 5),
      interceptions: int(`${s}-int`, 2),
      fumbleRecoveries: int(`${s}-fr`, 2),
      defensiveTds: int(`${s}-dtd`, 1),
      specialTeamsTds: int(`${s}-std`, 8) === 0 ? 1 : 0,
      safeties: int(`${s}-saf`, 12) === 0 ? 1 : 0,
      blockedKicks: int(`${s}-blk`, 15) === 0 ? 1 : 0,
      pointsAllowed: int(`${s}-pa`, 42),
    });
  }

  return {
    seasonYear,
    weekNumber,
    games,
    playerStats,
    defenseStats,
    unmatched: [],
  };
}
