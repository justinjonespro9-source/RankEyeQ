import { collectWaiverContestMembers, waiverMemberIdentity } from "@/lib/waivers/canonical/contest-members";
import { waiverHonorScoreableSlots } from "@/lib/waivers/canonical/policy";
import type { PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";
import type { WaiverPosition } from "@/lib/waivers/constants";
import type { WaiverContestResultBuild } from "@/lib/waivers/grading/contest-result";
import type { WaiverGradingAdvisory, WaiverGradingIssue, WaiverGradingIssueCode, WaiverGradingPoolRow } from "@/lib/waivers/grading/model";
import { rankWaiverPool } from "@/lib/waivers/ranking";
import { classifyRankEyeQParticipant, matchRankEyeQResultsIdentity, type VerifiedRankEyeQResultsSource } from "@/lib/waivers/rankeyeq-results/ledger";
import type { RankEyeQParticipant } from "@/lib/waivers/rankeyeq-results/types";
import * as fingerprints from "@/lib/waivers/results/fingerprints";
import { WAIVER_RESULTS_POLICY_VERSION } from "@/lib/waivers/results/model";

/**
 * One contest's result from the frozen pool and a verified RankEyeQ
 * final-week-stats source. It is the RankEyeQ twin of `buildWaiverContestResult`
 * and yields the same `WaiverContestResultBuild`, so boards, week assembly,
 * review and fingerprints are source-agnostic.
 *
 * Members are the same as the SNG path (`collectWaiverContestMembers`): every
 * eligible pool member and every player called on a locked board outside it.
 * Each is matched by exact frozen identity (`matchRankEyeQResultsIdentity`)
 * and classified by `classifyRankEyeQParticipant`:
 *
 *   PARTICIPATED_WITH_STATS / PARTICIPATED_ZERO → RANKED   (0 is a real score only after an operator PLAYED_ZERO)
 *   VERIFIED_NON_PARTICIPANT                    → NON_PARTICIPANT_ZERO (D1, DNP)
 *   not an eligible member                      → INVALIDATED_PRE_LOCK (C2)
 *
 * Differences from the SNG path, all deliberate:
 * - RankEyeQ has no separate result set or per-entry result record, so there
 *   are no RESULT_SET / RESULT_ENTRY checks. The `sng*` columns carry stable
 *   RankEyeQ equivalents (see `fingerprints.rankEyeQ*`): `sngParticipantId` is
 *   `rankeyeq:{rankableEntryId}`, `sngResultFingerprint` a hash of the
 *   participant's state and points, `sngResultSetChecksum` a per-position hash
 *   of the source participants.
 * - There is no BYE / cancelled / moved disposition, so no D2 neutralization or
 *   D3 snapshot conflict can arise and no resolutions are accepted.
 * - A called-outside-pool player the snapshot does not contain is a
 *   PARTICIPANT_NOT_IN_LEDGER blocker: `rankeyeq-results/build.ts` includes
 *   them, so a missing one means the snapshot predates a locked call.
 *
 * Pool ranks are the shared competition ranks over the post-treatment RANKED
 * rows. Pure; nothing is inferred and every missing or ambiguous input blocks.
 */

export type WaiverContestResultRankEyeQInput = {
  position: WaiverPosition;
  contest: { id: string; weekId: string; snapshotId: string; maxCalls: number; resultFieldSize: number };
  /** The contest's pinned snapshot, every entry (all positions and eligibilities). */
  snapshot: { season: number; weekNumber: number; version: number; entriesFingerprint: string; entries: readonly PreflightSnapshotEntry[] };
  /** The RankEyeQ snapshot's provenance as the grading artifact identity. */
  artifact: { rowId: string; artifactId: string; seriesKey: string; revision: number; contentChecksum: string };
  source: VerifiedRankEyeQResultsSource;
  /** The snapshot entry of every call on the contest's locked revisions. */
  calledEntries: readonly PreflightSnapshotEntry[];
};

/** The grading artifact identity of a RankEyeQ source (`artifactId` is content-addressed). */
export function rankEyeQGradingArtifact(source: VerifiedRankEyeQResultsSource) {
  return {
    rowId: source.provenance.snapshotRowId ?? "",
    artifactId: `rankeyeq-final-week-stats:${source.contentChecksum}`,
    seriesKey: source.seriesKey,
    revision: source.provenance.revision ?? 0,
    contentChecksum: source.contentChecksum,
  };
}

export const rankEyeQSngParticipantId = (rankableEntryId: string) => `rankeyeq:${rankableEntryId}`;

const resultFacts = (participant: RankEyeQParticipant) => ({
  rankableEntryId: participant.rankableEntryId,
  participationState: participant.participationState,
  participantDisposition: participant.disposition,
  pointsHundredths: participant.pointsHundredths,
});

export function buildWaiverContestResultFromRankEyeQ(input: WaiverContestResultRankEyeQInput): WaiverContestResultBuild {
  const { position, contest, snapshot, artifact, source } = input;
  const issues: WaiverGradingIssue[] = [];
  const advisories: WaiverGradingAdvisory[] = [];
  const issue = (code: WaiverGradingIssueCode, detail: string, snapshotEntryId?: string) =>
    issues.push({ code, detail, position, ...(snapshotEntryId ? { snapshotEntryId } : {}) });

  if (source.contentChecksum !== artifact.contentChecksum) {
    issue("ARTIFACT_CONTENT_INVALID", "verified RankEyeQ source content does not match the snapshot row checksum");
  }
  if (source.week.id !== contest.weekId) {
    issue("SOURCE_WEEK_MISMATCH", `the RankEyeQ source is for week ${source.week.id}, the contest is in week ${contest.weekId}`);
  }
  if (source.waiverSnapshot.id !== contest.snapshotId || source.waiverSnapshot.entriesFingerprint !== snapshot.entriesFingerprint) {
    issue(
      "SOURCE_SNAPSHOT_MISMATCH",
      `the RankEyeQ source was built from waiver snapshot ${source.waiverSnapshot.id}; the contest is pinned to ${contest.snapshotId}. Build and accept a new RankEyeQ snapshot`,
    );
  }

  // Members: the eligible pool, then players called on locked boards outside it.
  const { eligible, members, ambiguous } = collectWaiverContestMembers({ position, snapshotEntries: snapshot.entries, calledEntries: input.calledEntries });
  for (const a of ambiguous) {
    issue("CALLED_IDENTITY_AMBIGUOUS", `called player ${a.rankableEntryId} carries ${a.identityCount} different frozen identities`, a.snapshotEntryId);
  }
  if (members.some((m) => m.entry.frozenIdentity === null)) {
    advisories.push({ code: "IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT", detail: "some rows use the live identity key (frozen before Stage 4B.1)", position });
  }

  const evaluated = members.map((member) => {
    const identity = waiverMemberIdentity(member.entry);
    const frozen = member.entry.frozenIdentity;
    const rowIssues: Array<{ code: WaiverGradingIssueCode; detail: string }> = [];
    if (frozen && (frozen.provider !== member.entry.rankable.provider || frozen.externalId !== member.entry.rankable.externalId)) {
      rowIssues.push({
        code: "FROZEN_IDENTITY_MISMATCH",
        detail: `frozen ${frozen.provider}:${frozen.externalId}; live ${member.entry.rankable.provider}:${member.entry.rankable.externalId}`,
      });
    }
    const match = matchRankEyeQResultsIdentity(
      {
        rankableEntryId: member.entry.rankableEntryId,
        position: member.entry.position,
        provider: identity.provider,
        externalId: identity.externalId,
        // The frozen team (DEF identity is def-{TEAM} for the team at freeze), as the snapshot build uses.
        team: member.entry.teamAtFreeze ?? member.entry.rankable.team,
        name: member.entry.displayNameAtFreeze,
        weekId: source.week.id,
      },
      source.ledger,
    );
    rowIssues.push(...match.issues);
    return { member, participant: match.participant, rowIssues };
  });

  const byParticipant = new Map<string, number>();
  for (const { member, participant, rowIssues } of evaluated) {
    for (const found of rowIssues) issue(found.code, found.detail, member.entry.snapshotEntryId);
    if (!participant) continue;
    byParticipant.set(participant.rankableEntryId, (byParticipant.get(participant.rankableEntryId) ?? 0) + 1);
    if (participant.position !== position) {
      advisories.push({ code: "CANONICAL_POSITION_DIFFERS", detail: `${member.entry.displayNameAtFreeze}: RankEyeQ position ${participant.position}`, position });
    }
  }
  for (const [rankableEntryId, count] of byParticipant) {
    if (count > 1) issue("DUPLICATE_POOL_MATCH", `${count} contest rows match RankEyeQ participant ${rankableEntryId}`);
  }

  // The source-wide competition rank among this position's ranked participants (the analogue of the SNG overall rank).
  const sourceRanked = source.participants.filter(
    (p) => p.position === position && classifyRankEyeQParticipant(p).cls === "RANKED" && p.pointsHundredths !== null,
  );
  const sourceRanks = new Map(rankWaiverPool(sourceRanked, (p) => p.pointsHundredths!).map((r) => [r.item.rankableEntryId, r.waiverRank]));

  const drafts: Array<Omit<WaiverGradingPoolRow, "rowFingerprint">> = [];
  for (const { member, participant } of evaluated) {
    if (!participant) continue;
    const at = member.entry.snapshotEntryId;
    const label = member.entry.displayNameAtFreeze;
    const { cls, reason } = classifyRankEyeQParticipant(participant);
    if (cls === "BLOCKED") {
      issue("CANONICAL_RESULT_BLOCKED", `${label}: ${reason}`, at);
      continue;
    }
    if (cls !== "RANKED" && cls !== "NON_PARTICIPANT") {
      issue("CANONICAL_RESULT_BLOCKED", `${label}: unexpected class ${cls}`, at);
      continue;
    }
    const ranked = cls === "RANKED";
    if (ranked && participant.pointsHundredths === null) {
      issue("CANONICAL_RESULT_BLOCKED", `${label}: a ranked participant has no points`, at);
      continue;
    }
    const points = ranked ? participant.pointsHundredths : null;

    const treatment: WaiverGradingPoolRow["treatment"] =
      member.category === "ELIGIBLE_POOL_MEMBER" ? (ranked ? "RANKED" : "NON_PARTICIPANT_ZERO") : "INVALIDATED_PRE_LOCK";

    const identity = waiverMemberIdentity(member.entry);
    drafts.push({
      category: member.category,
      snapshotEntryId: member.snapshotEntryId,
      rankableEntryId: member.entry.rankableEntryId,
      position,
      identityProvider: identity.provider,
      identityExternalId: identity.externalId,
      sngParticipantId: rankEyeQSngParticipantId(participant.rankableEntryId),
      participationState: participant.participationState,
      participantDisposition: participant.disposition,
      canonicalClass: cls,
      canonicalPointsHundredths: points,
      canonicalPositionRank: ranked ? (sourceRanks.get(participant.rankableEntryId) ?? null) : null,
      sngResultFingerprint: ranked ? fingerprints.rankEyeQParticipantResultFingerprint(resultFacts(participant)) : null,
      treatment,
      fpHundredths: treatment === "RANKED" ? points : 0,
      waiverPoolRank: null,
      neutralizationPrecedence: null,
      conflictResolutionId: null,
      invalidationBasis: member.invalidationBasis,
      invalidatedBySnapshotId: member.category === "ELIGIBLE_POOL_MEMBER" ? null : contest.snapshotId,
      meta: { resolution: null, displayName: label, sngPosition: participant.position },
    });
  }
  if (issues.length > 0) return { status: "BLOCKED", issues, advisories };

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

  const resultSetChecksum = fingerprints.rankEyeQPositionResultSetChecksum({
    position,
    participants: source.participants.filter((p) => p.position === position).map(resultFacts),
  });
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
    sngResultSetChecksum: resultSetChecksum,
    participants: rows.map((r) => ({
      participantId: r.sngParticipantId,
      participationState: r.participationState,
      participantDisposition: r.participantDisposition,
      pointsHundredths: r.canonicalPointsHundredths,
      competitionRank: r.canonicalPositionRank,
      resultFingerprint: r.sngResultFingerprint,
    })),
  });
  const resolutionSetFingerprint = fingerprints.resolutionSetFingerprint([]);

  return {
    status: "READY",
    result: {
      contestId: contest.id,
      weekId: contest.weekId,
      position,
      snapshotId: contest.snapshotId,
      // The RankEyeQ snapshot row is the source; it is never stored as an SNG artifact id.
      artifactRowId: null,
      rankEyeQSnapshotId: artifact.rowId,
      artifactContentChecksum: artifact.contentChecksum,
      resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION,
      sngResultSetChecksum: resultSetChecksum,
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
    appliedResolutions: [],
    honorScoreableSlots: waiverHonorScoreableSlots({ effectiveAvailableSlots, eligiblePoolSize, neutralizedEligibleMembers: 0 }),
    issues: [],
    advisories,
  };
}
