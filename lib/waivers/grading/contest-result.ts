import type { VerifiedSngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { indexCanonicalLedger } from "@/lib/waivers/canonical/identity";
import { detectSnapshotCanonicalConflicts, waiverHonorScoreableSlots, type SnapshotCanonicalConflict } from "@/lib/waivers/canonical/policy";
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

type Member = {
  category: "ELIGIBLE_POOL_MEMBER" | "INVALIDATED_CALLED_PLAYER";
  /** The entry whose frozen identity and freeze facts the row uses. */
  entry: PreflightSnapshotEntry;
  /** The stored snapshotEntryId: the eligible entry, or the pinned entry of an invalidated player (null when absent). */
  snapshotEntryId: string | null;
  invalidationBasis: "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" | "ABSENT_FROM_PINNED_SNAPSHOT" | null;
  /** The distinct frozen entries the locked boards originally called (invalidated players only). */
  called: readonly PreflightSnapshotEntry[];
};

const isEligibleAt = (position: string) => (entry: PreflightSnapshotEntry) =>
  entry.position === position && entry.evidenceRole === "CANDIDATE" && entry.eligibility === "ELIGIBLE";
const identityOf = (entry: PreflightSnapshotEntry) => entry.frozenIdentity ?? { provider: entry.rankable.provider, externalId: entry.rankable.externalId };
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
  const eligible = snapshot.entries.filter(isEligibleAt(position)).sort((a, b) => byCodeUnit(a.snapshotEntryId, b.snapshotEntryId));
  const eligiblePlayers = new Set(eligible.map((entry) => entry.rankableEntryId));
  const pinnedByPlayer = new Map(snapshot.entries.map((entry) => [entry.rankableEntryId, entry]));
  const calledOutside = new Map<string, PreflightSnapshotEntry[]>();
  for (const entry of input.calledEntries) {
    if (eligiblePlayers.has(entry.rankableEntryId)) continue;
    const list = calledOutside.get(entry.rankableEntryId) ?? [];
    if (!list.some((e) => e.snapshotEntryId === entry.snapshotEntryId)) list.push(entry);
    calledOutside.set(entry.rankableEntryId, list);
  }
  const members: Member[] = eligible.map((entry) => ({ category: "ELIGIBLE_POOL_MEMBER", entry, snapshotEntryId: entry.snapshotEntryId, invalidationBasis: null, called: [] }));
  for (const [player, called] of [...calledOutside].sort(([a], [b]) => byCodeUnit(a, b))) {
    const pinned = pinnedByPlayer.get(player) ?? null;
    if (!pinned) {
      const identities = new Set(called.map((entry) => `${identityOf(entry).provider}\u0000${identityOf(entry).externalId}`));
      if (identities.size > 1) {
        issue("CALLED_IDENTITY_AMBIGUOUS", `called player ${player} carries ${identities.size} different frozen identities`, called[0].snapshotEntryId);
        continue;
      }
    }
    const entry = pinned ?? [...called].sort((a, b) => byCodeUnit(a.snapshotEntryId, b.snapshotEntryId))[0];
    members.push({
      category: "INVALIDATED_CALLED_PLAYER",
      entry,
      snapshotEntryId: pinned?.snapshotEntryId ?? null,
      invalidationBasis: pinned ? "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" : "ABSENT_FROM_PINNED_SNAPSHOT",
      called: [...called].sort((a, b) => byCodeUnit(a.snapshotEntryId, b.snapshotEntryId)),
    });
  }

  /**
   * D3 conflicts of a row. An invalidated player whose corrected pinned entry is
   * frozen on bye shows no conflict there, so a canonical BYE is looked up on the
   * scheduled entries the locked boards originally called; more than one such
   * entry is ambiguous and blocks. Every other row keeps its own entry's conflicts.
   */
  const conflictsOf = (member: Member, row: PreflightRow): SnapshotCanonicalConflict[] | "AMBIGUOUS" => {
    const canonical = row.canonical!;
    if (member.invalidationBasis !== "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" || canonical.cls !== "SNAPSHOT_CONFLICT" || row.conflicts.length > 0 || !member.entry.isByeAtFreeze) {
      return row.conflicts;
    }
    const original = member.called.flatMap((entry) =>
      detectSnapshotCanonicalConflicts({
        artifactContentChecksum: verified.summary.contentChecksum,
        snapshotEntryId: entry.snapshotEntryId,
        snapshot: { isByeAtFreeze: entry.isByeAtFreeze, teamAtFreeze: entry.teamAtFreeze },
        canonical: { participantId: canonical.participantId, cls: canonical.cls, disposition: canonical.disposition, teamKey: canonical.teamKey },
      }).filter((conflict) => conflict.kind === "BYE_VS_SCHEDULED"),
    );
    return original.length > 1 ? "AMBIGUOUS" : original;
  };

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

    const conflicts = conflictsOf(member, row);
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
    const identity = identityOf(member.entry);
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
