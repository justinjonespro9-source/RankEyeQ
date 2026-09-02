import type {
  ContestPosition,
  ContestStatus as DbContestStatus,
  EntryAvailability,
  RankableEntry,
} from "@/lib/generated/prisma/client";
import { toUiPosition } from "@/lib/contest-defaults";
import { parsePlayerAliases } from "@/lib/nfl/player-aliases";
import type {
  ContestStatus,
  PlayerAvailability,
  PositionChallenge,
  RankingPlayer,
} from "@/types/contest";

const AVAILABILITY_MAP: Record<EntryAvailability, PlayerAvailability> = {
  ACTIVE: "active",
  QUESTIONABLE: "questionable",
  DOUBTFUL: "doubtful",
  OUT: "out",
  INACTIVE: "out",
};

export function mapAvailability(
  availability: EntryAvailability,
): PlayerAvailability {
  return AVAILABILITY_MAP[availability];
}

export function mapContestStatusToUi(status: DbContestStatus): ContestStatus {
  return status === "OPEN" ? "open" : "locked";
}

export function formatGameDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

export function formatGameTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(date);
}

export function rankableEntryToRankingPlayer(
  entry: RankableEntry,
): RankingPlayer {
  const kickoff = entry.gameStartsAt;
  const aliases = parsePlayerAliases(entry.adminNotes);
  const searchKeys = [...new Set([entry.name, ...aliases])];
  return {
    id: entry.id,
    name: entry.name,
    team: entry.team,
    opponent: entry.opponent || "TBD",
    position: toUiPosition(entry.position),
    headshotUrl: entry.headshotUrl ?? undefined,
    gameDay: kickoff ? formatGameDay(kickoff) : "TBD",
    gameTime: kickoff ? formatGameTime(kickoff) : "",
    availability: mapAvailability(entry.availability),
    searchKeys,
  };
}

export function buildPositionChallenge(input: {
  position: ContestPosition;
  rankingDepth: number;
  title: string;
  status: DbContestStatus;
  weekLabel: string;
  weekKey: string;
  locksAt: Date | null;
}): PositionChallenge {
  const position = toUiPosition(input.position);
  const shortLabel = input.position;
  const labels: Record<typeof position, string> = {
    qb: "Quarterback",
    rb: "Running Back",
    wr: "Wide Receiver",
    te: "Tight End",
    def: "Defense",
  };

  return {
    position,
    label: labels[position],
    shortLabel,
    slotCount: input.rankingDepth,
    description: input.title,
    status: mapContestStatusToUi(input.status),
    lockLabel: input.locksAt
      ? `Locks ${formatGameDay(input.locksAt)} ${formatGameTime(input.locksAt)}`
      : "Locks at first relevant kickoff (Thu–Mon)",
    weekLabel: input.weekLabel,
    weekKey: input.weekKey,
  };
}
