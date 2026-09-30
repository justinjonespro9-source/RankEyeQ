import type { ContestPosition, WaiverMatchMethod } from "@/lib/generated/prisma/client";
import { parsePlayerAliases, rankableEntryMatchesImportName } from "@/lib/nfl/player-aliases";
import { parsePlayerNameIdentity, playerNamesCanMerge } from "@/lib/nfl/player-identity";
import type { WaiverPosition } from "@/lib/waivers/constants";

/** A RankEyeQ player record the paste may resolve to, with its canonical season team. */
export type WaiverMatchCandidate = {
  id: string;
  name: string;
  adminNotes: string | null;
  position: ContestPosition;
  type: string;
  canonicalTeam: string | null;
  /** Has a season roster row for the snapshot's season. */
  onSeasonRoster: boolean;
};

export type WaiverCandidateRef = { id: string; name: string; position: ContestPosition; team: string | null };

export type WaiverMatchInvalidReason = "ID_NOT_FOUND" | "ID_POSITION_MISMATCH" | "ID_NAME_MISMATCH" | "POSITION_MISMATCH";

export type WaiverMatchResult =
  | { status: "MATCHED"; rankableEntryId: string; method: WaiverMatchMethod; teamConflict: boolean }
  | { status: "AMBIGUOUS"; candidates: WaiverCandidateRef[] }
  | { status: "UNMATCHED" }
  | { status: "INVALID"; reason: WaiverMatchInvalidReason; candidates: WaiverCandidateRef[] };

export type WaiverMatchIndex = {
  byPosition: ReadonlyMap<ContestPosition, WaiverMatchCandidate[]>;
  byId: ReadonlyMap<string, WaiverMatchCandidate>;
  /** Prefilter only: identity base key of the record name / of each admin alias. */
  byNameKey: ReadonlyMap<string, WaiverMatchCandidate[]>;
  byAliasKey: ReadonlyMap<string, WaiverMatchCandidate[]>;
};

const byIdAsc = (a: WaiverMatchCandidate, b: WaiverMatchCandidate) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const nameKey = (name: string) => parsePlayerNameIdentity(name).baseKey;

function push(map: Map<string, WaiverMatchCandidate[]>, key: string, candidate: WaiverMatchCandidate) {
  const list = map.get(key) ?? [];
  if (!list.includes(candidate)) list.push(candidate);
  map.set(key, list);
}

/**
 * `universe` is every record a name may resolve to; `idLookups` additionally
 * holds records fetched by an explicit RankEyeQ ID column value.
 */
export function buildWaiverMatchIndex(
  universe: ReadonlyArray<WaiverMatchCandidate>,
  idLookups: ReadonlyArray<WaiverMatchCandidate> = [],
): WaiverMatchIndex {
  const byPosition = new Map<ContestPosition, WaiverMatchCandidate[]>();
  const byId = new Map<string, WaiverMatchCandidate>();
  const byNameKey = new Map<string, WaiverMatchCandidate[]>();
  const byAliasKey = new Map<string, WaiverMatchCandidate[]>();
  for (const candidate of [...universe, ...idLookups]) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  const seen = new Set<string>();
  for (const candidate of [...universe].sort(byIdAsc)) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const list = byPosition.get(candidate.position) ?? [];
    list.push(candidate);
    byPosition.set(candidate.position, list);
    push(byNameKey, nameKey(candidate.name), candidate);
    for (const alias of parsePlayerAliases(candidate.adminNotes)) push(byAliasKey, nameKey(alias), candidate);
  }
  return { byPosition, byId, byNameKey, byAliasKey };
}

function nameCandidates(index: WaiverMatchIndex, playerName: string): WaiverMatchCandidate[] {
  const key = nameKey(playerName);
  const merged = [...(index.byNameKey.get(key) ?? []), ...(index.byAliasKey.get(key) ?? [])];
  return [...new Set(merged)].sort(byIdAsc);
}

const ref = (candidate: WaiverMatchCandidate): WaiverCandidateRef => ({
  id: candidate.id,
  name: candidate.name,
  position: candidate.position,
  team: candidate.canonicalTeam,
});

const teamConflict = (candidate: WaiverMatchCandidate, team: string) => (candidate.canonicalTeam ?? "FA") !== team;

function settle(
  candidates: WaiverMatchCandidate[],
  team: string,
  method: WaiverMatchMethod,
): WaiverMatchResult | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const only = candidates[0];
    return { status: "MATCHED", rankableEntryId: only.id, method, teamConflict: teamConflict(only, team) };
  }
  const sameTeam = candidates.filter((candidate) => candidate.canonicalTeam === team);
  if (sameTeam.length === 1) {
    return { status: "MATCHED", rankableEntryId: sameTeam[0].id, method, teamConflict: false };
  }
  return { status: "AMBIGUOUS", candidates: candidates.map(ref) };
}

/**
 * Strict matching ladder (no fuzzy step): explicit RankEyeQ ID → DEF by team
 * (the season-rostered defense; all team defenses only when none is rostered) →
 * exact name identity → admin alias → position mismatch → unmatched. Several
 * same-name records that the pasted team does not settle are AMBIGUOUS and
 * are never auto-picked.
 */
export function matchWaiverRow(
  input: { playerName: string; position: WaiverPosition; team: string; rankEyeQId: string | null },
  index: WaiverMatchIndex,
): WaiverMatchResult {
  if (input.rankEyeQId) {
    const entry = index.byId.get(input.rankEyeQId);
    if (!entry) return { status: "INVALID", reason: "ID_NOT_FOUND", candidates: [] };
    if (entry.position !== input.position) return { status: "INVALID", reason: "ID_POSITION_MISMATCH", candidates: [ref(entry)] };
    const compatible =
      rankableEntryMatchesImportName(entry, input.playerName) ||
      (input.position === "DEF" && entry.canonicalTeam !== null && entry.canonicalTeam === input.team);
    if (!compatible) return { status: "INVALID", reason: "ID_NAME_MISMATCH", candidates: [ref(entry)] };
    return { status: "MATCHED", rankableEntryId: entry.id, method: "ADMIN_CONFIRMED", teamConflict: teamConflict(entry, input.team) };
  }

  const samePosition = index.byPosition.get(input.position) ?? [];
  if (input.position === "DEF") {
    const teamDefenses = samePosition.filter((candidate) => candidate.type === "DEFENSE" && candidate.canonicalTeam === input.team);
    const rostered = teamDefenses.filter((candidate) => candidate.onSeasonRoster);
    const defenses = rostered.length > 0 ? rostered : teamDefenses;
    if (defenses.length === 1) {
      return { status: "MATCHED", rankableEntryId: defenses[0].id, method: "EXACT_NAME_TEAM", teamConflict: false };
    }
    if (defenses.length > 1) return { status: "AMBIGUOUS", candidates: defenses.map(ref) };
    return { status: "UNMATCHED" };
  }

  const keyed = nameCandidates(index, input.playerName);
  const atPosition = keyed.filter((candidate) => candidate.position === input.position);
  const byName = atPosition.filter((candidate) => playerNamesCanMerge(candidate.name, input.playerName));
  const nameResult = settle(byName, input.team, "EXACT_NAME_TEAM");
  if (nameResult) return nameResult;

  const byAlias = atPosition.filter((candidate) => rankableEntryMatchesImportName(candidate, input.playerName));
  const aliasResult = settle(byAlias, input.team, "ALIAS_TEAM");
  if (aliasResult) return aliasResult;

  const elsewhere = keyed.filter(
    (candidate) => candidate.position !== input.position && rankableEntryMatchesImportName(candidate, input.playerName),
  );
  if (elsewhere.length > 0) return { status: "INVALID", reason: "POSITION_MISMATCH", candidates: elsewhere.map(ref) };
  return { status: "UNMATCHED" };
}
