import type {
  ContestPosition,
  ContestStatus as DbContestStatus,
  EntryAvailability,
  RankableEntry,
} from "@/lib/generated/prisma/client";
import { toUiPosition, submissionDepthFromScoring } from "@/lib/contest-defaults";
import { parsePlayerAliases } from "@/lib/nfl/player-aliases";
import {
  formatContestClock,
  formatContestTime,
  formatInChicago,
} from "@/lib/timing/chicago";
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
  IR: "ir",
  PUP: "pup",
  SUSPENDED: "suspended",
  FREE_AGENT: "free_agent",
  INACTIVE: "inactive",
};

export function mapAvailability(
  availability: EntryAvailability,
): PlayerAvailability {
  return AVAILABILITY_MAP[availability];
}

/** UI open/locked for challenge cards — DRAFT and OPEN are both open for editing. */
export function mapContestStatusToUi(status: DbContestStatus): ContestStatus {
  return status === "OPEN" || status === "DRAFT" ? "open" : "locked";
}

export function formatGameDay(date: Date): string {
  return formatInChicago(date, { weekday: "short" });
}

/** Kickoff / lock wall clock in America/Chicago (never fixed EST/CST offsets). */
export function formatGameTime(date: Date): string {
  return formatContestTime(date);
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
  const scoringDepth = input.rankingDepth;
  const slotCount = submissionDepthFromScoring(scoringDepth);

  return {
    position,
    label: labels[position],
    shortLabel,
    slotCount,
    scoringDepth,
    description: input.title,
    status: mapContestStatusToUi(input.status),
    lockLabel: input.locksAt
      ? `Editable until ${formatContestClock(input.locksAt)}`
      : "Editable until Sunday 10:00 AM CT",
    weekLabel: input.weekLabel,
    weekKey: input.weekKey,
  };
}
