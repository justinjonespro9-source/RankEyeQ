import type {
  ContestPositionConfig,
  Position,
  PositionChallenge,
} from "@/types/contest";

/** Storage / season key for the current mock week. */
export const NFL_WEEK_KEY = "2026-week-1";

export const CURRENT_WEEK_LABEL = "Week 1";

export const CONTEST_ELIGIBILITY =
  "NFL games Thursday through Monday are eligible.";

export const POSITION_CONFIGS: ContestPositionConfig[] = [
  {
    position: "qb",
    label: "Quarterback",
    shortLabel: "QB",
    slotCount: 10,
    description: "Rank the Top 10 quarterbacks on this week's NFL slate before kickoff.",
  },
  {
    position: "rb",
    label: "Running Back",
    shortLabel: "RB",
    slotCount: 10,
    description: "Rank the Top 10 running backs on this week's NFL slate before kickoff.",
  },
  {
    position: "wr",
    label: "Wide Receiver",
    shortLabel: "WR",
    slotCount: 15,
    description: "Rank the Top 15 wide receivers on this week's NFL slate before kickoff.",
  },
  {
    position: "te",
    label: "Tight End",
    shortLabel: "TE",
    slotCount: 10,
    description: "Rank the Top 10 tight ends on this week's NFL slate before kickoff.",
  },
  {
    position: "def",
    label: "Defense",
    shortLabel: "DEF",
    slotCount: 10,
    description: "Rank the Top 10 defenses on this week's NFL slate before kickoff.",
  },
];

const VALID_POSITIONS = new Set<string>(
  POSITION_CONFIGS.map((c) => c.position),
);

export function isPosition(value: string): value is Position {
  return VALID_POSITIONS.has(value);
}

/**
 * Normalize a dynamic `[position]` route segment to the canonical UI Position.
 * Accepts `qb` / `QB` / mixed case. Returns null when the segment is not a position.
 */
export function parsePositionParam(
  value: string | undefined | null,
): Position | null {
  if (!value || typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isPosition(normalized) ? normalized : null;
}

export function getPositionConfig(position: Position): ContestPositionConfig {
  const config = POSITION_CONFIGS.find((c) => c.position === position);
  if (!config) {
    throw new Error(`Unknown position: ${position}`);
  }
  return config;
}

/** Placeholder challenge state until contest management is wired. */
export function getWeeklyChallenges(): PositionChallenge[] {
  return POSITION_CONFIGS.map((config) => ({
    ...config,
    status: "open" as const,
    lockLabel: "Editable until Sunday 10:00 AM CT",
    weekLabel: CURRENT_WEEK_LABEL,
    weekKey: NFL_WEEK_KEY,
  }));
}

export function getChallenge(position: Position): PositionChallenge {
  const challenge = getWeeklyChallenges().find((c) => c.position === position);
  if (!challenge) {
    throw new Error(`Unknown position: ${position}`);
  }
  return challenge;
}

export function rankingStorageKey(weekKey: string, position: Position) {
  return `rankiq:${weekKey}:${position}`;
}

export function contestModeStorageKey(weekKey: string, position: Position) {
  return `rankiq:dev:mode:${weekKey}:${position}`;
}
