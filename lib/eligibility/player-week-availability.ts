import type {
  EntryAvailability,
  WeeklyAvailabilityDesignation,
  WeeklyAvailabilitySourceType,
} from "@/lib/generated/prisma/client";
import {
  isSelectableAvailability,
  mapNflStatusToAvailability,
} from "@/lib/eligibility/weekly-status";
import { isPromotionUnavailable } from "@/lib/reserves/promotion-status";

/**
 * Week-specific game availability vs season roster membership.
 *
 * Roster ACTIVE does NOT imply weekly AVAILABLE (e.g. Sam Darnold may be
 * ACTIVE on the 53-man roster and OUT for the week).
 */

export const WEEKLY_DESIGNATION_VALUES = [
  "AVAILABLE",
  "QUESTIONABLE",
  "DOUBTFUL",
  "OUT",
  "INACTIVE",
  "UNKNOWN",
] as const satisfies readonly WeeklyAvailabilityDesignation[];

export type WeeklyDesignation = (typeof WEEKLY_DESIGNATION_VALUES)[number];

/** Roster statuses that exclude a player from the selectable AI/human pool. */
export const ROSTER_UNAVAILABLE_ENTRY = new Set<string>([
  "IR",
  "PUP",
  "SUSPENDED",
  "FREE_AGENT",
]);

/** Weekly designations that exclude from the selectable pool. */
export const WEEKLY_UNAVAILABLE_DESIGNATIONS = new Set<WeeklyDesignation>([
  "OUT",
  "INACTIVE",
]);

/** Selectable weekly designations (still disclosed when Q/D/UNKNOWN). */
export const WEEKLY_SELECTABLE_DESIGNATIONS = new Set<WeeklyDesignation>([
  "AVAILABLE",
  "QUESTIONABLE",
  "DOUBTFUL",
  "UNKNOWN",
]);

export const DESIGNATION_FULL_LABEL: Record<WeeklyDesignation, string> = {
  AVAILABLE: "Available",
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  INACTIVE: "Inactive",
  UNKNOWN: "Unknown",
};

export function parseWeeklyDesignation(
  value: string | null | undefined,
): WeeklyDesignation | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if ((WEEKLY_DESIGNATION_VALUES as readonly string[]).includes(normalized)) {
    return normalized as WeeklyDesignation;
  }
  // Compat with EntryAvailability ACTIVE label in admin forms.
  if (normalized === "ACTIVE") return "AVAILABLE";
  return null;
}

export function designationFromEntryAvailability(
  availability: EntryAvailability | string | null | undefined,
): WeeklyDesignation {
  const key = String(availability ?? "").toUpperCase();
  if (key === "QUESTIONABLE") return "QUESTIONABLE";
  if (key === "DOUBTFUL") return "DOUBTFUL";
  if (key === "OUT") return "OUT";
  if (key === "INACTIVE") return "INACTIVE";
  // ACTIVE / empty / roster-like values are not proof of weekly AVAILABLE.
  return "UNKNOWN";
}

/**
 * Resolve weekly designation when no PlayerWeekAvailability row exists.
 * Explicit legacy injury mirrors (Q/D/OUT/INACTIVE) are honored; ACTIVE → UNKNOWN.
 */
export function designationWithoutWeekRecord(
  fallbackEntryAvailability: EntryAvailability | string | null | undefined,
): WeeklyDesignation {
  return designationFromEntryAvailability(fallbackEntryAvailability);
}

export function entryAvailabilityFromDesignation(
  designation: WeeklyDesignation,
): EntryAvailability {
  switch (designation) {
    case "AVAILABLE":
    case "UNKNOWN":
      return "ACTIVE";
    case "QUESTIONABLE":
      return "QUESTIONABLE";
    case "DOUBTFUL":
      return "DOUBTFUL";
    case "OUT":
      return "OUT";
    case "INACTIVE":
      return "INACTIVE";
  }
}

export function entryAvailabilityFromInjuryGameStatus(
  status: EntryAvailability | string | null | undefined,
): WeeklyDesignation {
  const key = String(status ?? "").toUpperCase();
  if (key === "QUESTIONABLE") return "QUESTIONABLE";
  if (key === "DOUBTFUL") return "DOUBTFUL";
  if (key === "OUT") return "OUT";
  if (key === "INACTIVE") return "INACTIVE";
  if (key === "ACTIVE") return "AVAILABLE";
  return "UNKNOWN";
}

export function isRosterUnavailableStatus(
  nflStatus: string | null | undefined,
): boolean {
  const mapped = mapNflStatusToAvailability(nflStatus);
  if (mapped && ROSTER_UNAVAILABLE_ENTRY.has(mapped)) return true;
  const raw = (nflStatus ?? "").trim().toUpperCase();
  if (!raw) return false;
  if (raw === "FA" || raw === "FREE_AGENT" || raw === "CUT") return true;
  if (raw.startsWith("IR") || raw === "RES") return true;
  if (raw === "PUP" || raw.startsWith("PUP") || raw.startsWith("NFI")) {
    return true;
  }
  if (raw === "SUSPENDED" || raw === "SUS") return true;
  return false;
}

export function rosterUnavailableLabel(
  nflStatus: string | null | undefined,
): string {
  const mapped = mapNflStatusToAvailability(nflStatus);
  if (mapped && ROSTER_UNAVAILABLE_ENTRY.has(mapped)) return mapped;
  const raw = (nflStatus ?? "").trim().toUpperCase();
  if (raw === "FA" || raw === "CUT") return "FREE_AGENT";
  if (raw.startsWith("IR") || raw === "RES" || raw.startsWith("NFI")) {
    return "IR";
  }
  if (raw === "PUP" || raw.startsWith("PUP")) return "PUP";
  if (raw === "SUS" || raw === "SUSPENDED") return "SUSPENDED";
  return raw || "ROSTER_UNAVAILABLE";
}

export type ResolvedPlayerWeekStatus = {
  designation: WeeklyDesignation;
  injuryDescription: string | null;
  sourceType: WeeklyAvailabilitySourceType | null;
  sourceUrl: string | null;
  sourcePublishedAt: Date | null;
  observedAt: Date | null;
  manualOverride: boolean;
  rosterStatus: string | null;
  rosterUnavailable: boolean;
  weeklyUnavailable: boolean;
  /** May be newly added to a ranking board. */
  selectable: boolean;
  /** Triggers automatic reserve promotion (Q/D/UNKNOWN do not). */
  promotionUnavailable: boolean;
  /**
   * Compatibility value for RankableEntry.availability / existing callers.
   * Roster-unavailable wins over weekly designation.
   */
  effectiveEntryAvailability: EntryAvailability;
  /** Exact reason string for UNAVAILABLE prompt lines / validation errors. */
  unavailableReason: string | null;
  /** Short disclosure for eligible Q/D/UNKNOWN lines. */
  eligibleDisclosure: string | null;
};

export type ResolvePlayerWeekStatusInput = {
  nflStatus?: string | null;
  weekDesignation?: WeeklyDesignation | null;
  injuryDescription?: string | null;
  sourceType?: WeeklyAvailabilitySourceType | null;
  sourceUrl?: string | null;
  sourcePublishedAt?: Date | null;
  observedAt?: Date | null;
  manualOverride?: boolean;
  /** Fallback when no PlayerWeekAvailability row exists. */
  fallbackEntryAvailability?: EntryAvailability | string | null;
};

export function resolvePlayerWeekStatus(
  input: ResolvePlayerWeekStatusInput,
): ResolvedPlayerWeekStatus {
  const rosterUnavailable = isRosterUnavailableStatus(input.nflStatus);
  const rosterStatus = input.nflStatus?.trim() || null;

  const designation: WeeklyDesignation =
    input.weekDesignation ??
    designationWithoutWeekRecord(input.fallbackEntryAvailability);

  const weeklyUnavailable = WEEKLY_UNAVAILABLE_DESIGNATIONS.has(designation);
  const selectable =
    !rosterUnavailable && WEEKLY_SELECTABLE_DESIGNATIONS.has(designation);

  let effectiveEntryAvailability: EntryAvailability;
  if (rosterUnavailable) {
    const mapped = mapNflStatusToAvailability(input.nflStatus);
    effectiveEntryAvailability =
      mapped && ROSTER_UNAVAILABLE_ENTRY.has(mapped)
        ? mapped
        : ("FREE_AGENT" as EntryAvailability);
  } else {
    effectiveEntryAvailability = entryAvailabilityFromDesignation(designation);
  }

  const promotionUnavailable =
    rosterUnavailable ||
    isPromotionUnavailable(effectiveEntryAvailability) ||
    weeklyUnavailable;

  let unavailableReason: string | null = null;
  if (rosterUnavailable) {
    unavailableReason = rosterUnavailableLabel(input.nflStatus);
  } else if (weeklyUnavailable) {
    unavailableReason = designation;
  }

  const note = input.injuryDescription?.trim() || null;
  let eligibleDisclosure: string | null = null;
  if (selectable) {
    if (designation === "QUESTIONABLE" || designation === "DOUBTFUL") {
      eligibleDisclosure = designation;
    } else if (designation === "UNKNOWN") {
      eligibleDisclosure = "UNKNOWN";
    } else if (designation === "AVAILABLE") {
      eligibleDisclosure = "AVAILABLE";
    }
  }

  return {
    designation,
    injuryDescription: note,
    sourceType: input.sourceType ?? null,
    sourceUrl: input.sourceUrl ?? null,
    sourcePublishedAt: input.sourcePublishedAt ?? null,
    observedAt: input.observedAt ?? null,
    manualOverride: Boolean(input.manualOverride),
    rosterStatus,
    rosterUnavailable,
    weeklyUnavailable,
    selectable,
    promotionUnavailable,
    effectiveEntryAvailability,
    unavailableReason,
    eligibleDisclosure,
  };
}

/** Format "Name — TEAM — DESIGNATION — note" style lines. */
export function formatAvailabilityPromptParts(input: {
  name: string;
  team: string;
  designation: WeeklyDesignation | string;
  injuryDescription?: string | null;
  rosterUnavailableReason?: string | null;
}): string {
  const parts = [input.name, input.team];
  if (input.rosterUnavailableReason) {
    parts.push(input.rosterUnavailableReason);
  } else {
    parts.push(String(input.designation));
  }
  const note = input.injuryDescription?.trim();
  if (note) parts.push(note);
  return parts.join(" — ");
}

export function isSelectableResolvedStatus(
  status: Pick<ResolvedPlayerWeekStatus, "selectable">,
): boolean {
  return status.selectable;
}

/** Bridge: EntryAvailability still used widely; prefer resolved when possible. */
export function isSelectableEntryOrResolved(
  availability: EntryAvailability | string | null | undefined,
): boolean {
  return isSelectableAvailability(availability);
}
