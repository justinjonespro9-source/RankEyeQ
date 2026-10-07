import type { SngLedgerRow } from "@/lib/waivers/canonical/artifact-types";
import type { CanonicalVerificationIssue, VerifiedSngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { classifyCanonicalParticipation, type WaiverCanonicalClass } from "@/lib/waivers/canonical/disposition";
import {
  indexCanonicalLedger,
  matchRankEyeQIdentity,
  rankEyeQIdentityRisks,
  type CanonicalConsumerKey,
  type IdentityIssueCode,
  type RankEyeQIdentity,
} from "@/lib/waivers/canonical/identity";
import { detectSnapshotCanonicalConflicts, type SnapshotCanonicalConflict } from "@/lib/waivers/canonical/policy";

/**
 * Identity preflight for one frozen Waiver snapshot against an optional
 * verified canonical artifact. Pure: it reports, it never resolves or writes.
 */

export type PreflightIssueCode =
  | IdentityIssueCode
  | "DUPLICATE_POOL_MATCH"
  | "SNAPSHOT_CANONICAL_CONFLICT"
  | "CANONICAL_RESULT_BLOCKED"
  | "WEEK_MISMATCH"
  | "ARTIFACT_NOT_VERIFIED"
  | "FROZEN_IDENTITY_MISMATCH";
export type PreflightIssue = { code: PreflightIssueCode; detail: string; snapshotEntryId?: string };

export type PreflightAdvisoryCode =
  | "IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT"
  | "TEAM_CROSSWALK_PENDING_PRODUCER_CONFIRMATION"
  | "LEDGER_NOT_EVALUATED";

export type PreflightSnapshotEntry = {
  snapshotEntryId: string;
  rankableEntryId: string;
  position: string;
  evidenceRole: string;
  eligibility: string;
  displayNameAtFreeze: string;
  teamAtFreeze: string | null;
  isByeAtFreeze: boolean;
  /** Identity key stored at freeze; null on rows frozen before Stage 4B.1. */
  frozenIdentity: { provider: string; externalId: string } | null;
  rankable: { provider: string; externalId: string; team: string; active: boolean; adminNotes: string | null; name: string };
};

export type PreflightSnapshot = {
  id: string;
  status: string;
  seasonYear: number;
  weekNumber: number;
  entries: readonly PreflightSnapshotEntry[];
};

export type PreflightRow = {
  snapshotEntryId: string;
  rankableEntryId: string;
  snapshotPosition: string;
  /** Diagnostic only; never used for matching. */
  displayNameAtFreeze: string;
  /** The identity used for matching: frozen when recorded, otherwise live. */
  rankeyeqIdentity: { provider: string; externalId: string };
  identitySource: "FROZEN_AT_SNAPSHOT" | "LIVE_NOT_FROZEN";
  liveIdentity: { provider: string; externalId: string };
  consumerKey: CanonicalConsumerKey | null;
  matched: boolean;
  canonical: {
    participantId: string;
    state: string;
    disposition: string;
    sngPosition: string;
    teamKey: string;
    pointsHundredths: number | null;
    overallPositionRank: number | null;
    cls: WaiverCanonicalClass;
  } | null;
  /** Decision 5: a label, never a blocker. */
  positionMismatch: boolean;
  conflicts: SnapshotCanonicalConflict[];
  issues: PreflightIssue[];
};

export type WaiverCanonicalPreflight = {
  snapshotId: string;
  snapshotStatus: string;
  season: number;
  week: number;
  artifact: { artifactId: string; revision: number; contentChecksum: string } | null;
  ledgerEvaluated: boolean;
  ready: boolean;
  rows: PreflightRow[];
  blockers: PreflightIssue[];
  advisories: Array<{ code: PreflightAdvisoryCode; detail: string }>;
  counts: {
    poolSize: number;
    matched: number;
    missing: number;
    duplicate: number;
    inactive: number;
    merged: number;
    providerMismatch: number;
    defCrosswalkMissing: number;
    defIdentityMalformed: number;
    conflicts: number;
    positionMismatch: number;
    frozenIdentityMismatch: number;
    identityNotFrozen: number;
    byClass: Partial<Record<WaiverCanonicalClass, number>>;
  };
};

const isPoolMember = (entry: PreflightSnapshotEntry) => entry.evidenceRole === "CANDIDATE" && entry.eligibility === "ELIGIBLE";

function toIdentity(entry: PreflightSnapshotEntry): RankEyeQIdentity {
  const key = entry.frozenIdentity ?? entry.rankable;
  return {
    rankableEntryId: entry.rankableEntryId,
    position: entry.position,
    provider: key.provider,
    externalId: key.externalId,
    team: entry.rankable.team,
    active: entry.rankable.active,
    adminNotes: entry.rankable.adminNotes,
    name: entry.displayNameAtFreeze,
  };
}

function canonicalView(row: SngLedgerRow) {
  const { cls } = classifyCanonicalParticipation(row.state, row.disposition);
  return {
    participantId: row.participantId,
    state: row.state,
    disposition: row.disposition,
    sngPosition: row.position,
    teamKey: row.teamKey,
    pointsHundredths: row.pointsHundredths,
    overallPositionRank: row.competitionRank,
    cls,
  };
}

export function evaluateWaiverCanonicalPreflight(input: {
  snapshot: PreflightSnapshot;
  verified: VerifiedSngCanonicalArtifact | null;
  artifactIssues?: readonly CanonicalVerificationIssue[];
}): WaiverCanonicalPreflight {
  const { snapshot, verified } = input;
  const blockers: PreflightIssue[] = [];
  const advisories: WaiverCanonicalPreflight["advisories"] = [];
  const pool = snapshot.entries.filter(isPoolMember);
  const unfrozen = pool.filter((entry) => entry.frozenIdentity === null).length;
  if (unfrozen > 0) {
    advisories.push({
      code: "IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT",
      detail: `${unfrozen} of ${pool.length} pool rows were frozen before the identity key was recorded; their provider/externalId are read live from RankableEntry`,
    });
  }
  if (input.artifactIssues && input.artifactIssues.length > 0) {
    blockers.push({ code: "ARTIFACT_NOT_VERIFIED", detail: input.artifactIssues.map((i) => i.code).join(", ") });
  }
  if (!verified) advisories.push({ code: "LEDGER_NOT_EVALUATED", detail: "no verified canonical artifact supplied; only identity risks were evaluated" });
  if (verified && (verified.summary.season !== snapshot.seasonYear || verified.summary.week !== snapshot.weekNumber)) {
    blockers.push({
      code: "WEEK_MISMATCH",
      detail: `artifact ${verified.summary.season} week ${verified.summary.week}; snapshot ${snapshot.seasonYear} week ${snapshot.weekNumber}`,
    });
  }

  const index = verified ? indexCanonicalLedger(verified.artifact) : null;
  if (pool.some((entry) => entry.position === "DEF")) {
    advisories.push({
      code: "TEAM_CROSSWALK_PENDING_PRODUCER_CONFIRMATION",
      detail: "DEF matching uses the source-derived SNG team crosswalk until producer fixtures confirm it",
    });
  }

  const rows: PreflightRow[] = pool.map((entry) => {
    const identity = toIdentity(entry);
    const match = index ? matchRankEyeQIdentity(identity, index) : { ...rankEyeQIdentityRisks(identity), participant: null };
    const issues: PreflightIssue[] = match.issues.map((issue) => ({ ...issue, snapshotEntryId: entry.snapshotEntryId }));
    const frozen = entry.frozenIdentity;
    if (frozen && (frozen.provider !== entry.rankable.provider || frozen.externalId !== entry.rankable.externalId)) {
      issues.push({
        code: "FROZEN_IDENTITY_MISMATCH",
        detail: `frozen ${frozen.provider}:${frozen.externalId}; live ${entry.rankable.provider}:${entry.rankable.externalId}`,
        snapshotEntryId: entry.snapshotEntryId,
      });
    }
    const canonical = match.participant ? canonicalView(match.participant) : null;
    let conflicts: SnapshotCanonicalConflict[] = [];
    if (canonical && verified) {
      if (canonical.cls === "BLOCKED") {
        issues.push({ code: "CANONICAL_RESULT_BLOCKED", detail: `${canonical.state}/${canonical.disposition}`, snapshotEntryId: entry.snapshotEntryId });
      }
      conflicts = detectSnapshotCanonicalConflicts({
        artifactContentChecksum: verified.summary.contentChecksum,
        snapshotEntryId: entry.snapshotEntryId,
        snapshot: { isByeAtFreeze: entry.isByeAtFreeze, teamAtFreeze: entry.teamAtFreeze },
        canonical: { participantId: canonical.participantId, cls: canonical.cls, disposition: canonical.disposition, teamKey: canonical.teamKey },
      });
      for (const conflict of conflicts) {
        issues.push({ code: "SNAPSHOT_CANONICAL_CONFLICT", detail: conflict.detail, snapshotEntryId: entry.snapshotEntryId });
      }
    }
    return {
      snapshotEntryId: entry.snapshotEntryId,
      rankableEntryId: entry.rankableEntryId,
      snapshotPosition: entry.position,
      displayNameAtFreeze: entry.displayNameAtFreeze,
      rankeyeqIdentity: { provider: identity.provider, externalId: identity.externalId },
      identitySource: frozen ? "FROZEN_AT_SNAPSHOT" : "LIVE_NOT_FROZEN",
      liveIdentity: { provider: entry.rankable.provider, externalId: entry.rankable.externalId },
      consumerKey: match.consumerKey,
      matched: canonical !== null,
      canonical,
      positionMismatch: canonical !== null && canonical.sngPosition !== entry.position,
      conflicts,
      issues,
    };
  });

  const byParticipant = new Map<string, PreflightRow[]>();
  for (const row of rows) {
    if (!row.canonical) continue;
    byParticipant.set(row.canonical.participantId, [...(byParticipant.get(row.canonical.participantId) ?? []), row]);
  }
  for (const [participantId, group] of byParticipant) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.issues.push({
        code: "DUPLICATE_POOL_MATCH",
        detail: `${group.length} frozen pool rows match canonical participant ${participantId}`,
        snapshotEntryId: row.snapshotEntryId,
      });
    }
  }
  for (const row of rows) blockers.push(...row.issues);

  const count = (code: PreflightIssueCode) => rows.filter((row) => row.issues.some((issue) => issue.code === code)).length;
  const byClass: Partial<Record<WaiverCanonicalClass, number>> = {};
  for (const row of rows) if (row.canonical) byClass[row.canonical.cls] = (byClass[row.canonical.cls] ?? 0) + 1;

  return {
    snapshotId: snapshot.id,
    snapshotStatus: snapshot.status,
    season: snapshot.seasonYear,
    week: snapshot.weekNumber,
    artifact: verified
      ? { artifactId: verified.summary.artifactId, revision: verified.summary.revision, contentChecksum: verified.summary.contentChecksum }
      : null,
    ledgerEvaluated: verified !== null,
    ready: verified !== null && blockers.length === 0,
    rows,
    blockers,
    advisories,
    counts: {
      poolSize: rows.length,
      matched: rows.filter((row) => row.matched && row.issues.length === 0).length,
      missing: count("PARTICIPANT_NOT_IN_LEDGER"),
      duplicate: rows.filter((row) => row.issues.some((i) => i.code === "DUPLICATE_LEDGER_MATCH" || i.code === "DUPLICATE_POOL_MATCH")).length,
      inactive: count("IDENTITY_ENTRY_INACTIVE"),
      merged: count("IDENTITY_ENTRY_MERGED"),
      providerMismatch: count("IDENTITY_PROVIDER_NOT_CONTRACT"),
      defCrosswalkMissing: count("DEF_CROSSWALK_MISSING"),
      defIdentityMalformed: count("DEF_IDENTITY_MALFORMED"),
      conflicts: count("SNAPSHOT_CANONICAL_CONFLICT"),
      positionMismatch: rows.filter((row) => row.positionMismatch).length,
      frozenIdentityMismatch: count("FROZEN_IDENTITY_MISMATCH"),
      identityNotFrozen: unfrozen,
      byClass,
    },
  };
}
