import type { EntryAvailability } from "@/lib/generated/prisma/client";

/**
 * Canonical weekly player status / selectable eligibility.
 * Source of truth for human pool, AI prompts, admin, and save validation.
 *
 * GAME_STARTED is derived from NflGame kickoff — never stored as availability.
 */

export const WEEKLY_AVAILABILITY_VALUES = [
  "ACTIVE",
  "QUESTIONABLE",
  "DOUBTFUL",
  "OUT",
  "IR",
  "PUP",
  "SUSPENDED",
  "FREE_AGENT",
  "INACTIVE",
] as const satisfies readonly EntryAvailability[];

export type WeeklyAvailability = (typeof WEEKLY_AVAILABILITY_VALUES)[number];

/** Informational UI labels (short). */
export const AVAILABILITY_SHORT_LABEL: Record<WeeklyAvailability, string> = {
  ACTIVE: "Active",
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "OUT",
  IR: "IR",
  PUP: "PUP",
  SUSPENDED: "SUS",
  FREE_AGENT: "FA",
  INACTIVE: "INA",
};

export const AVAILABILITY_FULL_LABEL: Record<WeeklyAvailability, string> = {
  ACTIVE: "Active",
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  IR: "Injured reserve",
  PUP: "PUP",
  SUSPENDED: "Suspended",
  FREE_AGENT: "Free agent",
  INACTIVE: "Inactive",
};

/** Still selectable for new ranking adds (product policy). */
const SELECTABLE_AVAILABILITY = new Set<WeeklyAvailability>([
  "ACTIVE",
  "QUESTIONABLE",
  "DOUBTFUL",
]);

export function isSelectableAvailability(
  availability: EntryAvailability | string | null | undefined,
): boolean {
  if (!availability) return true;
  return SELECTABLE_AVAILABILITY.has(
    String(availability).toUpperCase() as WeeklyAvailability,
  );
}

export function isUnavailableAvailability(
  availability: EntryAvailability | string | null | undefined,
): boolean {
  return !isSelectableAvailability(availability);
}

/** Map SeasonPlayer.nflStatus strings onto EntryAvailability when syncing. */
export function mapNflStatusToAvailability(
  nflStatus: string | null | undefined,
): EntryAvailability | null {
  const status = (nflStatus ?? "").trim().toUpperCase();
  if (!status || status === "ACTIVE" || status === "ACT") return "ACTIVE";
  if (status === "QUESTIONABLE" || status === "Q") return "QUESTIONABLE";
  if (status === "DOUBTFUL" || status === "D") return "DOUBTFUL";
  if (status === "OUT" || status === "O") return "OUT";
  if (status.startsWith("IR") || status === "RES") return "IR";
  if (status === "PUP" || status.startsWith("PUP")) return "PUP";
  if (status.startsWith("NFI")) return "IR";
  if (status === "SUSPENDED" || status === "SUS") return "SUSPENDED";
  if (status === "FA" || status === "FREE_AGENT" || status === "CUT") {
    return "FREE_AGENT";
  }
  if (status === "INACTIVE" || status === "INA") return "INACTIVE";
  if (status === "RETIRED" || status === "COVID-19") return "INACTIVE";
  return null;
}

export function parseWeeklyAvailability(
  value: string | null | undefined,
): EntryAvailability | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if (
    (WEEKLY_AVAILABILITY_VALUES as readonly string[]).includes(normalized)
  ) {
    return normalized as EntryAvailability;
  }
  return null;
}

/**
 * Whether a player may be newly added to a board.
 * Kickoff lock and contest membership are checked separately.
 */
export function canNewlySelectPlayer(input: {
  availability: EntryAvailability | string | null | undefined;
  kickoffAt?: Date | null;
  now?: Date;
}): boolean {
  if (!isSelectableAvailability(input.availability)) return false;
  if (input.kickoffAt && (input.now ?? new Date()) >= input.kickoffAt) {
    return false;
  }
  return true;
}

/**
 * OUT (etc.) already on a board may be removed/replaced only before kickoff.
 * Kickoff lock still wins when the game has started.
 */
export function canReplaceUnavailableSelection(input: {
  kickoffAt?: Date | null;
  now?: Date;
  fullLockAt?: Date | null;
}): boolean {
  const now = input.now ?? new Date();
  if (input.fullLockAt && now >= input.fullLockAt) return false;
  if (input.kickoffAt && now >= input.kickoffAt) return false;
  return true;
}

export function isSelectableUiAvailability(
  availability: string | null | undefined,
): boolean {
  return isSelectableAvailability((availability ?? "active").toUpperCase());
}

export function availabilityPromptMarker(
  availability: EntryAvailability | string | null | undefined,
): string | null {
  const key = String(availability ?? "ACTIVE").toUpperCase() as WeeklyAvailability;
  if (key === "ACTIVE") return null;
  if (key === "QUESTIONABLE") return "Questionable";
  if (key === "DOUBTFUL") return "Doubtful";
  return AVAILABILITY_FULL_LABEL[key] ?? key;
}
