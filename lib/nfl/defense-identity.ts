import type { ContestPosition } from "@/lib/generated/prisma/client";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

/** Canonical NFL franchise key for defense uniqueness (team abbreviation). */
export function defenseFranchiseKey(team: string | null | undefined): string {
  return (team ?? "").trim().toUpperCase();
}

export function canonicalDefenseExternalId(team: string): string {
  return `def-${defenseFranchiseKey(team)}`;
}

export function isCanonicalDefenseRankableEntry(input: {
  position: ContestPosition;
  type: string;
  provider: string;
  externalId: string;
  team: string;
}): boolean {
  if (input.position !== "DEF" || input.type !== "DEFENSE") return false;
  return (
    input.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
    input.externalId === canonicalDefenseExternalId(input.team)
  );
}

export function defenseEntryIdentityKey(input: {
  team: string;
  position: ContestPosition;
  provider: string;
  externalId: string;
  type: string;
}): string {
  if (input.position !== "DEF") {
    return `${input.position}|${input.externalId}|${input.provider}`;
  }
  return `DEF|${defenseFranchiseKey(input.team)}`;
}
