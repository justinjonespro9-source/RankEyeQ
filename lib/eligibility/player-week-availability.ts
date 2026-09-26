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
 *
 * Master/prior RankableEntry.availability (OUT/Q/D/INACTIVE) must NOT masquerade
 * as the selected week's official game status — those values can be stale.
 * Roster-unavailable is handled separately via SeasonPlayer.nflStatus.
 *
 * `fallbackEntryAvailability` on ResolvePlayerWeekStatusInput is retained for
 * call-site compatibility but is intentionally ignored here.
 */
export function designationWithoutWeekRecord(): WeeklyDesignation {
  return "UNKNOWN";
}

/**
 * Conceptual source of the effective weekly availability display.
 * Derived for Admin — not a persisted enum.
 */
export type WeeklyAvailabilitySourceKind =
  | "ADMIN_OVERRIDE"
  | "ROSTER_UNAVAILABLE"
  | "OFFICIAL_GAME_STATUS"
  | "PRACTICE_ONLY"
  | "NO_SOURCE_ROW"
  | "NO_OFFICIAL_STATUS";

/** Derived practice participation tier — never maps to Q/D/OUT. */
export type PracticeTier = "DNP" | "LIMITED" | "FULL" | "UNKNOWN";

/**
 * Shared factual injury context for Human UI + AI prompts.
 * Practice is informational only; official Game Status alone drives Q/D/OUT.
 */
export type InjuryContext = {
  bodyPart: string | null;
  practiceStatusRaw: string | null;
  practiceTier: PracticeTier | null;
  officialGameStatus: "QUESTIONABLE" | "DOUBTFUL" | "OUT" | null;
};

/** Designations that blank NFL Game Status must not erase. */
export const PRESERVED_OFFICIAL_DESIGNATIONS = new Set<WeeklyDesignation>([
  "QUESTIONABLE",
  "DOUBTFUL",
  "OUT",
  "INACTIVE",
  "AVAILABLE",
]);

export function derivePracticeTier(
  practiceStatus: string | null | undefined,
): PracticeTier | null {
  const raw = (practiceStatus ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (
    raw.includes("did not participate") ||
    raw === "dnp" ||
    raw.startsWith("dnp")
  ) {
    return "DNP";
  }
  if (raw.includes("limited") || raw === "lp" || raw.startsWith("limited")) {
    return "LIMITED";
  }
  if (
    raw.includes("full participation") ||
    raw === "full" ||
    raw === "fp" ||
    raw.startsWith("full")
  ) {
    return "FULL";
  }
  return "UNKNOWN";
}

export function buildInjuryContext(input: {
  injuryDescription?: string | null;
  practiceStatus?: string | null;
  designation?: WeeklyDesignation | string | null;
  officialGameStatusFromReport?:
    | "QUESTIONABLE"
    | "DOUBTFUL"
    | "OUT"
    | null;
}): InjuryContext {
  const designation = String(input.designation ?? "")
    .trim()
    .toUpperCase();
  let officialGameStatus: InjuryContext["officialGameStatus"] = null;
  if (input.officialGameStatusFromReport) {
    officialGameStatus = input.officialGameStatusFromReport;
  } else if (
    designation === "QUESTIONABLE" ||
    designation === "DOUBTFUL" ||
    designation === "OUT"
  ) {
    officialGameStatus = designation;
  }
  const practiceStatusRaw = input.practiceStatus?.trim() || null;
  return {
    bodyPart: input.injuryDescription?.trim() || null,
    practiceStatusRaw,
    practiceTier: derivePracticeTier(practiceStatusRaw),
    officialGameStatus,
  };
}

/** Primary human label from Injury Watch when no stronger status exists. */
export function injuryWatchPrimaryLabel(
  context: InjuryContext,
): string | null {
  if (context.officialGameStatus === "OUT") return "Out";
  if (context.officialGameStatus === "QUESTIONABLE") return "Questionable";
  if (context.officialGameStatus === "DOUBTFUL") return "Doubtful";
  if (context.practiceTier === "DNP") return "Injury Watch · DNP";
  if (context.practiceTier === "LIMITED") return "Injury Watch · Limited";
  // Full / unknown practice: no prominent Injury Watch warning.
  return null;
}

export function formatInjuryContextForAiPrompt(input: {
  resolvedAvailabilityLabel: string;
  selectable: boolean;
  context: InjuryContext;
}): string[] {
  const lines = [input.resolvedAvailabilityLabel];
  if (input.context.officialGameStatus) {
    lines.push(
      `Official Game Status: ${input.context.officialGameStatus}`,
    );
  } else {
    lines.push("Official Game Status: not yet issued");
  }
  const practiceLine = formatPracticeContextLine(input.context);
  if (practiceLine) lines.push(practiceLine);
  if (input.context.bodyPart) {
    lines.push(`Injury: ${input.context.bodyPart}`);
  }
  lines.push(`Selectable: ${input.selectable ? "yes" : "no"}`);
  return lines;
}

/**
 * Practice participation line for AI/Human shared context.
 * Blank official GS: DNP/Limited → "Injury Watch:"; Full → "Practice: Full".
 * Official Q/D/OUT: always "Practice:" (never Injury Watch).
 */
export function formatPracticeContextLine(
  context: InjuryContext,
): string | null {
  const tier = context.practiceTier;
  if (!tier || tier === "UNKNOWN") {
    if (!context.practiceStatusRaw) return null;
    return `Practice: ${context.practiceStatusRaw}`;
  }
  const short =
    tier === "DNP" ? "DNP" : tier === "LIMITED" ? "Limited" : "Full";
  if (context.officialGameStatus) {
    return `Practice: ${short}`;
  }
  if (tier === "DNP") return "Injury Watch: DNP";
  if (tier === "LIMITED") return "Injury Watch: Limited";
  return "Practice: Full";
}

export type WeeklyAvailabilityPresentation = {
  designation: WeeklyDesignation;
  /** Operator-facing primary label (e.g. "Injury Watch · DNP"). */
  designationLabel: string;
  sourceKind: WeeklyAvailabilitySourceKind;
  /** Short badge under the designation. */
  sourceBadge: string;
  practiceStatus: string | null;
  officialGameStatusLabel: string;
  /** Shared factual context (Human + AI). */
  injuryContext: InjuryContext;
};

/**
 * Build operator-facing labels for the Admin availability board.
 * Does not change effective-board / reserve semantics.
 */
export function presentWeeklyAvailability(input: {
  resolved: ResolvedPlayerWeekStatus;
  hasWeekRecord: boolean;
  practiceStatus?: string | null;
  injuryDescription?: string | null;
  /** True when NFL.com listed the player with blank Game Status. */
  onInjuryReportBlankGameStatus?: boolean;
  /** True when NFL.com listed the player with a mapped official Game Status. */
  onInjuryReportOfficialGameStatus?: boolean;
}): WeeklyAvailabilityPresentation {
  const { resolved } = input;
  const practiceStatus =
    input.practiceStatus?.trim() ||
    resolved.practiceStatus?.trim() ||
    null;
  const injuryDescription =
    input.injuryDescription?.trim() ||
    resolved.injuryDescription?.trim() ||
    null;
  const injuryContext = buildInjuryContext({
    injuryDescription,
    practiceStatus,
    designation: resolved.designation,
  });

  if (resolved.manualOverride && input.hasWeekRecord) {
    return {
      designation: resolved.designation,
      designationLabel: DESIGNATION_FULL_LABEL[resolved.designation],
      sourceKind: "ADMIN_OVERRIDE",
      sourceBadge: "Admin override",
      practiceStatus,
      officialGameStatusLabel: DESIGNATION_FULL_LABEL[resolved.designation],
      injuryContext,
    };
  }

  if (resolved.rosterUnavailable) {
    return {
      designation: resolved.designation,
      designationLabel:
        resolved.unavailableReason ??
        DESIGNATION_FULL_LABEL[resolved.designation],
      sourceKind: "ROSTER_UNAVAILABLE",
      sourceBadge: `Roster · ${resolved.unavailableReason ?? resolved.rosterStatus ?? "unavailable"}`,
      practiceStatus,
      officialGameStatusLabel: "—",
      injuryContext,
    };
  }

  if (
    input.hasWeekRecord &&
    resolved.sourceType === "NFL_SYNC" &&
    (resolved.designation === "OUT" ||
      resolved.designation === "QUESTIONABLE" ||
      resolved.designation === "DOUBTFUL" ||
      resolved.designation === "INACTIVE" ||
      resolved.designation === "AVAILABLE")
  ) {
    return {
      designation: resolved.designation,
      designationLabel: DESIGNATION_FULL_LABEL[resolved.designation],
      sourceKind: "OFFICIAL_GAME_STATUS",
      sourceBadge: "NFL.com · official game status",
      practiceStatus,
      officialGameStatusLabel: DESIGNATION_FULL_LABEL[resolved.designation],
      injuryContext,
    };
  }

  if (input.onInjuryReportOfficialGameStatus && input.hasWeekRecord) {
    return {
      designation: resolved.designation,
      designationLabel: DESIGNATION_FULL_LABEL[resolved.designation],
      sourceKind: "OFFICIAL_GAME_STATUS",
      sourceBadge: "NFL.com · official game status",
      practiceStatus,
      officialGameStatusLabel: DESIGNATION_FULL_LABEL[resolved.designation],
      injuryContext,
    };
  }

  if (input.onInjuryReportBlankGameStatus || practiceStatus) {
    const watchLabel = injuryWatchPrimaryLabel(injuryContext);
    return {
      designation: "UNKNOWN",
      designationLabel: watchLabel ?? "No official status yet",
      sourceKind: "PRACTICE_ONLY",
      sourceBadge: "NFL.com game status not published",
      practiceStatus,
      officialGameStatusLabel: "No official status yet",
      injuryContext,
    };
  }

  if (!input.hasWeekRecord) {
    return {
      designation: "UNKNOWN",
      designationLabel: "No official status yet",
      sourceKind: "NO_SOURCE_ROW",
      sourceBadge: "No current-week injury row",
      practiceStatus,
      officialGameStatusLabel: "No official status yet",
      injuryContext,
    };
  }

  const watchLabel =
    resolved.designation === "UNKNOWN"
      ? injuryWatchPrimaryLabel(injuryContext)
      : null;
  return {
    designation: resolved.designation,
    designationLabel:
      watchLabel ??
      (resolved.designation === "UNKNOWN"
        ? "No official status yet"
        : DESIGNATION_FULL_LABEL[resolved.designation]),
    sourceKind: "NO_OFFICIAL_STATUS",
    sourceBadge: "NFL.com game status not published",
    practiceStatus,
    officialGameStatusLabel:
      resolved.designation === "UNKNOWN"
        ? "No official status yet"
        : DESIGNATION_FULL_LABEL[resolved.designation],
    injuryContext,
  };
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
  if (
    raw === "FA" ||
    raw === "FREE_AGENT" ||
    raw === "CUT" ||
    raw === "RETIRED" ||
    raw === "RELEASED" ||
    raw === "TRD" ||
    raw === "TRC" ||
    raw === "TRT"
  ) {
    return true;
  }
  if (
    raw.startsWith("IR") ||
    raw === "RES" ||
    raw === "RSR" ||
    raw === "RESERVE_INJURED"
  ) {
    return true;
  }
  if (raw === "PUP" || raw.startsWith("PUP") || raw.startsWith("NFI")) {
    return true;
  }
  if (raw === "SUSPENDED" || raw === "SUS") return true;
  if (
    raw === "PRACTICE_SQUAD" ||
    raw === "DEV" ||
    raw === "PRAC" ||
    raw === "E14"
  ) {
    return true;
  }
  if (raw === "EXE" || raw === "RSN" || raw === "INACTIVE" || raw === "INA") {
    return true;
  }
  return false;
}

export function rosterUnavailableLabel(
  nflStatus: string | null | undefined,
): string {
  const mapped = mapNflStatusToAvailability(nflStatus);
  if (mapped && ROSTER_UNAVAILABLE_ENTRY.has(mapped)) return mapped;
  const raw = (nflStatus ?? "").trim().toUpperCase();
  if (raw === "FA" || raw === "CUT" || raw === "RELEASED") return "FREE_AGENT";
  // Traded-away markers on a stale team roster — treat like CUT/FA for this
  // ContestEntry/team context (not a permanent global ban).
  if (raw === "TRD" || raw === "TRC" || raw === "TRT") return "FREE_AGENT";
  if (
    raw.startsWith("IR") ||
    raw === "RES" ||
    raw === "RSR" ||
    raw === "RESERVE_INJURED" ||
    raw.startsWith("NFI") ||
    raw === "RSN"
  ) {
    return "IR";
  }
  if (raw === "PUP" || raw.startsWith("PUP")) return "PUP";
  if (raw === "SUS" || raw === "SUSPENDED") return "SUSPENDED";
  if (
    raw === "PRACTICE_SQUAD" ||
    raw === "DEV" ||
    raw === "PRAC" ||
    raw === "E14"
  ) {
    return "PRACTICE_SQUAD";
  }
  if (raw === "EXE") return "EXE";
  if (raw === "INACTIVE" || raw === "INA") return "INACTIVE";
  if (raw === "RETIRED") return "RETIRED";
  return raw || "ROSTER_UNAVAILABLE";
}

export type ResolvedPlayerWeekStatus = {
  designation: WeeklyDesignation;
  injuryDescription: string | null;
  practiceStatus: string | null;
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
  /** Shared factual injury context for Human + AI. */
  injuryContext: InjuryContext;
};

export type ResolvePlayerWeekStatusInput = {
  nflStatus?: string | null;
  weekDesignation?: WeeklyDesignation | null;
  injuryDescription?: string | null;
  practiceStatus?: string | null;
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
  const rosterStatus = input.nflStatus?.trim() || null;
  const designation: WeeklyDesignation =
    input.weekDesignation ?? designationWithoutWeekRecord();
  const adminOverride =
    Boolean(input.manualOverride) && input.weekDesignation != null;

  // Precedence: Admin override > roster hard-unavailable > weekly designation.
  const rosterUnavailable =
    !adminOverride && isRosterUnavailableStatus(input.nflStatus);

  const weeklyUnavailable = WEEKLY_UNAVAILABLE_DESIGNATIONS.has(designation);
  const selectable = adminOverride
    ? WEEKLY_SELECTABLE_DESIGNATIONS.has(designation)
    : !rosterUnavailable && WEEKLY_SELECTABLE_DESIGNATIONS.has(designation);

  let effectiveEntryAvailability: EntryAvailability;
  if (adminOverride) {
    effectiveEntryAvailability = entryAvailabilityFromDesignation(designation);
  } else if (rosterUnavailable) {
    const mapped = mapNflStatusToAvailability(input.nflStatus);
    effectiveEntryAvailability =
      mapped && ROSTER_UNAVAILABLE_ENTRY.has(mapped)
        ? mapped
        : mapped === "INACTIVE"
          ? "INACTIVE"
          : ("FREE_AGENT" as EntryAvailability);
  } else {
    effectiveEntryAvailability = entryAvailabilityFromDesignation(designation);
  }

  const promotionUnavailable =
    (!adminOverride && rosterUnavailable) ||
    isPromotionUnavailable(effectiveEntryAvailability) ||
    weeklyUnavailable;

  let unavailableReason: string | null = null;
  if (adminOverride) {
    if (weeklyUnavailable) unavailableReason = designation;
  } else if (rosterUnavailable) {
    unavailableReason = rosterUnavailableLabel(input.nflStatus);
  } else if (weeklyUnavailable) {
    unavailableReason = designation;
  }

  const note = input.injuryDescription?.trim() || null;
  const practiceStatus = input.practiceStatus?.trim() || null;
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

  const injuryContext = buildInjuryContext({
    injuryDescription: note,
    practiceStatus,
    designation,
  });

  return {
    designation,
    injuryDescription: note,
    practiceStatus,
    sourceType: input.sourceType ?? null,
    sourceUrl: input.sourceUrl ?? null,
    sourcePublishedAt: input.sourcePublishedAt ?? null,
    observedAt: input.observedAt ?? null,
    manualOverride: Boolean(input.manualOverride),
    rosterStatus,
    rosterUnavailable: adminOverride
      ? false
      : isRosterUnavailableStatus(input.nflStatus),
    weeklyUnavailable,
    selectable,
    promotionUnavailable,
    effectiveEntryAvailability,
    unavailableReason,
    eligibleDisclosure,
    injuryContext,
  };
}

/** Format "Name — TEAM — DESIGNATION — note" style lines. */
export function formatAvailabilityPromptParts(input: {
  name: string;
  team: string;
  designation: WeeklyDesignation | string;
  injuryDescription?: string | null;
  practiceStatus?: string | null;
  selectable?: boolean;
  rosterUnavailableReason?: string | null;
}): string {
  const parts = [input.name, input.team];
  if (input.rosterUnavailableReason) {
    parts.push(input.rosterUnavailableReason);
  } else {
    parts.push(String(input.designation));
  }
  const context = buildInjuryContext({
    injuryDescription: input.injuryDescription,
    practiceStatus: input.practiceStatus,
    designation: input.rosterUnavailableReason
      ? null
      : String(input.designation),
  });
  // Keep compact single-line extras for legacy callers; prefer structured
  // formatPlayerInjuryPromptBlock for multi-line AI presentation.
  const practiceLine = formatPracticeContextLine(context);
  if (practiceLine) parts.push(practiceLine);
  if (context.bodyPart) parts.push(context.bodyPart);
  return parts.join(" — ");
}

/** Multi-line AI prompt block for one player (shared InjuryContext). */
export function formatPlayerInjuryPromptBlock(input: {
  name: string;
  team: string;
  resolvedAvailabilityLabel: string;
  selectable: boolean;
  injuryDescription?: string | null;
  practiceStatus?: string | null;
  designation?: WeeklyDesignation | string | null;
}): string {
  const context = buildInjuryContext({
    injuryDescription: input.injuryDescription,
    practiceStatus: input.practiceStatus,
    designation: input.designation,
  });
  const lines = formatInjuryContextForAiPrompt({
    resolvedAvailabilityLabel: input.resolvedAvailabilityLabel,
    selectable: input.selectable,
    context,
  });
  return [`${input.name} — ${input.team}`, ...lines].join("\n  ");
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
