import { WAIVER_EYEQ_V1, WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";
import { gradeWaiverBoard, type WaiverGradingBoardInput } from "@/lib/waivers/grading/board-grade";
import type { WaiverContestResultBuild } from "@/lib/waivers/grading/contest-result";
import type {
  WaiverGradingAdvisory,
  WaiverGradingAppliedResolution,
  WaiverGradingBoardGrade,
  WaiverGradingContestResult,
  WaiverGradingIssue,
  WaiverGradingPoolRow,
} from "@/lib/waivers/grading/model";
import * as fingerprints from "@/lib/waivers/results/fingerprints";
import { WAIVER_GRADING_RULESET_VERSION, WAIVER_RESULTS_POLICY_VERSION } from "@/lib/waivers/results/model";

/**
 * Week-wide dry run: all five positions (a contest result or an explicit
 * empty position), every locked board graded, the deterministic grade-run
 * fingerprints an approval would bind, and every blocker. READY only when
 * nothing blocks; the preview is never stored, approved or applied here.
 */

export type WaiverWeekPositionInput =
  | { position: WaiverPosition; kind: "CONTEST"; contestId: string; build: WaiverContestResultBuild; boards: readonly WaiverGradingBoardInput[] }
  | { position: WaiverPosition; kind: "EMPTY"; snapshotId: string; snapshotFingerprint: string }
  | { position: WaiverPosition; kind: "BLOCKED" };

export type WaiverWeekGradingInput = {
  week: { id: string; season: number; weekNumber: number };
  artifact: { rowId: string; artifactId: string; seriesKey: string; revision: number; contentChecksum: string };
  positions: readonly WaiverWeekPositionInput[];
  issues: readonly WaiverGradingIssue[];
  advisories: readonly WaiverGradingAdvisory[];
};

export type WaiverEmptyPositionPreview = {
  weekId: string;
  position: WaiverPosition;
  snapshotId: string;
  snapshotFingerprint: string;
  eligiblePoolSize: 0;
  resultsPolicyVersion: string;
  resultFingerprint: string;
};

export type WaiverPositionPreview =
  | {
      position: WaiverPosition;
      kind: "CONTEST_RESULT";
      contestId: string;
      result: WaiverGradingContestResult;
      rows: WaiverGradingPoolRow[];
      appliedResolutions: WaiverGradingAppliedResolution[];
      honorScoreableSlots: number;
      pool: { ranked: number; nonParticipantZero: number; neutralized: number; invalidated: number };
    }
  | { position: WaiverPosition; kind: "EMPTY_ELIGIBLE_POOL"; emptyResult: WaiverEmptyPositionPreview }
  | { position: WaiverPosition; kind: "BLOCKED"; contestId: string | null };

export type WaiverGradeRunPreview = {
  snapshotSetFingerprint: string;
  resolutionSetFingerprint: string;
  gradingRulesetVersion: string;
  scoringVersion: string;
  inputFingerprint: string;
  outputFingerprint: string;
  boardGradeCount: number;
};

export type WaiverWeekGradingPreview = {
  status: "READY" | "BLOCKED";
  week: WaiverWeekGradingInput["week"];
  artifact: WaiverWeekGradingInput["artifact"];
  positions: WaiverPositionPreview[];
  boards: WaiverGradingBoardGrade[];
  run: WaiverGradeRunPreview | null;
  issues: WaiverGradingIssue[];
  advisories: WaiverGradingAdvisory[];
  summary: {
    boards: number;
    byResultKind: Record<string, number>;
    byHonor: Record<string, number>;
    byProfileType: Record<string, number>;
    byEntryBasis: Record<string, number>;
  };
};

const tally = <T>(items: readonly T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] ?? 0) + 1 }), {});

export function assembleWaiverWeekGrading(input: WaiverWeekGradingInput): WaiverWeekGradingPreview {
  const issues: WaiverGradingIssue[] = [...input.issues];
  const advisories: WaiverGradingAdvisory[] = [...input.advisories];
  const positions: WaiverPositionPreview[] = [];
  const boards: WaiverGradingBoardGrade[] = [];

  const byPosition = new Map(input.positions.map((p) => [p.position, p]));
  if (byPosition.size !== input.positions.length || WAIVER_POSITIONS.some((p) => !byPosition.has(p))) {
    throw new RangeError("week grading needs exactly one entry for each of the five Waiver positions");
  }

  for (const position of WAIVER_POSITIONS) {
    const entry = byPosition.get(position)!;
    if (entry.kind === "BLOCKED") {
      positions.push({ position, kind: "BLOCKED", contestId: null });
      continue;
    }
    if (entry.kind === "EMPTY") {
      positions.push({
        position,
        kind: "EMPTY_ELIGIBLE_POOL",
        emptyResult: {
          weekId: input.week.id,
          position,
          snapshotId: entry.snapshotId,
          snapshotFingerprint: entry.snapshotFingerprint,
          eligiblePoolSize: 0,
          resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION,
          resultFingerprint: fingerprints.emptyPositionResultFingerprint({
            resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION,
            position,
            snapshotFingerprint: entry.snapshotFingerprint,
          }),
        },
      });
      continue;
    }
    advisories.push(...entry.build.advisories);
    if (entry.build.status === "BLOCKED") {
      issues.push(...entry.build.issues);
      positions.push({ position, kind: "BLOCKED", contestId: entry.contestId });
      continue;
    }
    const { result, rows, appliedResolutions, honorScoreableSlots } = entry.build;
    positions.push({
      position,
      kind: "CONTEST_RESULT",
      contestId: entry.contestId,
      result,
      rows,
      appliedResolutions,
      honorScoreableSlots,
      pool: {
        ranked: rows.filter((r) => r.treatment === "RANKED").length,
        nonParticipantZero: rows.filter((r) => r.treatment === "NON_PARTICIPANT_ZERO").length,
        neutralized: rows.filter((r) => r.treatment === "NEUTRALIZED").length,
        invalidated: rows.filter((r) => r.category === "INVALIDATED_CALLED_PLAYER").length,
      },
    });
    const contestRef = {
      position,
      contestId: entry.contestId,
      resultFieldSize: result.resultFieldSize,
      effectiveAvailableSlots: result.effectiveAvailableSlots,
      resultFingerprint: result.resultFingerprint,
      honorScoreableSlots,
      rows,
    };
    for (const board of entry.boards) {
      if (board.competitor.profileType !== "HUMAN" && !board.competitor.competitorActive) {
        advisories.push({
          code: "INACTIVE_COMPETITOR_LOCKED_BOARD",
          detail: `locked ${position} board ${board.submissionId} belongs to inactive ${board.competitor.profileType} profile ${board.competitor.universalProfileId}`,
          position,
        });
      }
      const graded = gradeWaiverBoard(contestRef, board);
      if (graded.status === "BLOCKED") issues.push(...graded.issues);
      else boards.push(graded.grade);
    }
  }

  const ready = issues.length === 0 && positions.every((p) => p.kind !== "BLOCKED") && positions.some((p) => p.kind === "CONTEST_RESULT");
  let run: WaiverGradeRunPreview | null = null;
  if (ready) {
    const contests = positions.filter((p): p is Extract<WaiverPositionPreview, { kind: "CONTEST_RESULT" }> => p.kind === "CONTEST_RESULT");
    const empties = positions.filter((p): p is Extract<WaiverPositionPreview, { kind: "EMPTY_ELIGIBLE_POOL" }> => p.kind === "EMPTY_ELIGIBLE_POOL");
    const snapshotSetFingerprint = fingerprints.snapshotSetFingerprint([
      ...contests.map((p) => ({ position: p.position, snapshotFingerprint: p.result.snapshotFingerprint })),
      ...empties.map((p) => ({ position: p.position, snapshotFingerprint: p.emptyResult.snapshotFingerprint })),
    ]);
    const resolutionSetFingerprint = fingerprints.resolutionSetFingerprint(contests.flatMap((p) => p.appliedResolutions));
    const positioned: fingerprints.PositionedResult[] = [
      ...contests.map((p) => ({ position: p.position, kind: "CONTEST_RESULT" as const, inputFingerprint: p.result.inputFingerprint, resultFingerprint: p.result.resultFingerprint })),
      ...empties.map((p) => ({ position: p.position, kind: "EMPTY_ELIGIBLE_POOL" as const, inputFingerprint: null, resultFingerprint: p.emptyResult.resultFingerprint })),
    ];
    const boardFps = boards.map((b) => ({ submissionId: b.board.submissionId, inputFingerprint: b.board.inputFingerprint, outputFingerprint: b.board.outputFingerprint }));
    const inputFingerprint = fingerprints.gradeRunInputFingerprint({
      gradingRulesetVersion: WAIVER_GRADING_RULESET_VERSION,
      scoringVersion: WAIVER_EYEQ_V1.slug,
      season: input.week.season,
      weekNumber: input.week.weekNumber,
      artifactFingerprint: fingerprints.artifactIdentityFingerprint({
        seriesKey: input.artifact.seriesKey,
        revision: input.artifact.revision,
        artifactId: input.artifact.artifactId,
        contentChecksum: input.artifact.contentChecksum,
      }),
      snapshotSetFingerprint,
      resolutionSetFingerprint,
      contestResults: positioned,
      boards: boardFps,
    });
    run = {
      snapshotSetFingerprint,
      resolutionSetFingerprint,
      gradingRulesetVersion: WAIVER_GRADING_RULESET_VERSION,
      scoringVersion: WAIVER_EYEQ_V1.slug,
      inputFingerprint,
      outputFingerprint: fingerprints.weekGradeOutputFingerprint({ gradeRunInputFingerprint: inputFingerprint, contestResults: positioned, boards: boardFps }),
      boardGradeCount: boards.length,
    };
  }

  const sortedBoards = [...boards].sort(
    (a, b) => WAIVER_POSITIONS.indexOf(a.board.position) - WAIVER_POSITIONS.indexOf(b.board.position) || (a.board.submissionId < b.board.submissionId ? -1 : a.board.submissionId > b.board.submissionId ? 1 : 0),
  );
  return {
    status: run ? "READY" : "BLOCKED",
    week: input.week,
    artifact: input.artifact,
    positions,
    boards: sortedBoards,
    run,
    issues,
    advisories,
    summary: {
      boards: sortedBoards.length,
      byResultKind: tally(sortedBoards, (b) => b.board.resultKind),
      byHonor: tally(sortedBoards, (b) => b.board.awardedHonor ?? "NONE"),
      byProfileType: tally(sortedBoards, (b) => b.competitor.profileType),
      byEntryBasis: tally(sortedBoards, (b) => b.competitor.entryBasis),
    },
  };
}
