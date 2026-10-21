import type { Prisma } from "@/lib/generated/prisma/client";
import { WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";
import type { WaiverGradingBoardGrade, WaiverGradingContestResult, WaiverGradingPoolRow } from "@/lib/waivers/grading/model";
import type { WaiverEmptyPositionPreview, WaiverGradeRunPreview } from "@/lib/waivers/grading/week";

/**
 * Pure mappings from engine output to the Stage 4B.3 storage create inputs.
 * Ids and versions are supplied by the caller; nothing here writes. Storing,
 * approving and applying a grade run belong to a later, separately authorized
 * stage.
 */

function omitKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

export function waiverContestResultCreateData(
  result: WaiverGradingContestResult,
  resultVersion: number,
): Prisma.WaiverContestResultUncheckedCreateInput {
  const artifactRowId = result.artifactRowId ?? null;
  const rankEyeQSnapshotId = result.rankEyeQSnapshotId ?? null;
  if ((artifactRowId === null) === (rankEyeQSnapshotId === null)) {
    throw new RangeError("a contest result needs exactly one source: an SNG artifact row or a RankEyeQ snapshot row");
  }
  return { ...result, artifactRowId, rankEyeQSnapshotId, resultVersion };
}

export const waiverPoolResultCreateData = (rows: readonly WaiverGradingPoolRow[], contestResultId: string): Prisma.WaiverPoolResultCreateManyInput[] =>
  rows.map((row) => ({ ...omitKeys(row, ["meta"]), contestResultId }));

export const waiverEmptyPositionResultCreateData = (empty: WaiverEmptyPositionPreview): Prisma.WaiverEmptyPositionResultUncheckedCreateInput => ({ ...empty });

export function waiverGradeRunCreateData(
  run: WaiverGradeRunPreview,
  ids: {
    weekId: string;
    runNumber: number;
    /** Exactly one verified source: the SNG artifact row XOR the RankEyeQ snapshot row (the database enforces it too). */
    artifactRowId?: string | null;
    rankEyeQSnapshotId?: string | null;
    /** The source content checksum (SNG artifact or RankEyeQ snapshot). */
    artifactContentChecksum: string;
    contestResultIds: Partial<Record<WaiverPosition, string>>;
    emptyPositionResultIds: Partial<Record<WaiverPosition, string>>;
    initiatedByUserId: string | null;
  },
): Prisma.WaiverGradeRunUncheckedCreateInput {
  const artifactRowId = ids.artifactRowId ?? null;
  const rankEyeQSnapshotId = ids.rankEyeQSnapshotId ?? null;
  if ((artifactRowId === null) === (rankEyeQSnapshotId === null)) {
    throw new RangeError("a grade run needs exactly one source: an SNG artifact row or a RankEyeQ snapshot row");
  }
  const contest = (p: WaiverPosition) => ids.contestResultIds[p] ?? null;
  const empty = (p: WaiverPosition) => ids.emptyPositionResultIds[p] ?? null;
  for (const position of WAIVER_POSITIONS) {
    if ((contest(position) === null) === (empty(position) === null)) {
      throw new RangeError(`${position} needs exactly one contest result or empty-position result`);
    }
  }
  return {
    weekId: ids.weekId,
    runNumber: ids.runNumber,
    artifactRowId,
    rankEyeQSnapshotId,
    artifactContentChecksum: ids.artifactContentChecksum,
    qbContestResultId: contest("QB"),
    rbContestResultId: contest("RB"),
    wrContestResultId: contest("WR"),
    teContestResultId: contest("TE"),
    defContestResultId: contest("DEF"),
    qbEmptyPositionResultId: empty("QB"),
    rbEmptyPositionResultId: empty("RB"),
    wrEmptyPositionResultId: empty("WR"),
    teEmptyPositionResultId: empty("TE"),
    defEmptyPositionResultId: empty("DEF"),
    snapshotSetFingerprint: run.snapshotSetFingerprint,
    resolutionSetFingerprint: run.resolutionSetFingerprint,
    gradingRulesetVersion: run.gradingRulesetVersion,
    scoringVersion: run.scoringVersion,
    inputFingerprint: run.inputFingerprint,
    outputFingerprint: run.outputFingerprint,
    boardGradeCount: run.boardGradeCount,
    initiator: ids.initiatedByUserId ? "OPERATOR" : "SYSTEM",
    initiatedByUserId: ids.initiatedByUserId,
  };
}

export const waiverBoardGradeCreateData = (
  grade: WaiverGradingBoardGrade,
  ids: { gradeRunId: string; contestResultId: string },
): Prisma.WaiverBoardGradeUncheckedCreateInput => ({ ...grade.board, ...ids });

export function waiverCallGradeCreateData(
  grade: WaiverGradingBoardGrade,
  ids: { boardGradeId: string; poolResultIdByEntry: ReadonlyMap<string, string> },
): Prisma.WaiverCallGradeCreateManyInput[] {
  return grade.calls.map((call) => {
    const poolResultId = ids.poolResultIdByEntry.get(call.rankableEntryId);
    if (!poolResultId) throw new RangeError(`no stored pool row for ${call.rankableEntryId}`);
    return { ...omitKeys(call, ["poolRowFingerprint", "outcome"]), boardGradeId: ids.boardGradeId, poolResultId };
  });
}
