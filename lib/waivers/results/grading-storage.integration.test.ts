import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { WaiverPosition } from "@/lib/waivers/constants";
import { expectDbGuard } from "@/lib/waivers/__fixtures__/competition";
import { createResultsFixture, expectRejected, type ArtifactRef, type BuiltGradeRun, type ResultsFixture } from "@/lib/waivers/__fixtures__/results";

/** Grade runs, board grades and call grades (Stage 4B.3 tests 8-14 and 23). Synthetic local fixtures only. */

let f: ResultsFixture;
let r1: ArtifactRef;
let resultIds: Record<WaiverPosition, string>;

beforeEach(async () => {
  f = await createResultsFixture("grd");
  r1 = await f.importArtifact(1);
  resultIds = await f.writeAllResults(r1);
});

afterEach(async () => {
  await f.cleanup();
});

const boardFor = (built: BuiltGradeRun, position: WaiverPosition, profileId: string) =>
  built.boards.find((b) => b.board.position === position && b.board.submissionId === submissionIds.get(`${position}:${profileId}`))!;
const submissionIds = new Map<string, string>();

async function loadSubmissionIds() {
  submissionIds.clear();
  for (const s of await prisma.waiverSubmission.findMany({ where: { contestId: { in: Object.values(f.contests) } }, include: { contest: true } })) {
    submissionIds.set(`${s.contest.position}:${s.universalProfileId}`, s.id);
  }
}

const withBoard = (built: BuiltGradeRun, submissionId: string, patch: (b: BuiltGradeRun["boards"][number]) => BuiltGradeRun["boards"][number]): BuiltGradeRun => ({
  ...built,
  boards: built.boards.map((b) => (b.board.submissionId === submissionId ? patch(b) : b)),
});

describe("grade runs and board grades", () => {
  beforeEach(loadSubmissionIds);

  it("stores one board grade per locked submitted board (drafts get none) with the Stage 4A outcomes", async () => {
    const built = await f.buildGradeRun(resultIds);
    expect(built.run.boardGradeCount).toBe(6);
    const run = await f.writeGradeRun(built);
    const boards = await prisma.waiverBoardGrade.findMany({ where: { gradeRunId: run.id }, include: { callGrades: { orderBy: { slot: "asc" } } } });
    const by = (position: WaiverPosition, who = f.alpha) => boards.find((b) => b.submissionId === submissionIds.get(`${position}:${who.profileId}`))!;

    expect(boards.some((b) => b.submissionId === submissionIds.get(`RB:${f.bravo.profileId}`))).toBe(false);
    expect(by("RB")).toMatchObject({ resultKind: "SCORED", awardedHonor: "PERFECT_PODIUM", exactCallCount: 3, eyeqHundredths: 10000 });
    expect(by("WR")).toMatchObject({ resultKind: "SCORED", awardedHonor: "PERFECT_FIVE", exactCallCount: 5 });
    expect(by("DEF")).toMatchObject({ resultKind: "SCORED", awardedHonor: null, submittedCallCount: 2, exactCallCount: 1 });
    const qb = by("QB");
    expect(qb).toMatchObject({ resultKind: "SCORED", submittedCallCount: 3, scoreableCallCount: 3, neutralizedCallCount: 0, totalFpHundredths: 5000, fpPerCallHundredths: 1667 });
    expect(qb.callGrades.map((c) => [c.treatment, c.exact, c.earnedRawPoints, c.invalidatedPreLock])).toEqual([
      ["INVALIDATED_PRE_LOCK", false, 0, true],
      ["RANKED", false, 12, false],
      ["RANKED", false, 11, false],
    ]);
    // the per-call label is EXACT; Perfect honors live only on the board
    expect(by("RB").callGrades.every((c) => c.exact)).toBe(true);
  });

  it("8. a board grade must grade its own submission's locked SUBMISSION revision against its run's result", async () => {
    const built = await f.buildGradeRun(resultIds);
    const qb = submissionIds.get(`QB:${f.alpha.profileId}`)!;
    const rb = submissionIds.get(`RB:${f.alpha.profileId}`)!;
    const rbRevision = boardFor(built, "RB", f.alpha.profileId).board.revisionId;
    await expectDbGuard(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, board: { ...b.board, revisionId: rbRevision } }))), "WAIVER_INVALID");
    await expectDbGuard(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, board: { ...b.board, contestResultId: resultIds.RB } }))), "WAIVER_INVALID");
    // a draft-only submission cannot be graded
    const draft = submissionIds.get(`RB:${f.bravo.profileId}`)!;
    await expectDbGuard(f.writeGradeRun(withBoard(built, rb, (b) => ({ ...b, board: { ...b.board, submissionId: draft } }))), "WAIVER_INVALID");
    // every locked board must be graded, and only once
    await expectDbGuard(f.writeGradeRun({ ...built, boards: built.boards.filter((b) => b.board.submissionId !== rb) }), "WAIVER_INVALID");
    await expectDbGuard(f.writeGradeRun({ ...built, run: { ...built.run, boardGradeCount: 5 }, boards: built.boards.filter((b) => b.board.submissionId !== rb) }), "WAIVER_INVALID");
    await expectRejected(f.writeGradeRun({ ...built, boards: [...built.boards, boardFor(built, "RB", f.alpha.profileId)] }), /Unique constraint/);
  });

  it("9. call grades must grade their board's own calls, copy pool-row evidence exactly and add up to the board", async () => {
    const built = await f.buildGradeRun(resultIds);
    const qb = submissionIds.get(`QB:${f.alpha.profileId}`)!;
    const rbCall = boardFor(built, "RB", f.alpha.profileId).calls[0];
    await expectDbGuard(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, calls: b.calls.map((c, i) => (i === 0 ? { ...rbCall, slot: 1 } : c)) }))), "WAIVER_INVALID");
    await expectDbGuard(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, calls: b.calls.map((c, i) => (i === 1 ? { ...c, waiverPoolRank: 2, earnedRawPoints: 13 } : c)) }))), "WAIVER_INVALID");
    await expectDbGuard(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, calls: b.calls.map((c, i) => (i === 1 ? { ...c, earnedRawPoints: 13 } : c)) }))), "WAIVER_INVALID");
    await expectDbGuard(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, calls: b.calls.slice(0, 2) }))), "WAIVER_INVALID");
    await expectDbGuard(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, board: { ...b.board, totalFpHundredths: 5001, fpPerCallHundredths: 1667 } }))), "WAIVER_INVALID");
    await expectDbGuard(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, calls: b.calls.map((c, i) => (i === 1 ? { ...c, exact: true } : c)) }))), "WAIVER_INVALID");
    await expectRejected(
      f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, calls: b.calls.map((c, i) => (i === 1 ? { ...c, scored: false, earnedRawPoints: null } : c)) }))),
      /WaiverCallGrade_shape_check|WAIVER_INVALID/,
    );
  });

  it("10. a zero-call board is played with EyeQ and FP/Call N/A and FP/Available Slot 0.00", async () => {
    const built = await f.buildGradeRun(resultIds);
    const zero = submissionIds.get(`QB:${f.bravo.profileId}`)!;
    expect(boardFor(built, "QB", f.bravo.profileId).board).toMatchObject({
      resultKind: "NA_ZERO_CALL",
      played: true,
      eyeqHundredths: null,
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: 0,
      honorEligible: false,
      honorIneligibleReason: "ZERO_CALL_BOARD",
      awardedHonor: null,
    });
    await expectRejected(f.writeGradeRun(withBoard(built, zero, (b) => ({ ...b, board: { ...b.board, eyeqHundredths: 0 } }))), /WaiverBoardGrade_eyeq_check/);
    await expectRejected(f.writeGradeRun(withBoard(built, zero, (b) => ({ ...b, board: { ...b.board, played: false } }))), /WaiverBoardGrade_kind_check/);
    await expectRejected(f.writeGradeRun(withBoard(built, zero, (b) => ({ ...b, board: { ...b.board, fpPerAvailableSlotHundredths: null } }))), /WaiverBoardGrade_production_check/);
    await expectRejected(f.writeGradeRun(withBoard(built, zero, (b) => ({ ...b, board: { ...b.board, fpPerCallHundredths: 0 } }))), /WaiverBoardGrade_production_check/);
  });

  it("11. an all-neutralized board is not played; EyeQ, FP/Call and FP/Available Slot are N/A and neutralized calls leave every denominator", async () => {
    const built = await f.buildGradeRun(resultIds);
    const te = submissionIds.get(`TE:${f.alpha.profileId}`)!;
    const board = boardFor(built, "TE", f.alpha.profileId);
    expect(board.board).toMatchObject({
      resultKind: "NA_ALL_NEUTRALIZED",
      played: false,
      submittedCallCount: 1,
      scoreableCallCount: 0,
      neutralizedCallCount: 1,
      availableSlots: 2,
      effectiveAvailableSlots: 1,
      maxRawPoints: 0,
      eyeqHundredths: null,
      fpPerCallHundredths: null,
      fpPerCallDenominator: 0,
      fpPerAvailableSlotHundredths: null,
      honorIneligibleReason: "ALL_CALLS_NEUTRALIZED",
    });
    expect(board.calls[0]).toMatchObject({ treatment: "NEUTRALIZED", scored: false, fpHundredths: null, earnedRawPoints: null, maxRawPoints: null });
    await expectRejected(f.writeGradeRun(withBoard(built, te, (b) => ({ ...b, board: { ...b.board, fpPerAvailableSlotHundredths: 0 } }))), /WaiverBoardGrade_production_check/);
    await expectRejected(f.writeGradeRun(withBoard(built, te, (b) => ({ ...b, board: { ...b.board, played: true } }))), /WaiverBoardGrade_kind_check/);
    await expectRejected(f.writeGradeRun(withBoard(built, te, (b) => ({ ...b, board: { ...b.board, effectiveAvailableSlots: 2, fpPerAvailableSlotDenominator: 2 } }))), /WaiverBoardGrade_counts_check/);
  });

  it("12. EyeQ and FP are integer hundredths derived exactly from stored integers", async () => {
    const built = await f.buildGradeRun(resultIds);
    const qb = submissionIds.get(`QB:${f.alpha.profileId}`)!;
    const board = boardFor(built, "QB", f.alpha.profileId).board;
    expect(board).toMatchObject({ earnedRawPoints: 23, maxRawPoints: 84, coverageModifierNumerator: 300, coverageModifierDenominator: 300, eyeqHundredths: 2738 });
    await expectRejected(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, board: { ...b.board, eyeqHundredths: 2739 } }))), /WaiverBoardGrade_eyeq_check/);
    await expectRejected(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, board: { ...b.board, coverageModifierNumerator: 299 } }))), /WaiverBoardGrade_eyeq_check/);
    await expectRejected(f.writeGradeRun(withBoard(built, qb, (b) => ({ ...b, board: { ...b.board, fpPerAvailableSlotHundredths: 1666 } }))), /WaiverBoardGrade_production_check/);
  });

  it("negative fantasy points rank below zero and FP divisions round half away from zero, as in Stage 4A", async () => {
    const def = await f.writeContestResult(await f.buildContestResult("DEF", { artifact: r1, facts: { def2: { cls: "RANKED", points: -1101 } } }));
    expect(def.resultVersion).toBe(2);
    const built = await f.buildGradeRun({ ...resultIds, DEF: def.id });
    const board = boardFor(built, "DEF", f.alpha.profileId);
    expect(board.calls.map((c) => [c.waiverPoolRank, c.fpHundredths])).toEqual([
      [1, 1100],
      [3, -1101],
    ]);
    expect(board.board).toMatchObject({ totalFpHundredths: -1, fpPerCallHundredths: -1, fpPerAvailableSlotHundredths: 0 });
    const id = submissionIds.get(`DEF:${f.alpha.profileId}`)!;
    await expectRejected(f.writeGradeRun(withBoard(built, id, (b) => ({ ...b, board: { ...b.board, fpPerCallHundredths: 0 } }))), /WaiverBoardGrade_production_check/);
    await f.writeGradeRun(built);
  });

  it("honors follow the Stage 4A rules: no honor without every scored call exact; full-board honor needs every result-field slot", async () => {
    const built = await f.buildGradeRun(resultIds);
    const def = submissionIds.get(`DEF:${f.alpha.profileId}`)!;
    const rb = submissionIds.get(`RB:${f.alpha.profileId}`)!;
    await expectRejected(f.writeGradeRun(withBoard(built, def, (b) => ({ ...b, board: { ...b.board, awardedHonor: "PERFECT_CALL" } }))), /WaiverBoardGrade_kind_check|WAIVER_INVALID/);
    await expectDbGuard(f.writeGradeRun(withBoard(built, rb, (b) => ({ ...b, board: { ...b.board, awardedHonor: "PERFECT_CALL" } }))), "WAIVER_INVALID");
    await expectDbGuard(f.writeGradeRun(withBoard(built, rb, (b) => ({ ...b, board: { ...b.board, awardedHonor: "PERFECT_FIVE" } }))), "WAIVER_INVALID");
  });

  it("13. a run covers all five positions with its week's results on one artifact", async () => {
    const built = await f.buildGradeRun(resultIds);
    await expectDbGuard(f.writeGradeRun({ ...built, run: { ...built.run, qbContestResultId: resultIds.RB } }), "WAIVER_INVALID");
    // A position is a contest result or an explicit empty-position result, never neither.
    await expectRejected(
      f.writeGradeRun({ ...built, run: { ...built.run, teContestResultId: null } }),
      /WaiverGradeRun_shape_check|WAIVER_INVALID: a grade run must cover every Waiver contest of its week/,
    );
    await expectDbGuard(f.writeGradeRun({ ...built, run: { ...built.run, scoringVersion: "WAIVER_EYEQ_V2" } }), "WAIVER_INVALID");
    await expectRejected(f.writeGradeRun({ ...built, run: { ...built.run, gradingRulesetVersion: "rankeyeq-waiver-grading/2" } }), /WaiverGradeRun_shape_check|WAIVER_INVALID/);
  });

  it("14 + 23. identical inputs replay to identical fingerprints and the same run identity is refused as a duplicate", async () => {
    const first = await f.buildGradeRun(resultIds);
    const replay = await f.buildGradeRun(resultIds);
    expect(replay.run.inputFingerprint).toBe(first.run.inputFingerprint);
    expect(replay.run.outputFingerprint).toBe(first.run.outputFingerprint);
    expect(replay.boards.map((b) => b.board.outputFingerprint)).toEqual(first.boards.map((b) => b.board.outputFingerprint));
    const run = await f.writeGradeRun(first);
    expect(run.runNumber).toBe(1);
    const again = await f.buildGradeRun(resultIds);
    expect(again.run.runNumber).toBe(2);
    await expectRejected(f.writeGradeRun(again), /Unique constraint/);
    await expectDbGuard(f.writeGradeRun({ ...again, run: { ...again.run, runNumber: 3, inputFingerprint: "a".repeat(64) } }), "WAIVER_INVALID");
  });

  it("a SYSTEM-initiated run has no operator; an OPERATOR run needs an ADMIN initiator", async () => {
    const system = await f.buildGradeRun(resultIds, { initiatedByUserId: null });
    expect(system.run.initiator).toBe("SYSTEM");
    await expectDbGuard(f.writeGradeRun({ ...system, run: { ...system.run, initiator: "OPERATOR", initiatedByUserId: f.memberUserId } }), "WAIVER_INVALID");
    await expectRejected(f.writeGradeRun({ ...system, run: { ...system.run, initiator: "OPERATOR" } }), /WaiverGradeRun_shape_check/);
    await f.writeGradeRun(system);
  });
});
