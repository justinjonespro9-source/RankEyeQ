import type { ContestPosition } from "@/lib/generated/prisma/client";

export type NflProviderName = "manual" | "mock" | "sportsdataio" | (string & {});

export type ProviderSeason = {
  year: number;
  label: string;
};

export type ProviderTeam = {
  externalId: string;
  abbreviation: string;
  name: string;
  city?: string;
};

export type ProviderGame = {
  externalId: string;
  seasonYear: number;
  weekNumber: number;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
  status: "SCHEDULED" | "IN_PROGRESS" | "FINAL" | "POSTPONED" | "CANCELED" | "OTHER";
};

export type ProviderPlayer = {
  externalId: string;
  name: string;
  shortName: string;
  team: string;
  position: ContestPosition;
  headshotUrl: string | null;
  active: boolean;
  /** Provider roster/injury status string when available. */
  status?: string | null;
};

export type ProviderDefense = {
  externalId: string;
  team: string;
  name: string;
  shortName: string;
  headshotUrl: string | null;
  active: boolean;
};

export type WeeklyEligiblePlayer = ProviderPlayer & {
  gameExternalId: string;
  opponent: string;
  gameStartsAt: Date;
};

export type WeeklyEligibleDefense = ProviderDefense & {
  gameExternalId: string;
  opponent: string;
  gameStartsAt: Date;
};

export type WeeklyEligibleBundle = {
  seasonYear: number;
  weekNumber: number;
  games: ProviderGame[];
  players: WeeklyEligiblePlayer[];
  defenses: WeeklyEligibleDefense[];
  /** Rows skipped during mapping (invalid position/team/etc.). */
  invalid: Array<{ reason: string; externalId?: string; detail?: string }>;
};

/**
 * Vendor-agnostic NFL data access. Implementations map raw payloads here —
 * never expose vendor shapes to React or Prisma write paths.
 */
export interface NflDataProvider {
  readonly name: NflProviderName;
  getSeason(): Promise<ProviderSeason>;
  getTeams(): Promise<ProviderTeam[]>;
  getPlayers(): Promise<ProviderPlayer[]>;
  getWeekSchedule(seasonYear: number, weekNumber: number): Promise<ProviderGame[]>;
  getWeeklyEligiblePlayers(
    seasonYear: number,
    weekNumber: number,
  ): Promise<WeeklyEligibleBundle>;
  /** Optional — providers without results support may omit. */
  getGameResults?(
    seasonYear: number,
    weekNumber: number,
  ): Promise<ProviderGame[]>;
  getWeekPlayerStats?(
    seasonYear: number,
    weekNumber: number,
  ): Promise<ProviderPlayerGameStats[]>;
  getWeekDefenseStats?(
    seasonYear: number,
    weekNumber: number,
  ): Promise<ProviderDefenseGameStats[]>;
  getWeekResults?(
    seasonYear: number,
    weekNumber: number,
  ): Promise<ProviderWeekResults>;
}

export type ProviderPlayerGameStats = {
  externalPlayerId: string;
  gameExternalId: string | null;
  team: string | null;
  isGameFinal: boolean;
  passingYards: number;
  passingTds: number;
  interceptions: number;
  rushingYards: number;
  rushingTds: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  twoPointConversions: number;
  fumblesLost: number;
  returnTds: number;
};

export type ProviderDefenseGameStats = {
  externalId: string;
  team: string;
  gameExternalId: string | null;
  isGameFinal: boolean;
  sacks: number;
  interceptions: number;
  fumbleRecoveries: number;
  defensiveTds: number;
  specialTeamsTds: number;
  safeties: number;
  blockedKicks: number;
  pointsAllowed: number;
};

export type ProviderWeekResults = {
  seasonYear: number;
  weekNumber: number;
  games: ProviderGame[];
  playerStats: ProviderPlayerGameStats[];
  defenseStats: ProviderDefenseGameStats[];
  unmatched: Array<{
    kind: "player" | "defense";
    externalId: string;
    detail?: string;
  }>;
}
