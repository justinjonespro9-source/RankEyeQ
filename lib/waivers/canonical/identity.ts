import type { SngCanonicalArtifact, SngLedgerRow } from "@/lib/waivers/canonical/artifact-types";
import {
  RANKEYEQ_PLAYER_IDENTITY_PROVIDER,
  SNG_DEFENSE_IDENTITY_PROVIDER,
  type SngParticipantKind,
} from "@/lib/waivers/canonical/contract";
import { rankEyeQDefenseTeamFromExternalId, sngTeamForRankEyeQTeam } from "@/lib/waivers/canonical/team-crosswalk";

/**
 * Exact RankEyeQ → SNG identity matching. Players match on the contract
 * provider + externalId; DEF matches on the crosswalked SNG stable team key.
 * Names are carried for diagnostics only and never resolve a match.
 */

export const IDENTITY_ISSUE_CODES = [
  "IDENTITY_PROVIDER_NOT_CONTRACT",
  "IDENTITY_ENTRY_INACTIVE",
  "IDENTITY_ENTRY_MERGED",
  "DEF_IDENTITY_MALFORMED",
  "DEF_CROSSWALK_MISSING",
  "PARTICIPANT_NOT_IN_LEDGER",
  "DUPLICATE_LEDGER_MATCH",
] as const;
export type IdentityIssueCode = (typeof IDENTITY_ISSUE_CODES)[number];
export type IdentityIssue = { code: IdentityIssueCode; detail: string };

export type RankEyeQIdentity = {
  rankableEntryId: string;
  /** Snapshot (competitive) position. */
  position: string;
  provider: string;
  externalId: string;
  team: string;
  active: boolean;
  adminNotes: string | null;
  /** Diagnostic only. */
  name: string;
};

export type CanonicalConsumerKey = { kind: SngParticipantKind; provider: string; externalId: string };

export type CanonicalLedgerIndex = ReadonlyMap<string, readonly SngLedgerRow[]>;

const indexKey = (key: CanonicalConsumerKey) => `${key.kind}\u0000${key.provider}\u0000${key.externalId}`;

/** Indexes ledger participants by their contract identity only. */
export function indexCanonicalLedger(artifact: SngCanonicalArtifact): CanonicalLedgerIndex {
  const index = new Map<string, SngLedgerRow[]>();
  for (const row of artifact.payload.participationLedger) {
    const provider = row.kind === "PLAYER" ? RANKEYEQ_PLAYER_IDENTITY_PROVIDER : SNG_DEFENSE_IDENTITY_PROVIDER;
    for (const identity of row.identities) {
      if (identity.provider !== provider) continue;
      const key = indexKey({ kind: row.kind, provider, externalId: identity.externalId });
      index.set(key, [...(index.get(key) ?? []), row]);
    }
  }
  return index;
}

const MERGE_NOTE_PREFIXES = ["Merged into ", "Superseded by "];

/** Identity risks visible without any canonical artifact. */
export function rankEyeQIdentityRisks(entry: RankEyeQIdentity): { consumerKey: CanonicalConsumerKey | null; issues: IdentityIssue[] } {
  const issues: IdentityIssue[] = [];
  const label = `${entry.name} (${entry.rankableEntryId})`;
  const mergedNote = MERGE_NOTE_PREFIXES.some((prefix) => (entry.adminNotes ?? "").startsWith(prefix));
  if (mergedNote) {
    issues.push({ code: "IDENTITY_ENTRY_MERGED", detail: `${label} was merged or superseded: ${entry.adminNotes}` });
  } else if (!entry.active) {
    issues.push({ code: "IDENTITY_ENTRY_INACTIVE", detail: `${label} is inactive` });
  }
  if (entry.provider !== RANKEYEQ_PLAYER_IDENTITY_PROVIDER) {
    issues.push({
      code: "IDENTITY_PROVIDER_NOT_CONTRACT",
      detail: `${label} uses provider ${entry.provider}; the contract requires ${RANKEYEQ_PLAYER_IDENTITY_PROVIDER}`,
    });
    return { consumerKey: null, issues };
  }
  if (entry.position !== "DEF") {
    return { consumerKey: { kind: "PLAYER", provider: RANKEYEQ_PLAYER_IDENTITY_PROVIDER, externalId: entry.externalId }, issues };
  }
  const defenseTeam = rankEyeQDefenseTeamFromExternalId(entry.externalId);
  if (defenseTeam === null || defenseTeam !== entry.team) {
    issues.push({ code: "DEF_IDENTITY_MALFORMED", detail: `${label}: DEF identity ${entry.externalId} must be def-{TEAM} for team ${entry.team}` });
    return { consumerKey: null, issues };
  }
  const team = sngTeamForRankEyeQTeam(defenseTeam);
  if (!team) {
    issues.push({ code: "DEF_CROSSWALK_MISSING", detail: `${label}: RankEyeQ team ${defenseTeam} has no SNG team crosswalk row` });
    return { consumerKey: null, issues };
  }
  return { consumerKey: { kind: "TEAM_DEFENSE", provider: SNG_DEFENSE_IDENTITY_PROVIDER, externalId: team.sngTeamKey }, issues };
}

export type IdentityMatch = {
  rankableEntryId: string;
  consumerKey: CanonicalConsumerKey | null;
  participant: SngLedgerRow | null;
  issues: IdentityIssue[];
};

export function matchRankEyeQIdentity(entry: RankEyeQIdentity, index: CanonicalLedgerIndex): IdentityMatch {
  const { consumerKey, issues } = rankEyeQIdentityRisks(entry);
  if (!consumerKey) return { rankableEntryId: entry.rankableEntryId, consumerKey, participant: null, issues };
  const rows = index.get(indexKey(consumerKey)) ?? [];
  const label = `${entry.name} (${consumerKey.provider}:${consumerKey.externalId})`;
  if (rows.length === 0) {
    issues.push({ code: "PARTICIPANT_NOT_IN_LEDGER", detail: `${label} has no exact canonical ledger participant` });
    return { rankableEntryId: entry.rankableEntryId, consumerKey, participant: null, issues };
  }
  if (rows.length > 1) {
    issues.push({ code: "DUPLICATE_LEDGER_MATCH", detail: `${label} matches ${rows.length} ledger participants` });
    return { rankableEntryId: entry.rankableEntryId, consumerKey, participant: null, issues };
  }
  return { rankableEntryId: entry.rankableEntryId, consumerKey, participant: rows[0], issues };
}
