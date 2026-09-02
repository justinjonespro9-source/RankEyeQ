import type {
  ProviderDefenseGameStats,
  ProviderPlayerGameStats,
} from "@/lib/providers/nfl/types";

/** Loose SportsDataIO PlayerGame / FantasyDefenseGame field subset. */
export type SportsDataPlayerGame = {
  PlayerID?: number;
  GameKey?: string | null;
  Team?: string | null;
  PassingYards?: number | null;
  PassingTouchdowns?: number | null;
  PassingInterceptions?: number | null;
  RushingYards?: number | null;
  RushingTouchdowns?: number | null;
  Receptions?: number | null;
  ReceivingYards?: number | null;
  ReceivingTouchdowns?: number | null;
  TwoPointConversionPasses?: number | null;
  TwoPointConversionRuns?: number | null;
  TwoPointConversionReceptions?: number | null;
  FumblesLost?: number | null;
  Fumbles?: number | null;
  KickReturnTouchdowns?: number | null;
  PuntReturnTouchdowns?: number | null;
  DefensiveTouchdowns?: number | null;
  IsGameOver?: boolean | null;
  Started?: number | null;
};

export type SportsDataFantasyDefenseGame = {
  GameKey?: string | null;
  Team?: string | null;
  PlayerID?: number | null;
  Sacks?: number | null;
  Interceptions?: number | null;
  FumblesRecovered?: number | null;
  DefensiveTouchdowns?: number | null;
  SpecialTeamsTouchdowns?: number | null;
  Safeties?: number | null;
  BlockedKicks?: number | null;
  PointsAllowed?: number | null;
  PointsAllowedByDefenseSpecialTeams?: number | null;
  IsGameOver?: boolean | null;
};

function n(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function mapSportsDataPlayerGameStats(
  rows: SportsDataPlayerGame[],
): ProviderPlayerGameStats[] {
  const out: ProviderPlayerGameStats[] = [];
  for (const row of rows) {
    if (row.PlayerID == null) continue;
    const twoPoint =
      n(row.TwoPointConversionPasses) +
      n(row.TwoPointConversionRuns) +
      n(row.TwoPointConversionReceptions);
    const returnTds =
      n(row.KickReturnTouchdowns) +
      n(row.PuntReturnTouchdowns) +
      n(row.DefensiveTouchdowns);

    out.push({
      externalPlayerId: String(row.PlayerID),
      gameExternalId: row.GameKey ?? null,
      team: row.Team ?? null,
      isGameFinal: Boolean(row.IsGameOver),
      passingYards: n(row.PassingYards),
      passingTds: n(row.PassingTouchdowns),
      interceptions: n(row.PassingInterceptions),
      rushingYards: n(row.RushingYards),
      rushingTds: n(row.RushingTouchdowns),
      receptions: n(row.Receptions),
      receivingYards: n(row.ReceivingYards),
      receivingTds: n(row.ReceivingTouchdowns),
      twoPointConversions: twoPoint,
      fumblesLost: n(row.FumblesLost),
      returnTds,
    });
  }
  return out;
}

export function mapSportsDataDefenseGameStats(
  rows: SportsDataFantasyDefenseGame[],
): ProviderDefenseGameStats[] {
  const out: ProviderDefenseGameStats[] = [];
  for (const row of rows) {
    if (!row.Team) continue;
    out.push({
      externalId: `def-${row.Team}`,
      team: row.Team,
      gameExternalId: row.GameKey ?? null,
      isGameFinal: Boolean(row.IsGameOver),
      sacks: n(row.Sacks),
      interceptions: n(row.Interceptions),
      fumbleRecoveries: n(row.FumblesRecovered),
      defensiveTds: n(row.DefensiveTouchdowns),
      specialTeamsTds: n(row.SpecialTeamsTouchdowns),
      safeties: n(row.Safeties),
      blockedKicks: n(row.BlockedKicks),
      pointsAllowed: Math.round(
        n(row.PointsAllowedByDefenseSpecialTeams || row.PointsAllowed),
      ),
    });
  }
  return out;
}
