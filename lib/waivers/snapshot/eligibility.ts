import type {
  NflGameStatus,
  WaiverEligibility,
  WaiverEvidenceRole,
  WaiverExclusionReason,
  WeeklyAvailabilityDesignation,
} from "@/lib/generated/prisma/client";
import type { ResolvedPlayerWeekStatus } from "@/lib/eligibility/player-week-availability";
import { isCanonicalNflTeamAbbr, isMissingTeam, normalizeTeamAbbr } from "@/lib/nfl/manual/parse-common";
import { resolveWeekGameForTeam } from "@/lib/providers/nfl/eligibility";

export type WaiverRosterFact = { team: string | null; activeOnNFLRoster: boolean; nflStatus: string | null };

export type WaiverAvailabilityFact = {
  designation: WeeklyAvailabilityDesignation;
  selectable: boolean;
  rosterStatus: string | null;
  unavailableReason: string | null;
  /** Compact provenance: weekly source type, observation time and override flag, or NO_WEEK_ROW. */
  source: string;
};

export type WaiverWeekGame = { id: string; homeTeam: string; awayTeam: string; startsAt: Date; status: NflGameStatus };

export type WaiverGameFact =
  | { kind: "GAME"; gameId: string; opponent: string; kickoff: Date; status: NflGameStatus }
  | { kind: "BYE" }
  | { kind: "NO_SCHEDULED_GAME" }
  | { kind: "NO_TEAM" }
  | { kind: "AMBIGUOUS"; gameIds: string[] };

/** Canonical RankEyeQ facts for one player at one week (never taken from the paste). */
export type WaiverEntryFacts = {
  rankableEntryId: string;
  canonicalName: string;
  canonicalTeam: string | null;
  roster: WaiverRosterFact | null;
  game: WaiverGameFact;
  availability: WaiverAvailabilityFact;
};

export type WaiverEligibilityDecision = {
  eligibility: WaiverEligibility;
  exclusionReason: WaiverExclusionReason | null;
  exclusionNote: string | null;
};

/** Season roster team first, player record team as fallback; missing-team tokens are null. */
export function canonicalWaiverTeam(rosterTeam: string | null | undefined, entryTeam: string | null | undefined): string | null {
  const raw = rosterTeam?.trim() ? rosterTeam : entryTeam;
  if (!raw || isMissingTeam(raw)) return null;
  return normalizeTeamAbbr(raw);
}

/**
 * The team's game this week. CANCELED is no game; POSTPONED still counts as
 * scheduled. A team on two games is AMBIGUOUS (never guessed).
 */
export function resolveWaiverGame(team: string | null, games: ReadonlyArray<WaiverWeekGame>): WaiverGameFact {
  if (!team) return { kind: "NO_TEAM" };
  if (!isCanonicalNflTeamAbbr(team)) return { kind: "NO_SCHEDULED_GAME" };
  const resolution = resolveWeekGameForTeam(
    games.filter((game) => game.status !== "CANCELED"),
    team,
  );
  if (resolution.status === "none") return { kind: "BYE" };
  if (resolution.status === "ambiguous") return { kind: "AMBIGUOUS", gameIds: resolution.games.map((game) => game.id).sort() };
  const game = resolution.game;
  const opponent = normalizeTeamAbbr(game.homeTeam) === team ? normalizeTeamAbbr(game.awayTeam) : normalizeTeamAbbr(game.homeTeam);
  return { kind: "GAME", gameId: game.id, opponent, kickoff: game.startsAt, status: game.status };
}

export function waiverAvailabilityFact(resolved: ResolvedPlayerWeekStatus, hasWeekRow: boolean): WaiverAvailabilityFact {
  const source = hasWeekRow
    ? [
        resolved.sourceType ?? "UNKNOWN_SOURCE",
        resolved.observedAt ? resolved.observedAt.toISOString() : "NO_OBSERVED_AT",
        resolved.manualOverride ? "OVERRIDE" : "NO_OVERRIDE",
      ].join("|")
    : "NO_WEEK_ROW";
  return {
    designation: resolved.designation,
    selectable: resolved.selectable,
    rosterStatus: resolved.rosterStatus,
    unavailableReason: resolved.unavailableReason,
    source,
  };
}

/** Tracked players observed at or above the threshold are follow-up evidence; everything else is a candidate. */
export function deriveWaiverEvidenceRole(input: { rosteredBps: number; thresholdBps: number; tracked: boolean }): WaiverEvidenceRole {
  return input.tracked && input.rosteredBps >= input.thresholdBps ? "FOLLOW_UP" : "CANDIDATE";
}

/**
 * Candidate precedence — the first failing rule is the exclusion reason and
 * the rest are listed in the note: ownership ≥ threshold, not on an NFL
 * roster, bye / no scheduled game, hard-unavailable. Q/D/UNKNOWN stay eligible.
 */
export function deriveWaiverEligibility(input: {
  role: WaiverEvidenceRole;
  rosteredBps: number;
  thresholdBps: number;
  facts: WaiverEntryFacts;
}): WaiverEligibilityDecision {
  if (input.role === "FOLLOW_UP") return { eligibility: "OBSERVATION_ONLY", exclusionReason: null, exclusionNote: null };
  const { facts } = input;
  const failures: WaiverExclusionReason[] = [];
  if (input.rosteredBps >= input.thresholdBps) failures.push("AT_OR_ABOVE_THRESHOLD");
  if (!facts.roster || !facts.roster.activeOnNFLRoster || !facts.canonicalTeam) failures.push("NOT_ON_NFL_ROSTER");
  if (facts.game.kind === "BYE") failures.push("BYE");
  if (facts.game.kind === "NO_SCHEDULED_GAME") failures.push("NO_SCHEDULED_GAME");
  if (!facts.availability.selectable) failures.push("HARD_UNAVAILABLE");
  if (failures.length === 0) return { eligibility: "ELIGIBLE", exclusionReason: null, exclusionNote: null };

  const details: string[] = [];
  if (failures.length > 1) details.push(`Also: ${failures.slice(1).join(", ")}`);
  if (failures.includes("HARD_UNAVAILABLE")) {
    details.push(
      `Availability: ${facts.availability.unavailableReason ?? facts.availability.designation}` +
        (facts.availability.rosterStatus ? ` (roster ${facts.availability.rosterStatus})` : ""),
    );
  }
  return {
    eligibility: "EXCLUDED",
    exclusionReason: failures[0],
    exclusionNote: details.length > 0 ? details.join("; ") : null,
  };
}
