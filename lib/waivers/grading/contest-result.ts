import type { VerifiedSngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { collectWaiverContestMembers, waiverContestMemberConflicts, waiverMemberIdentity } from "@/lib/waivers/canonical/contest-members";
import { indexCanonicalLedger } from "@/lib/waivers/canonical/identity";
import { waiverHonorScoreableSlots } from "@/lib/waivers/canonical/policy";
import { evaluateCanonicalPreflightEntry, type PreflightRow, type PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";
import type { WaiverPosition } from "@/lib/waivers/constants";
import type {
  WaiverGradingAdvisory,
  WaiverGradingAppliedResolution,
  WaiverGradingContestResult,
  WaiverGradingIssue,
  WaiverGradingIssueCode,
  WaiverGradingPoolRow,
} from "@/lib/waivers/grading/model";
import { rankWaiverPool } from "@/lib/waivers/ranking";
import * as fingerprints from "@/lib/waivers/results/fingerprints";
import { WAIVER_RESULTS_POLICY_VERSION } from "@/lib/waivers/results/model";

/**
 * One contest's result from the frozen pool and a verified canonical artifact:
 * every eligible pool member and every invalidated called player, matched by
 * exact frozen identity, with the approved treatments (D1 DNP zero, D2
 * neutralization, C2 pre-lock invalidation, D3 current operator resolutions)
 * and shared competition ranks over the post-treatment RANKED rows only.
 * Missing, duplicate, blocked or unresolved inputs block; nothing is inferred.
 */

export type WaiverGradingResolutionInput = WaiverGradingAppliedResolution & { snapshotEntryId: string; sngParticipantId: string };

export type WaiverContestResultInput = {
  position: WaiverPosition;
  contest: { id: string; weekId: string; snapshotId: string; maxCalls: number; resultFieldSize: number };
  /** The contest's pinned snapshot, every entry (all positions and eligibilities). */
  snapshot: { season: number; weekNumber: number; version: number; entriesFingerprint: string; entries: readonly PreflightSnapshotEntry[] };
  artifact: { rowId: string; artifactId: string; seriesKey: string; revision: number; contentChecksum: string };
  verified: VerifiedSngCanonicalArtifact;
  /** The snapshot entry of every call on the contest's locked revisions. */
  calledEntries: readonly PreflightSnapshotEntry[];
  /** Current (unsuperseded) D3 resolutions of this contest and artifact revision. */
  resolutions: readonly WaiverGradingResolutionInput[];
};

export type WaiverContestResultBuild =
  | {
      status: "READY";
      result: WaiverGradingContestResult;
      rows: WaiverGradingPoolRow[];
      appliedResolutions: WaiverGradingAppliedResolution[];
      honorScoreableSlots: number;
      issues: [];
      advisories: WaiverGradingAdvisory[];
    }
  | { status: "BLOCKED"; issues: WaiverGradingIssue[]; advisories: WaiverGradingAdvisory[] };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildWaiverContestResult(input: WaiverContestResultInput): WaiverContestResultBuild {
  const { position, contest, snapshot, artifact, verified } = input;
  const issues: WaiverGradingIssue[] = [];
  const advisories: WaiverGradingAdvisory[] = [];
  const issue = (code: WaiverGradingIssueCode, detail: string, snapshotEntryId?: string) =>
    issues.push({ code, detail, position, ...(snapshotEntryId ? { snapshotEntryId } : {}) });

  if (verified.summary.contentChecksum !== artifact.contentChecksum) {
    issue("ARTIFACT_CONTENT_INVALID", "verified artifact content does not match the artifact row checksum");
  }
  const index = indexCanonicalLedger(verified.artifact);
  const resultSets = new Map(verified.artifact.payload.resultSets.map((set) => [set.positionCode as string, set]));
  const contestSet = resultSets.get(position);
  if (!contestSet) issue("RESULT_SET_MISSING", `artifact has no ${position} result set`);

  // Members: the eligible pool, then players called on locked boards outside it.
  const { eligible, members, ambiguous } = collectWaiverContestMembers({ position, snapshotEntries: snapshot.entries, calledEntries: input.calledEntries });
  for (const a of ambiguous) {
    issue("CALLED_IDENTITY_AMBIGUOUS", `called player ${a.rankableEntryId} carries ${a.identityCount} different frozen identities`, a.snapshotEntryId);
  }

  const evaluated = members.map((member) => ({ member, row: evaluateCanonicalPreflightEntry(member.entry, index, verified) }));
  if (members.some((m) => m.entry.frozenIdentity === null)) {
    advisories.push({ code: "IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT", detail: "some rows use the live identity key (frozen before Stage 4B.1)", position });
  }
  const byParticipant = new Map<string, PreflightRow[]>();
  for (const { row } of evaluated) {
    // Snapshot conflicts block below unless a current D3 resolution settles them.
    for (const found of row.issues) if (found.code !== "SNAPSHOT_CANONICAL_CONFLICT") issue(found.code, found.detail, found.snapshotEntryId);
    if (!row.canonical) continue;
    byParticipant.set(row.canonical.participantId, [...(byParticipant.get(row.canonical.participantId) ?? []), row]);
    if (row.positionMismatch) {
      advisories.push({ code: "CANONICAL_POSITION_DIFFERS", detail: `${row.displayNameAtFreeze}: SNG position ${row.canonical.sngPosition}`, position });
    }
  }
  for (const [participantId, group] of byParticipant) {
    if (group.length > 1) issue("DUPLICATE_POOL_MATCH", `${group.length} contest rows match canonical participant ${participantId}`, group[0].snapshotEntryId);
  }

  const resolutionsByKey = new Map(input.resolutions.map((r) => [r.conflictKey, r]));
  const appliedKeys = new Set<string>();
  const drafts: Array<Omit<WaiverGradingPoolRow, "rowFingerprint">> = [];
  for (const { member, row } of evaluated) {
    const canonical = row.canonical;
    if (!canonical || canonical.cls === "BLOCKED") continue;
    const at = member.entry.snapshotEntryId;

    let resultFingerprint: string | null = null;
    if (canonical.cls === "RANKED") {
      const entry = resultSets.get(canonical.sngPosition)?.entries.find((e) => e.participantId === canonical.participantId);
      if (!entry) {
        issue("RESULT_ENTRY_MISSING", `${row.displayNameAtFreeze}: ranked participant ${canonical.participantId} has no ${canonical.sngPosition} result entry`, at);
        continue;
      }
      if (entry.pointsHundredths !== canonical.pointsHundredths || entry.competitionRank !== canonical.overallPositionRank) {
        issue("RESULT_ENTRY_MISMATCH", `${row.displayNameAtFreeze}: ledger and result entry disagree on points or rank`, at);
        continue;
      }
      resultFingerprint = entry.resultFingerprint;
    }

    const conflicts = waiverContestMemberConflicts(member, row, verified.summary.contentChecksum);
    if (conflicts === "AMBIGUOUS") {
      issue("UNRESOLVED_SNAPSHOT_CONFLICT", `${row.displayNameAtFreeze}: canonical BYE against more than one originally called scheduled entry`, at);
      continue;
    }
    const applied: WaiverGradingResolutionInput[] = [];
    let unresolved = false;
    for (const conflict of conflicts) {
      const resolution = resolutionsByKey.get(conflict.conflictKey);
      if (
        !resolution ||
        resolution.conflictKind !== conflict.kind ||
        resolution.snapshotEntryId !== conflict.snapshotEntryId ||
        resolution.sngParticipantId !== canonical.participantId
      ) {
        issue("UNRESOLVED_SNAPSHOT_CONFLICT", `${row.displayNameAtFreeze}: ${conflict.detail}`, conflict.snapshotEntryId);
        unresolved = true;
        continue;
      }
      applied.push(resolution);
      appliedKeys.add(resolution.conflictKey);
    }
    if (canonical.cls === "SNAPSHOT_CONFLICT" && conflicts.length === 0) {
      issue("UNRESOLVED_SNAPSHOT_CONFLICT", `${row.displayNameAtFreeze}: canonical BYE has no resolvable snapshot conflict`, at);
      unresolved = true;
    }
    if (unresolved) continue;
    if (applied.length > 1) {
      issue("CONFLICT_RESOLUTION_NOT_APPLICABLE", `${row.displayNameAtFreeze}: a pool row applies at most one D3 resolution`, at);
      continue;
    }
    const resolution = applied[0] ?? null;
    if (resolution?.resolution === "SCORE_AS_RANKED" && canonical.cls !== "RANKED") {
      issue("CONFLICT_RESOLUTION_NOT_APPLICABLE", `${row.displayNameAtFreeze}: SCORE_AS_RANKED requires a ranked canonical result`, at);
      continue;
    }

    let treatment: WaiverGradingPoolRow["treatment"];
    let precedence: WaiverGradingPoolRow["neutralizationPrecedence"] = null;
    if (member.category === "ELIGIBLE_POOL_MEMBER") {
      if (resolution) treatment = resolution.resolution === "SCORE_AS_RANKED" ? "RANKED" : resolution.resolution;
      else treatment = canonical.cls === "RANKED" ? "RANKED" : canonical.cls === "NON_PARTICIPANT" ? "NON_PARTICIPANT_ZERO" : "NEUTRALIZED";
    } else if (canonical.cls === "SYSTEMIC_NEUTRALIZE") {
      treatment = "NEUTRALIZED";
      precedence = "D2_NEUTRALIZATION_OVER_C2_INVALIDATION";
    } else if (resolution?.resolution === "NEUTRALIZED") {
      treatment = "NEUTRALIZED";
      precedence = "D3_NEUTRALIZATION_OVER_C2_INVALIDATION";
    } else {
      treatment = "INVALIDATED_PRE_LOCK";
    }

    const ranked = canonical.cls === "RANKED";
    const identity = waiverMemberIdentity(member.entry);
    drafts.push({
      category: member.category,
      snapshotEntryId: member.snapshotEntryId,
      rankableEntryId: member.entry.rankableEntryId,
      position,
      identityProvider: identity.provider,
      identityExternalId: identity.externalId,
      sngParticipantId: canonical.participantId,
      participationState: canonical.state,
      participantDisposition: canonical.disposition,
      canonicalClass: canonical.cls,
      canonicalPointsHundredths: ranked ? canonical.pointsHundredths : null,
      canonicalPositionRank: ranked ? canonical.overallPositionRank : null,
      sngResultFingerprint: resultFingerprint,
      treatment,
      fpHundredths: treatment === "RANKED" ? canonical.pointsHundredths : treatment === "NEUTRALIZED" ? null : 0,
      waiverPoolRank: null,
      neutralizationPrecedence: precedence,
      conflictResolutionId: resolution?.id ?? null,
      invalidationBasis: member.invalidationBasis,
      invalidatedBySnapshotId: member.category === "ELIGIBLE_POOL_MEMBER" ? null : contest.snapshotId,
      meta: {
        resolution: resolution ? { conflictKey: resolution.conflictKey, sequence: resolution.sequence } : null,
        displayName: member.entry.displayNameAtFreeze,
        sngPosition: canonical.sngPosition,
      },
    });
  }
  for (const resolution of input.resolutions) {
    if (!appliedKeys.has(resolution.conflictKey)) {
      issue("UNAPPLIED_CONFLICT_RESOLUTION", `current D3 resolution ${resolution.conflictKey} matches no conflict of this contest`, resolution.snapshotEntryId);
    }
  }
  if (issues.length > 0 || !contestSet) return { status: "BLOCKED", issues, advisories };

  const ranks = new Map(rankWaiverPool(drafts.filter((d) => d.treatment === "RANKED"), (d) => d.fpHundredths!).map((r) => [r.item.rankableEntryId, r.waiverRank]));
  const rows: WaiverGradingPoolRow[] = drafts.map((draft) => {
    const row = { ...draft, waiverPoolRank: ranks.get(draft.rankableEntryId) ?? null };
    return {
      ...row,
      rowFingerprint: fingerprints.poolRowFingerprint({
        category: row.category,
        snapshotEntryId: row.snapshotEntryId,
        rankableEntryId: row.rankableEntryId,
        position,
        identityProvider: row.identityProvider,
        identityExternalId: row.identityExternalId,
        sngParticipantId: row.sngParticipantId,
        participationState: row.participationState,
        participantDisposition: row.participantDisposition,
        canonicalClass: row.canonicalClass,
        canonicalPointsHundredths: row.canonicalPointsHundredths,
        canonicalPositionRank: row.canonicalPositionRank,
        sngResultFingerprint: row.sngResultFingerprint,
        treatment: row.treatment,
        fpHundredths: row.fpHundredths,
        waiverPoolRank: row.waiverPoolRank,
        neutralizationPrecedence: row.neutralizationPrecedence,
        resolution: row.meta.resolution,
        invalidationBasis: row.invalidationBasis,
      }),
    };
  });

  const eligiblePoolSize = eligible.length;
  const invalidatedCalledCount = rows.filter((r) => r.category === "INVALIDATED_CALLED_PLAYER").length;
  const effectivePoolSize = rows.filter((r) => r.treatment === "RANKED").length;
  const effectiveFieldSize = Math.min(contest.resultFieldSize, effectivePoolSize);
  const effectiveAvailableSlots = Math.min(contest.maxCalls, eligiblePoolSize);
  const neutralizedEligibleMembers = rows.filter((r) => r.category === "ELIGIBLE_POOL_MEMBER" && r.treatment === "NEUTRALIZED").length;
  const appliedResolutions = [...input.resolutions]
    .sort((a, b) => byCodeUnit(a.conflictKey, b.conflictKey))
    .map(({ id, conflictKey, sequence, conflictKind, resolution }) => ({ id, conflictKey, sequence, conflictKind, resolution }));

  const artifactFingerprint = fingerprints.artifactIdentityFingerprint({
    seriesKey: artifact.seriesKey,
    revision: artifact.revision,
    artifactId: artifact.artifactId,
    contentChecksum: artifact.contentChecksum,
  });
  const snapshotFingerprint = fingerprints.snapshotIdentityFingerprint({
    season: snapshot.season,
    weekNumber: snapshot.weekNumber,
    version: snapshot.version,
    entriesFingerprint: snapshot.entriesFingerprint,
  });
  const sourceFingerprint = fingerprints.contestSourceFingerprint({
    artifactFingerprint,
    position,
    sngResultSetChecksum: contestSet.resultSetChecksum,
    participants: rows.map((r) => ({
      participantId: r.sngParticipantId,
      participationState: r.participationState,
      participantDisposition: r.participantDisposition,
      pointsHundredths: r.canonicalPointsHundredths,
      competitionRank: r.canonicalPositionRank,
      resultFingerprint: r.sngResultFingerprint,
    })),
  });
  const resolutionSetFingerprint = fingerprints.resolutionSetFingerprint(appliedResolutions);

  return {
    status: "READY",
    result: {
      contestId: contest.id,
      weekId: contest.weekId,
      position,
      snapshotId: contest.snapshotId,
      artifactRowId: artifact.rowId,
      artifactContentChecksum: artifact.contentChecksum,
      resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION,
      sngResultSetChecksum: contestSet.resultSetChecksum,
      sourceFingerprint,
      snapshotFingerprint,
      resolutionSetFingerprint,
      inputFingerprint: fingerprints.contestResultInputFingerprint({
        resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION,
        position,
        artifactFingerprint,
        snapshotFingerprint,
        sourceFingerprint,
        resolutionSetFingerprint,
        calledRankableEntryIds: input.calledEntries.map((entry) => entry.rankableEntryId),
      }),
      resultFingerprint: fingerprints.contestResultFingerprint({
        position,
        resultFieldSize: contest.resultFieldSize,
        eligiblePoolSize,
        effectivePoolSize,
        effectiveFieldSize,
        effectiveAvailableSlots,
        invalidatedCalledCount,
        rows,
      }),
      resultFieldSize: contest.resultFieldSize,
      eligiblePoolSize,
      effectivePoolSize,
      effectiveFieldSize,
      effectiveAvailableSlots,
      invalidatedCalledCount,
    },
    rows,
    appliedResolutions,
    honorScoreableSlots: waiverHonorScoreableSlots({ effectiveAvailableSlots, eligiblePoolSize, neutralizedEligibleMembers }),
    issues: [],
    advisories,
  };
}
