import type { WaiverPosition } from "@/lib/waivers/constants";
import type { WaiverWeekGradingPreview } from "@/lib/waivers/grading/week";

/**
 * Pure, JSON-serializable operator review of a week grading preview: top
 * finishes, zero-point review, D3 decisions and board scores. It only reshapes
 * engine output; it never scores, stores or approves anything.
 */

export const WAIVER_REVIEW_TOP_FINISHES = 5;
export const WAIVER_REVIEW_TOP_BOARDS = 10;

export type WaiverReviewTopFinish = { poolRank: number; name: string; fpHundredths: number | null; canonicalRank: number | null; calledBy: number };

export type WaiverReviewZeroPointRow = {
  position: WaiverPosition;
  name: string;
  treatment: "RANKED" | "NON_PARTICIPANT_ZERO" | "NEUTRALIZED" | "INVALIDATED_PRE_LOCK";
  /** Why the player earned no points. */
  reason: string;
  state: string;
  disposition: string;
  /** Locked boards that called this player. */
  calledBy: number;
};

export type WaiverReviewPosition = {
  position: WaiverPosition;
  kind: "CONTEST_RESULT" | "EMPTY_ELIGIBLE_POOL" | "BLOCKED";
  eligiblePoolSize: number;
  effectiveFieldSize: number | null;
  pool: { ranked: number; nonParticipantZero: number; neutralized: number; invalidated: number } | null;
  topFinishes: WaiverReviewTopFinish[];
  boards: number;
};

export type WaiverReviewBoard = {
  position: WaiverPosition;
  profileId: string;
  profileName: string;
  profileType: string;
  resultKind: string;
  eyeqHundredths: number | null;
  totalFpHundredths: number;
  calls: number;
  exactCalls: number;
  honor: string | null;
};

export type WaiverGradingReview = {
  status: "READY" | "BLOCKED";
  week: { id: string; season: number; weekNumber: number };
  artifact: { rowId: string; artifactId: string; revision: number; contentChecksum: string };
  run: { inputFingerprint: string; outputFingerprint: string; boardGradeCount: number; snapshotSetFingerprint: string; resolutionSetFingerprint: string } | null;
  issues: Array<{ code: string; detail: string; position: WaiverPosition | null }>;
  advisories: Array<{ code: string; detail: string; position: WaiverPosition | null }>;
  positions: WaiverReviewPosition[];
  zeroPoint: { count: number; rows: WaiverReviewZeroPointRow[] };
  d3: {
    applied: Array<{ position: WaiverPosition; conflictKey: string; sequence: number; kind: string; resolution: string }>;
    unresolved: Array<{ code: string; detail: string; position: WaiverPosition | null }>;
  };
  boards: { total: number; scored: number; zeroCall: number; allNeutralized: number; noEffectiveSlots: number; top: WaiverReviewBoard[] };
};

const D3_ISSUE_CODES = new Set(["UNRESOLVED_SNAPSHOT_CONFLICT", "CONFLICT_RESOLUTION_NOT_APPLICABLE", "UNAPPLIED_CONFLICT_RESOLUTION"]);

function zeroReason(treatment: WaiverReviewZeroPointRow["treatment"], state: string, disposition: string): string {
  switch (treatment) {
    case "RANKED":
      return "Played and scored 0.00 fantasy points (ranked)";
    case "NON_PARTICIPANT_ZERO":
      return `Did not participate (${disposition}); scored as 0.00`;
    case "NEUTRALIZED":
      return `Neutralized (${disposition}); earns no points and does not count against boards`;
    case "INVALIDATED_PRE_LOCK":
      return `Invalidated before lock (${state}); scored as a miss`;
  }
}

export function buildWaiverGradingReview(preview: WaiverWeekGradingPreview, profileNames: ReadonlyMap<string, string> = new Map()): WaiverGradingReview {
  const calledBy = new Map<string, number>();
  for (const grade of preview.boards) {
    for (const call of grade.calls) calledBy.set(call.rankableEntryId, (calledBy.get(call.rankableEntryId) ?? 0) + 1);
  }
  const boardCount = (position: WaiverPosition) => preview.boards.filter((b) => b.board.position === position).length;

  const zeroRows: WaiverReviewZeroPointRow[] = [];
  const positions: WaiverReviewPosition[] = preview.positions.map((p) => {
    if (p.kind === "BLOCKED") {
      return { position: p.position, kind: "BLOCKED", eligiblePoolSize: 0, effectiveFieldSize: null, pool: null, topFinishes: [], boards: boardCount(p.position) };
    }
    if (p.kind === "EMPTY_ELIGIBLE_POOL") {
      return { position: p.position, kind: "EMPTY_ELIGIBLE_POOL", eligiblePoolSize: 0, effectiveFieldSize: 0, pool: null, topFinishes: [], boards: 0 };
    }
    for (const row of p.rows) {
      const zero = row.treatment === "NON_PARTICIPANT_ZERO" || row.treatment === "NEUTRALIZED" || row.treatment === "INVALIDATED_PRE_LOCK" || (row.treatment === "RANKED" && row.fpHundredths === 0);
      if (!zero) continue;
      zeroRows.push({
        position: p.position,
        name: row.meta.displayName,
        treatment: row.treatment,
        reason: zeroReason(row.treatment, row.participationState, row.participantDisposition),
        state: row.participationState,
        disposition: row.participantDisposition,
        calledBy: calledBy.get(row.rankableEntryId) ?? 0,
      });
    }
    const topFinishes = p.rows
      .filter((row) => row.treatment === "RANKED" && row.waiverPoolRank !== null)
      .sort((a, b) => a.waiverPoolRank! - b.waiverPoolRank! || (a.rankableEntryId < b.rankableEntryId ? -1 : 1))
      .slice(0, WAIVER_REVIEW_TOP_FINISHES)
      .map((row) => ({
        poolRank: row.waiverPoolRank!,
        name: row.meta.displayName,
        fpHundredths: row.fpHundredths,
        canonicalRank: row.canonicalPositionRank,
        calledBy: calledBy.get(row.rankableEntryId) ?? 0,
      }));
    return {
      position: p.position,
      kind: "CONTEST_RESULT",
      eligiblePoolSize: p.result.eligiblePoolSize,
      effectiveFieldSize: p.result.effectiveFieldSize,
      pool: p.pool,
      topFinishes,
      boards: boardCount(p.position),
    };
  });

  const d3Issues = preview.issues.filter((issue) => D3_ISSUE_CODES.has(issue.code));
  const boardKind = (kind: string) => preview.boards.filter((b) => b.board.resultKind === kind).length;
  const topBoards = [...preview.boards]
    .sort(
      (a, b) =>
        (b.board.eyeqHundredths ?? -1) - (a.board.eyeqHundredths ?? -1) ||
        b.board.totalFpHundredths - a.board.totalFpHundredths ||
        (a.board.submissionId < b.board.submissionId ? -1 : 1),
    )
    .slice(0, WAIVER_REVIEW_TOP_BOARDS)
    .map((b) => ({
      position: b.board.position,
      profileId: b.competitor.universalProfileId,
      profileName: profileNames.get(b.competitor.universalProfileId) ?? b.competitor.universalProfileId,
      profileType: b.competitor.profileType,
      resultKind: b.board.resultKind,
      eyeqHundredths: b.board.eyeqHundredths,
      totalFpHundredths: b.board.totalFpHundredths,
      calls: b.board.submittedCallCount,
      exactCalls: b.board.exactCallCount,
      honor: b.board.awardedHonor ?? null,
    }));

  return {
    status: preview.status,
    week: preview.week,
    artifact: { rowId: preview.artifact.rowId, artifactId: preview.artifact.artifactId, revision: preview.artifact.revision, contentChecksum: preview.artifact.contentChecksum },
    run: preview.run
      ? {
          inputFingerprint: preview.run.inputFingerprint,
          outputFingerprint: preview.run.outputFingerprint,
          boardGradeCount: preview.run.boardGradeCount,
          snapshotSetFingerprint: preview.run.snapshotSetFingerprint,
          resolutionSetFingerprint: preview.run.resolutionSetFingerprint,
        }
      : null,
    issues: preview.issues.map((i) => ({ code: i.code, detail: i.detail, position: i.position ?? null })),
    advisories: preview.advisories.map((a) => ({ code: a.code, detail: a.detail, position: a.position ?? null })),
    positions,
    zeroPoint: { count: zeroRows.length, rows: zeroRows },
    d3: {
      applied: preview.positions.flatMap((p) =>
        p.kind === "CONTEST_RESULT"
          ? p.appliedResolutions.map((r) => ({ position: p.position, conflictKey: r.conflictKey, sequence: r.sequence, kind: r.conflictKind, resolution: r.resolution }))
          : [],
      ),
      unresolved: d3Issues.map((i) => ({ code: i.code, detail: i.detail, position: i.position ?? null })),
    },
    boards: {
      total: preview.boards.length,
      scored: boardKind("SCORED"),
      zeroCall: boardKind("NA_ZERO_CALL"),
      allNeutralized: boardKind("NA_ALL_NEUTRALIZED"),
      noEffectiveSlots: boardKind("NA_NO_EFFECTIVE_SLOTS"),
      top: topBoards,
    },
  };
}
