import type { WaiverCanonicalClass } from "@/lib/waivers/canonical/disposition";
import {
  RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION,
  RANKEYEQ_IDENTITY_PROVIDER,
  RANKEYEQ_RESULTS_AUTHORITY_BASIS,
  type RankEyeQParticipationState,
} from "@/lib/waivers/rankeyeq-results/contract";
import type { RankEyeQFinalWeekStatsContent, RankEyeQParticipant } from "@/lib/waivers/rankeyeq-results/types";
import type { VerifiedRankEyeQFinalWeekStats } from "@/lib/waivers/rankeyeq-results/verify";

/**
 * RankEyeQ-native results ledger. A verified `rankeyeq-final-week-stats/1`
 * snapshot is indexed by the frozen RankableEntry identity (`nflcom-bootstrap`
 * + externalId; DEF is `def-{TEAM}`), so matching needs no SNG team crosswalk,
 * no `sng-team` key and no SNG artifact. A match is exact: names never resolve
 * one, and the rankableEntryId must agree with the identity.
 */

export const RANKEYEQ_RESULTS_SOURCE_KIND = "RANKEYEQ_FINAL_WEEK_STATS" as const;

export type RankEyeQResultsLedgerIndex = ReadonlyMap<string, readonly RankEyeQParticipant[]>;

export type RankEyeQResultsProvenance = {
  /** Stored WaiverRankEyeQResultsSnapshot row id (null for an unstored preview). */
  snapshotRowId: string | null;
  revision: number | null;
  authorityBasis: string;
};

/**
 * A snapshot that passed verification (ACCEPTED, nothing unresolved), indexed
 * for exact identity matching. This is the input type future grading takes
 * for the RankEyeQ source, distinct from VerifiedSngCanonicalArtifact.
 */
export type VerifiedRankEyeQResultsSource = {
  sourceKind: typeof RANKEYEQ_RESULTS_SOURCE_KIND;
  schemaVersion: typeof RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION;
  contentChecksum: string;
  seriesKey: string;
  scoringVersion: string;
  week: RankEyeQFinalWeekStatsContent["week"];
  waiverSnapshot: RankEyeQFinalWeekStatsContent["waiverSnapshot"];
  provenance: RankEyeQResultsProvenance;
  participants: readonly RankEyeQParticipant[];
  ledger: RankEyeQResultsLedgerIndex;
};

const indexKey = (provider: string, externalId: string) => `${provider}\u0000${externalId}`;

export function indexRankEyeQResultsLedger(participants: readonly RankEyeQParticipant[]): RankEyeQResultsLedgerIndex {
  const index = new Map<string, RankEyeQParticipant[]>();
  for (const participant of participants) {
    const key = indexKey(participant.provider, participant.externalId);
    index.set(key, [...(index.get(key) ?? []), participant]);
  }
  return index;
}

/** Projects a verified snapshot into the RankEyeQ-native source the grading layer consumes. */
export function projectRankEyeQResultsSource(
  verified: VerifiedRankEyeQFinalWeekStats,
  provenance: Partial<RankEyeQResultsProvenance> = {},
): VerifiedRankEyeQResultsSource {
  const { content } = verified;
  // A pre-publication verification (allowUnresolved) must never become a grading source.
  if (content.summary.unresolvedCount !== 0 || content.participants.some((p) => p.participationState === "PENDING_ZERO_REVIEW" || p.participationState === "ABSENT_UNRESOLVED")) {
    throw new Error("Cannot project a RankEyeQ results source with unresolved participants");
  }
  return {
    sourceKind: RANKEYEQ_RESULTS_SOURCE_KIND,
    schemaVersion: RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION,
    contentChecksum: verified.contentChecksum,
    seriesKey: content.seriesKey,
    scoringVersion: content.scoringVersion,
    week: content.week,
    waiverSnapshot: content.waiverSnapshot,
    provenance: {
      snapshotRowId: provenance.snapshotRowId ?? null,
      revision: provenance.revision ?? null,
      authorityBasis: provenance.authorityBasis ?? RANKEYEQ_RESULTS_AUTHORITY_BASIS,
    },
    participants: content.participants,
    ledger: indexRankEyeQResultsLedger(content.participants),
  };
}

export const RANKEYEQ_MATCH_ISSUE_CODES = [
  "IDENTITY_PROVIDER_NOT_CONTRACT",
  "DEF_IDENTITY_MALFORMED",
  "PARTICIPANT_NOT_IN_LEDGER",
  "DUPLICATE_LEDGER_MATCH",
  "RANKABLE_ENTRY_MISMATCH",
] as const;
export type RankEyeQMatchIssueCode = (typeof RANKEYEQ_MATCH_ISSUE_CODES)[number];
export type RankEyeQMatchIssue = { code: RankEyeQMatchIssueCode; detail: string };

/** The RankEyeQ side of a match: the frozen identity of one snapshot entry. */
export type RankEyeQResultsIdentity = {
  rankableEntryId: string;
  /** Competitive (snapshot) position. */
  position: string;
  /** Frozen provider/externalId (live only on rows frozen before the identity key existed). */
  provider: string;
  externalId: string;
  team: string | null;
  /** Diagnostic only. */
  name: string;
};

export type RankEyeQResultsMatch = {
  rankableEntryId: string;
  participant: RankEyeQParticipant | null;
  issues: RankEyeQMatchIssue[];
};

export function matchRankEyeQResultsIdentity(identity: RankEyeQResultsIdentity, index: RankEyeQResultsLedgerIndex): RankEyeQResultsMatch {
  const issues: RankEyeQMatchIssue[] = [];
  const label = `${identity.name} (${identity.provider}:${identity.externalId})`;
  if (identity.provider !== RANKEYEQ_IDENTITY_PROVIDER) {
    issues.push({ code: "IDENTITY_PROVIDER_NOT_CONTRACT", detail: `${label}: the contract requires ${RANKEYEQ_IDENTITY_PROVIDER}` });
    return { rankableEntryId: identity.rankableEntryId, participant: null, issues };
  }
  if (identity.position === "DEF" && identity.externalId !== `def-${identity.team}`) {
    issues.push({ code: "DEF_IDENTITY_MALFORMED", detail: `${label}: DEF identity must be def-{TEAM} for team ${identity.team}` });
    return { rankableEntryId: identity.rankableEntryId, participant: null, issues };
  }
  const rows = index.get(indexKey(identity.provider, identity.externalId)) ?? [];
  if (rows.length === 0) {
    issues.push({ code: "PARTICIPANT_NOT_IN_LEDGER", detail: `${label} has no exact RankEyeQ results participant` });
    return { rankableEntryId: identity.rankableEntryId, participant: null, issues };
  }
  if (rows.length > 1) {
    issues.push({ code: "DUPLICATE_LEDGER_MATCH", detail: `${label} matches ${rows.length} results participants` });
    return { rankableEntryId: identity.rankableEntryId, participant: null, issues };
  }
  const [participant] = rows;
  if (participant.rankableEntryId !== identity.rankableEntryId) {
    issues.push({
      code: "RANKABLE_ENTRY_MISMATCH",
      detail: `${label}: ledger participant belongs to rankableEntryId ${participant.rankableEntryId}, not ${identity.rankableEntryId}`,
    });
    return { rankableEntryId: identity.rankableEntryId, participant: null, issues };
  }
  return { rankableEntryId: identity.rankableEntryId, participant, issues };
}

/**
 * Waivers handling class of a RankEyeQ participant, in the same vocabulary the
 * SNG path uses: scorable → RANKED (0 is a real score only after an operator
 * PLAYED_ZERO), verified DNP → NON_PARTICIPANT, anything unresolved → BLOCKED.
 * RankEyeQ has no cancelled/moved/bye dispositions, so no neutralize classes.
 */
export function classifyRankEyeQParticipant(participant: Pick<RankEyeQParticipant, "participationState" | "disposition">): {
  cls: WaiverCanonicalClass;
  reason: string;
} {
  const state: RankEyeQParticipationState = participant.participationState;
  switch (state) {
    case "PARTICIPATED_WITH_STATS":
    case "PARTICIPATED_ZERO":
      return participant.disposition === "PLAYED"
        ? { cls: "RANKED", reason: state }
        : { cls: "BLOCKED", reason: `${state} with disposition ${participant.disposition} is incoherent` };
    case "VERIFIED_NON_PARTICIPANT":
      return participant.disposition === "DNP"
        ? { cls: "NON_PARTICIPANT", reason: "DNP" }
        : { cls: "BLOCKED", reason: `VERIFIED_NON_PARTICIPANT with disposition ${participant.disposition} is incoherent` };
    case "PENDING_ZERO_REVIEW":
    case "ABSENT_UNRESOLVED":
      return { cls: "BLOCKED", reason: `${state} is not authoritative` };
  }
}
