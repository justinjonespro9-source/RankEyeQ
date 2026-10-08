import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { withdrawWaiverArtifact } from "@/lib/waivers/artifacts/withdraw";
import { expectDbGuard } from "@/lib/waivers/__fixtures__/competition";
import { createResultsFixture, expectRejected, type ArtifactRef, type BuiltGradeRun, type ResultsFixture } from "@/lib/waivers/__fixtures__/results";
import { deriveWaiverGradeRunLifecycle } from "@/lib/waivers/results/model";

/**
 * Stage 4B.3 final hardening and corrections: shrunken pools and
 * NA_NO_EFFECTIVE_SLOTS, explicit empty positions and zero-field contests,
 * set-based contest-result validation, import/approval transaction
 * separation (savepoints and subtransactions), and the fingerprint and
 * authority review items. Synthetic local fixtures only.
 */

const LONG_TX = { maxWait: 10_000, timeout: 120_000 } as const;

let f: ResultsFixture;

afterEach(async () => {
  await f.cleanup();
});

async function charlieSubmission() {
  return prisma.waiverSubmission.findFirstOrThrow({
    where: { contestId: f.contests.TE, universalProfileId: f.charlie!.profileId },
    include: { lockedRevision: { include: { calls: { orderBy: { slot: "asc" } } } } },
  });
}

function withBoard(built: BuiltGradeRun, submissionId: string, change: (board: BuiltGradeRun["boards"][number]) => BuiltGradeRun["boards"][number]): BuiltGradeRun {
  return { ...built, boards: built.boards.map((b) => (b.board.submissionId === submissionId ? change(b) : b)) };
}
describe("shrunken pool: a pre-lock correction leaves fewer slots than an original submission's calls", () => {
  beforeEach(async () => {
    f = await createResultsFixture("shrink", { overflowBoard: true });
  });

  it("keeps the original board and all its calls, grades it without fabricated slots, and caps coverage at 100%", async () => {
    const submission = await charlieSubmission();
    const revisionBefore = await prisma.waiverSubmissionRevision.findUniqueOrThrow({ where: { id: submission.lockedRevisionId! } });
    const graded = await f.gradeWeek();

    const te = await prisma.waiverContestResult.findUniqueOrThrow({ where: { id: graded.resultIds.TE } });
    expect(te).toMatchObject({ eligiblePoolSize: 2, effectiveAvailableSlots: 2, invalidatedCalledCount: 2 });
    expect(await prisma.waiverSubmissionRevision.findUniqueOrThrow({ where: { id: submission.lockedRevisionId! } })).toEqual(revisionBefore);
    expect(submission.lockedRevision!.callCount).toBe(3);
    expect(submission.lockedRevision!.calls.map((c) => c.slot)).toEqual([1, 2, 3]);

    const board = await prisma.waiverBoardGrade.findFirstOrThrow({
      where: { gradeRunId: graded.run.id, submissionId: submission.id },
      include: { callGrades: { orderBy: { slot: "asc" } } },
    });
    expect(board).toMatchObject({
      revisionId: submission.lockedRevisionId,
      submittedCallCount: 3,
      invalidatedCallCount: 2,
      scoreableCallCount: 3,
      neutralizedCallCount: 0,
      availableSlots: 2,
      effectiveAvailableSlots: 2,
      coverageCallCount: 2,
      slotOverflow: true,
      resultKind: "SCORED",
      played: true,
      awardedHonor: null,
    });
    // Every submitted call stays a call grade; the invalidated ones are scored misses (no neutralization).
    expect(board.callGrades.map((c) => [c.slot, c.treatment, c.scored, c.invalidatedPreLock, c.earnedRawPoints, c.maxRawPoints])).toEqual([
      [1, "RANKED", true, false, 33, 33],
      [2, "INVALIDATED_PRE_LOCK", true, true, 0, 28],
      [3, "INVALIDATED_PRE_LOCK", true, true, 0, 23],
    ]);
    expect(board.earnedRawPoints).toBe(33);
    expect(board.maxRawPoints).toBe(84);
    // WAIVER_EYEQ_V1 with k capped at K: (70·2 + 30·2) / (100·2) = 100%, never 115%.
    expect([board.coverageModifierNumerator, board.coverageModifierDenominator]).toEqual([200, 200]);
    expect(board.eyeqHundredths).toBe(Math.floor((2 * 33 * 200 * 10000 + 84 * 200) / (2 * 84 * 200)));
    expect([board.totalFpHundredths, board.fpPerCallHundredths, board.fpPerAvailableSlotHundredths]).toEqual([700, 233, 350]);

    // The run, including the overflow board, is authoritative as one week.
    expect((await prisma.waiverBoardGradeAuthority.findUniqueOrThrow({ where: { submissionId: submission.id } })).boardGradeId).toBe(board.id);
  });

  it("zero-call and all-neutralized boards, and a normal board with an invalidated call, carry the new counts", async () => {
    const graded = await f.gradeWeek();
    const boards = await prisma.waiverBoardGrade.findMany({ where: { gradeRunId: graded.run.id }, include: { submission: { select: { universalProfileId: true } } } });
    const find = (position: string, profileId: string) => boards.find((b) => b.position === position && b.submission.universalProfileId === profileId)!;

    expect(find("QB", f.bravo.profileId)).toMatchObject({
      resultKind: "NA_ZERO_CALL",
      submittedCallCount: 0,
      invalidatedCallCount: 0,
      coverageCallCount: 0,
      slotOverflow: false,
      eyeqHundredths: null,
      fpPerAvailableSlotHundredths: 0,
    });
    expect(find("TE", f.alpha.profileId)).toMatchObject({
      resultKind: "NA_ALL_NEUTRALIZED",
      played: false,
      submittedCallCount: 1,
      neutralizedCallCount: 1,
      invalidatedCallCount: 0,
      availableSlots: 2,
      effectiveAvailableSlots: 1,
      coverageCallCount: 0,
      slotOverflow: false,
      fpPerAvailableSlotHundredths: null,
    });
    expect(find("QB", f.alpha.profileId)).toMatchObject({
      resultKind: "SCORED",
      submittedCallCount: 3,
      invalidatedCallCount: 1,
      availableSlots: 3,
      coverageCallCount: 3,
      slotOverflow: false,
    });
  });

  it("refuses coverage above 100%, fabricated slots, altered submissions and miscounted invalidated calls", async () => {
    const r1 = await f.importArtifact(1);
    const built = await f.buildGradeRun(await f.writeAllResults(r1));
    const id = (await charlieSubmission()).id;
    const tamper = (change: Record<string, unknown>) => f.writeGradeRun(withBoard(built, id, (b) => ({ ...b, board: { ...b.board, ...change } })));

    await expectRejected(tamper({ coverageCallCount: 3 }), /WaiverBoardGrade_counts_check/);
    await expectRejected(tamper({ coverageCallCount: 3, coverageModifierNumerator: 230 }), /WaiverBoardGrade_counts_check/);
    await expectRejected(tamper({ coverageModifierNumerator: 230 }), /WaiverBoardGrade_eyeq_check/);
    await expectRejected(tamper({ slotOverflow: false }), /WaiverBoardGrade_counts_check/);
    await expectRejected(tamper({ invalidatedCallCount: 0 }), /WaiverBoardGrade_counts_check/);
    // Passes the row CHECK, but the call grades say otherwise (checked at COMMIT).
    await expectDbGuard(tamper({ invalidatedCallCount: 3 }), "WAIVER_INVALID");
    // No fabricated slots: available slots must equal the corrected contest result's.
    await expectDbGuard(
      tamper({ availableSlots: 3, effectiveAvailableSlots: 3, coverageCallCount: 3, slotOverflow: false, coverageModifierNumerator: 300, coverageModifierDenominator: 300, fpPerAvailableSlotDenominator: 3 }),
      "WAIVER_INVALID",
    );
    // The locked submission is graded as submitted: dropping a call is refused.
    await expectDbGuard(
      f.writeGradeRun(withBoard(built, id, (b) => ({ ...b, board: { ...b.board, submittedCallCount: 2, scoreableCallCount: 2, invalidatedCallCount: 1 }, calls: b.calls.slice(0, 2) }))),
      "WAIVER_INVALID",
    );
    expect(await prisma.waiverGradeRun.count({ where: { weekId: f.weekId } })).toBe(0);
    await f.writeGradeRun(built);
  });

  it("stores NA_NO_EFFECTIVE_SLOTS when scored calls are left with no effective slot (invalidated miss)", async () => {
    const r1 = await f.importArtifact(1);
    // te2 (eligible) and te3 (invalidated, D2 precedence) are neutralized; te4 stays a scored invalidated call.
    const ids = await f.writeAllResults(r1, { te2: { cls: "SYSTEMIC_NEUTRALIZE" }, te3: { cls: "SYSTEMIC_NEUTRALIZE" } });
    const run = await f.writeGradeRun(await f.buildGradeRun(ids));
    const board = await prisma.waiverBoardGrade.findFirstOrThrow({
      where: { gradeRunId: run.id, submissionId: (await charlieSubmission()).id },
      include: { callGrades: { orderBy: { slot: "asc" } } },
    });
    expect(board).toMatchObject({
      resultKind: "NA_NO_EFFECTIVE_SLOTS",
      ungradableReason: "NEUTRALIZATIONS_CONSUMED_SLOTS",
      played: false,
      honorEligible: false,
      honorIneligibleReason: "NO_EFFECTIVE_SLOTS",
      awardedHonor: null,
      submittedCallCount: 3,
      neutralizedCallCount: 2,
      scoreableCallCount: 1,
      invalidatedCallCount: 2,
      availableSlots: 2,
      effectiveAvailableSlots: 0,
      coverageCallCount: 0,
      slotOverflow: true,
      earnedRawPoints: 0,
      maxRawPoints: 23,
      coverageModifierNumerator: null,
      coverageModifierDenominator: null,
      eyeqHundredths: null,
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: null,
    });
    // The scoreable call stays a scored miss; nothing is converted to neutralized.
    expect(board.callGrades.map((c) => [c.slot, c.treatment, c.scored, c.invalidatedPreLock])).toEqual([
      [1, "NEUTRALIZED", false, false],
      [2, "NEUTRALIZED", false, true],
      [3, "INVALIDATED_PRE_LOCK", true, true],
    ]);
  });

  it("NA_NO_EFFECTIVE_SLOTS keeps an exact call's individual outcome but awards no board honor or board metric", async () => {
    const r1 = await f.importArtifact(1);
    // te3 and te4 (both invalidated) are D2-neutralized: 2 neutralized calls consume the 2 corrected slots; te2 stays exact at slot 1.
    const ids = await f.writeAllResults(r1, { te3: { cls: "SYSTEMIC_NEUTRALIZE" }, te4: { cls: "SYSTEMIC_NEUTRALIZE" } });
    const built = await f.buildGradeRun(ids);
    const id = (await charlieSubmission()).id;
    const tamper = (change: Record<string, unknown>) => f.writeGradeRun(withBoard(built, id, (b) => ({ ...b, board: { ...b.board, ...change } })));

    const graded = { eyeqHundredths: 10000, coverageModifierNumerator: 0, coverageModifierDenominator: 0 };
    // Passes the honor guard (an exact scored call earns PERFECT_CALL on a SCORED board), so the CHECK decides.
    await expectRejected(
      tamper({ resultKind: "SCORED", ungradableReason: null, played: true, honorEligible: true, honorIneligibleReason: null, awardedHonor: "PERFECT_CALL" }),
      /WaiverBoardGrade_kind_check/,
    );
    await expectRejected(tamper(graded), /WaiverBoardGrade_eyeq_check/);
    await expectRejected(tamper({ fpPerCallHundredths: 700 }), /WaiverBoardGrade_production_check/);
    await expectRejected(tamper({ fpPerAvailableSlotHundredths: 700 }), /WaiverBoardGrade_production_check/);
    await expectRejected(tamper({ coverageCallCount: 1 }), /WaiverBoardGrade_counts_check/);
    await expectRejected(tamper({ played: true }), /WaiverBoardGrade_kind_check/);
    await expectRejected(tamper({ ungradableReason: null }), /WaiverBoardGrade_kind_check/);
    await expectRejected(tamper({ ungradableReason: "CORRECTED_POOL_EMPTY" }), /WaiverBoardGrade_kind_check/);
    // Claiming an emptied pool needs K = 0, but K is bound to the contest result's snapshot-derived slots.
    await expectDbGuard(tamper({ availableSlots: 0, ungradableReason: "CORRECTED_POOL_EMPTY" }), "WAIVER_INVALID");
    await expectRejected(tamper({ honorIneligibleReason: "ALL_CALLS_NEUTRALIZED" }), /WaiverBoardGrade_kind_check/);
    await expectRejected(tamper({ resultKind: "NA_ALL_NEUTRALIZED", ungradableReason: null, honorIneligibleReason: "ALL_CALLS_NEUTRALIZED" }), /WaiverBoardGrade_kind_check/);
    await expectRejected(tamper({ awardedHonor: "PERFECT_CALL" }), /WaiverBoardGrade_kind_check|WAIVER_INVALID/);
    // The scoreable call cannot be silently converted into a neutralized one.
    await expectRejected(
      f.writeGradeRun(withBoard(built, id, (b) => ({
        ...b,
        board: { ...b.board, scoreableCallCount: 0, neutralizedCallCount: 3, exactCallCount: 0, earnedRawPoints: 0, maxRawPoints: 0, totalFpHundredths: 0, fpPerCallDenominator: 0, resultKind: "NA_ALL_NEUTRALIZED", ungradableReason: null, honorIneligibleReason: "ALL_CALLS_NEUTRALIZED" },
        calls: b.calls.map((c) => (c.slot === 1 ? { ...c, treatment: "NEUTRALIZED", scored: false, fpHundredths: null, earnedRawPoints: null, maxRawPoints: null, exact: false } : c)),
      }))),
      /WAIVER_INVALID|_check/,
    );
    expect(await prisma.waiverGradeRun.count({ where: { weekId: f.weekId } })).toBe(0);

    const run = await f.writeGradeRun(built);
    const board = await prisma.waiverBoardGrade.findFirstOrThrow({ where: { gradeRunId: run.id, submissionId: id }, include: { callGrades: { orderBy: { slot: "asc" } } } });
    expect(board).toMatchObject({
      resultKind: "NA_NO_EFFECTIVE_SLOTS",
      ungradableReason: "NEUTRALIZATIONS_CONSUMED_SLOTS",
      played: false,
      awardedHonor: null,
      scoreableCallCount: 1,
      neutralizedCallCount: 2,
      exactCallCount: 1,
      earnedRawPoints: 33,
      maxRawPoints: 33,
      totalFpHundredths: 700,
      eyeqHundredths: null,
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: null,
    });
    expect(board.callGrades[0]).toMatchObject({ slot: 1, treatment: "RANKED", scored: true, exact: true, waiverPoolRank: 1, earnedRawPoints: 33, fpHundredths: 700 });
  });

  it("stores an all-neutralized board on a shrunken pool as N/A without negative slots", async () => {
    const r1 = await f.importArtifact(1);
    const ids = await f.writeAllResults(r1, { te2: { cls: "SYSTEMIC_NEUTRALIZE" }, te3: { cls: "SYSTEMIC_NEUTRALIZE" }, te4: { cls: "SYSTEMIC_NEUTRALIZE" } });
    const run = await f.writeGradeRun(await f.buildGradeRun(ids));
    const board = await prisma.waiverBoardGrade.findFirstOrThrow({ where: { gradeRunId: run.id, submissionId: (await charlieSubmission()).id } });
    expect(board).toMatchObject({
      resultKind: "NA_ALL_NEUTRALIZED",
      played: false,
      submittedCallCount: 3,
      neutralizedCallCount: 3,
      invalidatedCallCount: 2,
      scoreableCallCount: 0,
      availableSlots: 2,
      effectiveAvailableSlots: 0,
      coverageCallCount: 0,
      slotOverflow: true,
      eyeqHundredths: null,
      fpPerAvailableSlotHundredths: null,
    });
  });
});

describe("empty eligible position: no contest, represented explicitly", () => {
  beforeEach(async () => {
    f = await createResultsFixture("empty", { emptyPosition: "TE" });
  });

  it("the empty-position record is verified against the current frozen snapshot and is immutable", async () => {
    expect(await prisma.waiverContest.count({ where: { weekId: f.weekId, position: "TE" } })).toBe(0);
    const data = await f.buildEmptyPositionResult("TE");
    await expectDbGuard(prisma.waiverEmptyPositionResult.create({ data: { ...data, position: "QB" } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverEmptyPositionResult.create({ data: { ...data, snapshotId: f.snapshots.v1 } }), "WAIVER_INVALID");
    await expectRejected(prisma.waiverEmptyPositionResult.create({ data: { ...data, eligiblePoolSize: 1 } }), /WaiverEmptyPositionResult_shape_check|WAIVER_INVALID/);
    await expectRejected(prisma.waiverEmptyPositionResult.create({ data: { ...data, resultFingerprint: "not-a-digest" } }), /WaiverEmptyPositionResult_shape_check/);

    const empty = await prisma.waiverEmptyPositionResult.create({ data });
    expect(empty).toMatchObject({ position: "TE", eligiblePoolSize: 0, snapshotId: f.snapshots.v2 });
    await expectRejected(prisma.waiverEmptyPositionResult.create({ data }), /Unique constraint/);
    await expectDbGuard(prisma.$executeRaw`UPDATE "WaiverEmptyPositionResult" SET "eligiblePoolSize" = 0 WHERE "id" = ${empty.id}`, "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.$executeRaw`DELETE FROM "WaiverEmptyPositionResult" WHERE "id" = ${empty.id}`, "WAIVER_IMMUTABLE");
    await expectDbGuard(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`TRUNCATE "WaiverEmptyPositionResult" CASCADE`);
      }),
      "WAIVER_IMMUTABLE",
    );
    expect(await prisma.waiverContestResult.count({ where: { weekId: f.weekId, position: "TE" } })).toBe(0);
  });

  it("a run represents all five positions; authority covers its four contests and every board", async () => {
    const graded = await f.gradeWeek();
    expect(graded.run.teContestResultId).toBeNull();
    expect(graded.run.teEmptyPositionResultId).toBe(graded.resultIds.TE);
    const contestPointers = await prisma.waiverContestResultAuthority.findMany({ where: { weekId: f.weekId } });
    expect(contestPointers).toHaveLength(4);
    expect(new Set(contestPointers.map((p) => p.gradeRunId))).toEqual(new Set([graded.run.id]));
    const boardPointers = await prisma.waiverBoardGradeAuthority.findMany({ where: { weekId: f.weekId } });
    expect(boardPointers).toHaveLength(graded.run.boardGradeCount);
    expect(new Set(boardPointers.map((p) => p.gradeRunId))).toEqual(new Set([graded.run.id]));
    expect(await prisma.waiverBoardGrade.count({ where: { gradeRunId: graded.run.id, position: "TE" } })).toBe(0);
    expect((await prisma.waiverWeekGradeAuthority.findUniqueOrThrow({ where: { weekId: f.weekId } })).outputFingerprint).toBe(graded.run.outputFingerprint);

    const again = await f.buildGradeRun(graded.resultIds);
    expect(again.run.inputFingerprint).toBe(graded.run.inputFingerprint);
    const rerun = { ...again.run, inputFingerprint: "b".repeat(64) };
    await expectRejected(f.writeGradeRun({ ...again, run: { ...rerun, teEmptyPositionResultId: null } }), /WaiverGradeRun_shape_check/);
    // Both a contest result and an empty result for TE (the BEFORE guard refuses it ahead of the CHECK).
    await expectRejected(
      f.writeGradeRun({ ...again, run: { ...rerun, teContestResultId: graded.resultIds.QB } }),
      /WaiverGradeRun_shape_check|WAIVER_INVALID: a grade run needs one contest result of its week and artifact for each of the five positions/,
    );
    await expectDbGuard(
      f.writeGradeRun({ ...again, run: { ...rerun, qbContestResultId: null, qbEmptyPositionResultId: graded.resultIds.TE } }),
      "WAIVER_INVALID",
    );
    const allEmpty = { qbContestResultId: null, rbContestResultId: null, wrContestResultId: null, defContestResultId: null };
    await expectRejected(
      f.writeGradeRun({ ...again, run: { ...rerun, ...allEmpty, qbEmptyPositionResultId: graded.resultIds.TE, rbEmptyPositionResultId: graded.resultIds.TE, wrEmptyPositionResultId: graded.resultIds.TE, defEmptyPositionResultId: graded.resultIds.TE } }),
      /WaiverGradeRun_shape_check|WAIVER_INVALID: an empty-position result must be of its week and position/,
    );
  });

  it("refuses to apply a run whose empty position gained a contest after it was graded", async () => {
    const r1 = await f.importArtifact(1);
    const run = await f.writeGradeRun(await f.buildGradeRun(await f.writeAllResults(r1)));
    const approval = await f.approve(run.id);
    // A contest row inserted directly (the opening service refuses an empty pool).
    await f.base.createContest({ weekId: f.weekId, snapshotId: f.snapshots.v2, position: "TE" });
    await expectRejected(f.applyAuthority(run.id, approval.id), /every empty position of the run to still have no contest/);
    expect(await prisma.waiverWeekGradeAuthority.findUnique({ where: { weekId: f.weekId } })).toBeNull();
  });
});

describe("existing contest whose corrected pool emptied: a zero-field contest result", () => {
  beforeEach(async () => {
    f = await createResultsFixture("emptied", { emptiedTeContest: true });
  });

  async function teSubmissions() {
    return prisma.waiverSubmission.findMany({
      where: { contestId: f.contests.TE },
      include: { lockedRevision: { include: { calls: { orderBy: { slot: "asc" } } } } },
      orderBy: { id: "asc" },
    });
  }

  it("keeps the contest and its submissions; the run covers five positions with the zero-field result", async () => {
    const contestBefore = await prisma.waiverContest.findUniqueOrThrow({ where: { id: f.contests.TE } });
    const submissionsBefore = await teSubmissions();
    expect(submissionsBefore).toHaveLength(3);
    const graded = await f.gradeWeek();

    const contestAfter = await prisma.waiverContest.findUniqueOrThrow({ where: { id: f.contests.TE } });
    expect(contestAfter).toMatchObject({ id: contestBefore.id, status: "LOCKED", snapshotId: f.snapshots.v2, maxCalls: contestBefore.maxCalls });
    expect(await teSubmissions()).toEqual(submissionsBefore);

    const te = await prisma.waiverContestResult.findUniqueOrThrow({ where: { id: graded.resultIds.TE }, include: { poolResults: true } });
    expect(te).toMatchObject({ contestId: f.contests.TE, eligiblePoolSize: 0, effectivePoolSize: 0, effectiveFieldSize: 0, effectiveAvailableSlots: 0, invalidatedCalledCount: 2 });
    // No fabricated players: only the two invalidated called players, neither ranked.
    expect(te.poolResults.map((p) => [p.rankableEntryId, p.category, p.treatment, p.waiverPoolRank]).sort()).toEqual(
      [
        [f.players.te1.id, "INVALIDATED_CALLED_PLAYER", "NEUTRALIZED", null],
        [f.players.te2.id, "INVALIDATED_CALLED_PLAYER", "INVALIDATED_PRE_LOCK", null],
      ].sort(),
    );
    expect(graded.run).toMatchObject({ teContestResultId: te.id, teEmptyPositionResultId: null });

    const boards = await prisma.waiverBoardGrade.findMany({ where: { gradeRunId: graded.run.id, position: "TE" }, include: { submission: true } });
    const by = (profileId: string) => boards.find((b) => b.submission.universalProfileId === profileId)!;
    expect(boards).toHaveLength(3);
    expect(by(f.alpha.profileId)).toMatchObject({
      resultKind: "NA_ALL_NEUTRALIZED",
      ungradableReason: null,
      played: false,
      availableSlots: 0,
      effectiveAvailableSlots: 0,
      neutralizedCallCount: 1,
      slotOverflow: true,
    });
    expect(by(f.bravo.profileId)).toMatchObject({
      resultKind: "NA_NO_EFFECTIVE_SLOTS",
      ungradableReason: "CORRECTED_POOL_EMPTY",
      played: false,
      availableSlots: 0,
      effectiveAvailableSlots: 0,
      scoreableCallCount: 1,
      invalidatedCallCount: 1,
      coverageCallCount: 0,
      slotOverflow: true,
      earnedRawPoints: 0,
      maxRawPoints: 33,
      eyeqHundredths: null,
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: null,
      awardedHonor: null,
    });
    // Approved: a zero-call board with zero slots is NA_ZERO_CALL, played, every board metric N/A, no honor.
    expect(by(f.charlie!.profileId)).toMatchObject({
      resultKind: "NA_ZERO_CALL",
      ungradableReason: null,
      played: true,
      honorEligible: false,
      honorIneligibleReason: "ZERO_CALL_BOARD",
      awardedHonor: null,
      availableSlots: 0,
      effectiveAvailableSlots: 0,
      submittedCallCount: 0,
      slotOverflow: false,
      eyeqHundredths: null,
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: null,
    });

    const contestPointers = await prisma.waiverContestResultAuthority.findMany({ where: { weekId: f.weekId } });
    expect(contestPointers).toHaveLength(5);
    expect(contestPointers.find((p) => p.contestId === f.contests.TE)?.contestResultId).toBe(te.id);
    expect(await prisma.waiverBoardGradeAuthority.count({ where: { contestId: f.contests.TE } })).toBe(3);
  });

  it("an empty-position record is refused while the contest exists; the zero-field result cannot fabricate players or slots", async () => {
    await expectDbGuard(prisma.waiverEmptyPositionResult.create({ data: await f.buildEmptyPositionResult("TE") }), "WAIVER_INVALID");

    const r1 = await f.importArtifact(1);
    const built = await f.buildContestResult("TE", { artifact: r1 });
    await expectDbGuard(f.writeContestResult({ ...built, result: { ...built.result, effectiveAvailableSlots: 1 } }), "WAIVER_INVALID");
    await expectDbGuard(f.writeContestResult({ ...built, result: { ...built.result, eligiblePoolSize: 1, effectiveAvailableSlots: 1 } }), "WAIVER_INVALID");
    await expectDbGuard(f.writeContestResult({ ...built, rows: built.rows.slice(1) }), "WAIVER_INVALID");
    const fabricated = built.rows.map((r) =>
      r.rankableEntryId === f.players.te2.id
        ? { ...r, category: "ELIGIBLE_POOL_MEMBER" as const, invalidationBasis: null, invalidatedBySnapshotId: null, treatment: "RANKED" as const, fpHundredths: 700, waiverPoolRank: 1 }
        : r,
    );
    await expectRejected(f.writeContestResult({ ...built, rows: fabricated }), /WAIVER_INVALID|_check/);
    expect(await prisma.waiverContestResult.count({ where: { weekId: f.weekId, position: "TE" } })).toBe(0);

    const ids = await f.writeAllResults(r1);
    const run = await f.buildGradeRun(ids);
    const rerun = { ...run.run };
    await expectRejected(
      f.writeGradeRun({ ...run, run: { ...rerun, teContestResultId: null } }),
      /WaiverGradeRun_shape_check|WAIVER_INVALID: a grade run must cover every Waiver contest of its week/,
    );
    const bravo = (await teSubmissions()).find((s) => s.universalProfileId === f.bravo.profileId)!;
    const charlie = (await teSubmissions()).find((s) => s.universalProfileId === f.charlie!.profileId)!;
    const tamper = (submissionId: string, change: Record<string, unknown>) =>
      f.writeGradeRun(withBoard(run, submissionId, (b) => ({ ...b, board: { ...b.board, ...change } })));
    // The reason follows the corrected pool (K = 0), never the neutralization case, and is never omitted.
    await expectRejected(tamper(bravo.id, { ungradableReason: "NEUTRALIZATIONS_CONSUMED_SLOTS" }), /WaiverBoardGrade_kind_check/);
    await expectRejected(tamper(bravo.id, { ungradableReason: null }), /WaiverBoardGrade_kind_check/);
    await expectRejected(tamper(bravo.id, { resultKind: "NA_ZERO_CALL", ungradableReason: null, honorIneligibleReason: "ZERO_CALL_BOARD", played: true }), /WaiverBoardGrade_kind_check/);
    // A zero-call board with no slot has no FP/Available Slot (0.00 needs a slot), no reason and no honor.
    await expectRejected(tamper(charlie.id, { fpPerAvailableSlotHundredths: 0 }), /WaiverBoardGrade_production_check/);
    await expectRejected(tamper(charlie.id, { ungradableReason: "CORRECTED_POOL_EMPTY" }), /WaiverBoardGrade_kind_check/);
    await expectRejected(tamper(charlie.id, { resultKind: "NA_NO_EFFECTIVE_SLOTS", ungradableReason: "CORRECTED_POOL_EMPTY", played: false, honorIneligibleReason: "NO_EFFECTIVE_SLOTS" }), /WaiverBoardGrade_kind_check/);
    await expectRejected(tamper(charlie.id, { played: false }), /WaiverBoardGrade_kind_check/);
    await expectDbGuard(
      tamper(bravo.id, { availableSlots: 2, ungradableReason: "NEUTRALIZATIONS_CONSUMED_SLOTS", slotOverflow: false, fpPerAvailableSlotDenominator: 0 }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      f.writeGradeRun(withBoard(run, bravo.id, (b) => ({
        ...b,
        board: { ...b.board, availableSlots: 1, effectiveAvailableSlots: 1, coverageCallCount: 1, slotOverflow: false, resultKind: "SCORED", ungradableReason: null, played: true, honorEligible: true, honorIneligibleReason: null, coverageModifierNumerator: 100, coverageModifierDenominator: 100, eyeqHundredths: 0, fpPerCallHundredths: 0, fpPerAvailableSlotHundredths: 0, fpPerAvailableSlotDenominator: 1 },
      }))),
      "WAIVER_INVALID",
    );
    expect(await prisma.waiverGradeRun.count({ where: { weekId: f.weekId } })).toBe(0);
    const stored = await f.writeGradeRun(run);
    // Week-atomic authority must also cover the zero-field contest and its boards.
    const approval = await f.approve(stored.id);
    await expectDbGuard(f.applyAuthority(stored.id, approval.id, { skipContest: "TE" }), "WAIVER_INVALID");
    expect(await prisma.waiverGradeAuthorityChange.count({ where: { weekId: f.weekId } })).toBe(0);
    await f.applyAuthority(stored.id, approval.id);
    expect(await prisma.waiverContestResultAuthority.count({ where: { weekId: f.weekId } })).toBe(5);
  });
});

describe("cross-binding: results, runs and approvals never mix weeks, snapshots, artifact revisions, contests or positions", () => {
  let g: ResultsFixture | null = null;

  beforeEach(async () => {
    f = await createResultsFixture("bind");
  });

  afterEach(async () => {
    await g?.cleanup();
    g = null;
  });

  it("refuses every cross-week, cross-snapshot, cross-revision and cross-contest combination", async () => {
    g = await createResultsFixture("bind-other");
    const other = await g.gradeWeek();
    const otherSnapshot = await prisma.waiverContest.findUniqueOrThrow({ where: { id: g.contests.QB }, select: { snapshotId: true } });

    // Contest result: its contest's week, position, pinned snapshot, and an artifact of its week.
    const r1 = await f.importArtifact(1);
    const qb = await f.buildContestResult("QB", { artifact: r1 });
    const withResult = (patch: Record<string, unknown>) => f.writeContestResult({ ...qb, result: { ...qb.result, ...patch } });
    await expectDbGuard(withResult({ weekId: g.weekId }), "WAIVER_INVALID");
    await expectDbGuard(withResult({ position: "RB" }), "WAIVER_INVALID");
    await expectDbGuard(withResult({ contestId: f.contests.RB }), "WAIVER_INVALID");
    await expectDbGuard(withResult({ snapshotId: f.snapshots.v1 }), "WAIVER_INVALID");
    await expectDbGuard(withResult({ snapshotId: otherSnapshot.snapshotId }), "WAIVER_INVALID");
    await expectDbGuard(withResult({ artifactRowId: other.artifact.id, artifactContentChecksum: other.artifact.contentChecksum }), "WAIVER_INVALID");
    await expectDbGuard(withResult({ artifactContentChecksum: other.artifact.contentChecksum }), "WAIVER_INVALID");
    expect(await prisma.waiverContestResult.count({ where: { weekId: f.weekId } })).toBe(0);

    // Grade run: one result of its own week, position and artifact per position.
    const ids = await f.writeAllResults(r1);
    const built = await f.buildGradeRun(ids);
    const withRun = (patch: Record<string, unknown>) => f.writeGradeRun({ ...built, run: { ...built.run, ...patch } });
    const runMessage = /WAIVER_INVALID: a grade run needs one contest result of its week and artifact for each of the five positions/;
    await expectRejected(withRun({ qbContestResultId: ids.RB, rbContestResultId: ids.QB }), runMessage);
    await expectRejected(withRun({ qbContestResultId: other.resultIds.QB }), runMessage);
    await expectDbGuard(withRun({ weekId: g.weekId }), "WAIVER_INVALID");
    await expectDbGuard(withRun({ artifactRowId: other.artifact.id, artifactContentChecksum: other.artifact.contentChecksum }), "WAIVER_INVALID");
    // Board grade: its run's result for its own position and contest.
    const qbBoard = built.boards.find((b) => b.board.position === "QB")!;
    await expectDbGuard(
      f.writeGradeRun({ ...built, boards: built.boards.map((b) => (b === qbBoard ? { ...b, board: { ...b.board, contestResultId: ids.RB } } : b)) }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      f.writeGradeRun({ ...built, boards: built.boards.map((b) => (b === qbBoard ? { ...b, board: { ...b.board, contestId: f.contests.RB, position: "RB", contestResultId: ids.RB } } : b)) }),
      "WAIVER_INVALID",
    );
    expect(await prisma.waiverGradeRun.count({ where: { weekId: f.weekId } })).toBe(0);
    const run = await f.writeGradeRun(built);

    // Approval: the run's exact week, artifact revision and checksum, snapshot set, D3 set and output.
    const data = await f.approvalData(run.id);
    const withApproval = (patch: Record<string, unknown>) => prisma.waiverGradeApproval.create({ data: { ...data, ...patch } });
    await expectDbGuard(withApproval({ weekId: g.weekId }), "WAIVER_INVALID");
    await expectDbGuard(withApproval({ gradeRunId: other.run.id }), "WAIVER_INVALID");
    await expectDbGuard(withApproval({ artifactRowId: other.artifact.id }), "WAIVER_INVALID");
    await expectDbGuard(withApproval({ artifactContentChecksum: other.artifact.contentChecksum }), "WAIVER_INVALID");
    await expectDbGuard(withApproval({ artifactRevision: 2 }), "WAIVER_INVALID");
    await expectDbGuard(withApproval({ snapshotSetFingerprint: other.run.snapshotSetFingerprint }), "WAIVER_INVALID");
    await expectDbGuard(withApproval({ resolutionSetFingerprint: "e".repeat(64) }), "WAIVER_INVALID");
    await expectDbGuard(withApproval({ outputFingerprint: other.run.outputFingerprint }), "WAIVER_INVALID");
    expect(await prisma.waiverGradeApproval.count({ where: { weekId: f.weekId } })).toBe(0);

    // A later artifact revision cannot be mixed into the r1 run, nor an r1 result into an r2 run.
    const approval = await f.approve(run.id);
    const r2 = await f.importArtifact(2);
    const r2Qb = await f.writeContestResult(await f.buildContestResult("QB", { artifact: r2 }));
    // (r1 is now superseded, so the state check may refuse first.)
    await expectRejected(
      withRun({ runNumber: 2, inputFingerprint: "f".repeat(64), qbContestResultId: r2Qb.id }),
      /a grade run requires an ACCEPTED canonical artifact|a grade run needs one contest result of its week and artifact/,
    );
    await expectRejected(
      withRun({ runNumber: 2, inputFingerprint: "f".repeat(64), artifactRowId: r2.id, artifactContentChecksum: r2.contentChecksum }),
      runMessage,
    );
    // The r1 run's approval cannot authorize anything once r1 is superseded.
    await expectDbGuard(f.applyAuthority(run.id, approval.id), "WAIVER_INVALID");
    expect(await prisma.waiverGradeAuthorityChange.count({ where: { weekId: f.weekId } })).toBe(0);
    // The other week's authority is untouched by every refusal above.
    expect((await prisma.waiverWeekGradeAuthority.findUniqueOrThrow({ where: { weekId: g.weekId } })).gradeRunId).toBe(other.run.id);
  });
});

describe("set-based contest-result validation", () => {
  beforeEach(async () => {
    f = await createResultsFixture("ranks");
  });

  const tweak = (built: Awaited<ReturnType<ResultsFixture["buildContestResult"]>>, id: string, patch: Record<string, unknown>) => ({
    ...built,
    rows: built.rows.map((r) => (r.rankableEntryId === id ? { ...r, ...patch } : r)),
  });

  it("validates competition ranks over negative and tied totals (1, 1, 3), not dense or row-number ranks", async () => {
    const r1 = await f.importArtifact(1);
    const facts = { def1: { cls: "RANKED" as const, points: -100 }, def2: { cls: "RANKED" as const, points: -100 }, def3: { cls: "RANKED" as const, points: -350 } };
    const built = await f.buildContestResult("DEF", { artifact: r1, facts });
    const rank = (key: string) => built.rows.find((r) => r.rankableEntryId === f.players[key].id)!.waiverPoolRank;
    expect([rank("def1"), rank("def2"), rank("def3")]).toEqual([1, 1, 3]);

    const ranksMessage = /Waiver pool ranks must be competition ranks/;
    await expectRejected(f.writeContestResult(tweak(built, f.players.def3.id, { waiverPoolRank: 2 })), ranksMessage);
    await expectRejected(f.writeContestResult(tweak(built, f.players.def2.id, { waiverPoolRank: 2 })), ranksMessage);
    await expectRejected(f.writeContestResult(tweak(tweak(built, f.players.def1.id, { waiverPoolRank: 2 }), f.players.def2.id, { waiverPoolRank: 2 })), ranksMessage);
    await expectRejected(f.writeContestResult(tweak(built, f.players.def3.id, { waiverPoolRank: 4 })), ranksMessage);
    const stored = await f.writeContestResult(built);
    expect(await prisma.waiverPoolResult.count({ where: { contestResultId: stored.id } })).toBe(3);
  });

  it("ranks only the post-treatment RANKED set: non-participants and D3-neutralized players never take a rank", async () => {
    const r1 = await f.importArtifact(1);
    await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED" });
    const built = await f.buildContestResult("WR", { artifact: r1, facts: { wr2: { cls: "NON_PARTICIPANT" } } });
    const rank = (key: string) => built.rows.find((r) => r.rankableEntryId === f.players[key].id)!.waiverPoolRank;
    expect(["wr1", "wr2", "wr3", "wr4", "wr5", "wr6"].map(rank)).toEqual([1, null, 2, 3, 4, null]);
    // Ranking as if wr2 still held its place is refused.
    await expectRejected(
      f.writeContestResult(tweak(tweak(tweak(tweak(built, f.players.wr3.id, { waiverPoolRank: 3 }), f.players.wr4.id, { waiverPoolRank: 4 }), f.players.wr5.id, { waiverPoolRank: 5 }), f.players.wr1.id, { waiverPoolRank: 1 })),
      /Waiver pool ranks must be competition ranks/,
    );
    await f.writeContestResult(built);
  });

  it("refuses pool rows the completeness pass could not see: a later transaction, or after the pass ran", async () => {
    const r1 = await f.importArtifact(1);
    const built = await f.buildContestResult("QB", { artifact: r1 });
    const stored = await f.writeContestResult(built);
    const lateMessage = /pool rows must be written in the contest result's transaction before its completeness check/;
    const extra = { ...built.rows[0], contestResultId: stored.id, rowFingerprint: "c".repeat(64) };
    await expectRejected(prisma.waiverPoolResult.create({ data: extra }), lateMessage);

    const def = await f.buildContestResult("DEF", { artifact: r1 });
    await expectRejected(
      prisma.$transaction(async (tx) => {
        const result = await tx.waiverContestResult.create({ data: def.result });
        await tx.waiverPoolResult.createMany({ data: def.rows.map((row) => ({ ...row, contestResultId: result.id })) });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
        await tx.waiverPoolResult.create({ data: { ...def.rows[0], contestResultId: result.id, rowFingerprint: "d".repeat(64) } });
      }, LONG_TX),
      lateMessage,
    );
    // Rows written in released savepoints before the pass are seen and validated.
    await prisma.$transaction(async (tx) => {
      const result = await tx.waiverContestResult.create({ data: def.result });
      await tx.$executeRawUnsafe("SAVEPOINT rows_a");
      await tx.waiverPoolResult.createMany({ data: def.rows.slice(0, 1).map((row) => ({ ...row, contestResultId: result.id })) });
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT rows_a");
      await tx.waiverPoolResult.createMany({ data: def.rows.slice(1).map((row) => ({ ...row, contestResultId: result.id })) });
    }, LONG_TX);
    expect(await prisma.waiverContestResult.count({ where: { weekId: f.weekId } })).toBe(2);
  });

  it("a validation pass rolled back with its savepoint is re-run at COMMIT", async () => {
    const r1 = await f.importArtifact(1);
    const def = await f.buildContestResult("DEF", { artifact: r1 });
    await expectRejected(
      prisma.$transaction(async (tx) => {
        const result = await tx.waiverContestResult.create({ data: def.result });
        await tx.waiverPoolResult.createMany({ data: def.rows.slice(1).map((row) => ({ ...row, contestResultId: result.id })) });
        await tx.$executeRawUnsafe("SAVEPOINT early_check");
        await tx.$executeRawUnsafe(`DO $$ BEGIN SET CONSTRAINTS ALL IMMEDIATE; EXCEPTION WHEN raise_exception THEN NULL; END $$`);
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT early_check");
      }, LONG_TX),
      /every eligible pool member and every invalidated called player exactly once/,
    );
    expect(await prisma.waiverContestResult.count({ where: { weekId: f.weekId } })).toBe(0);
  });
});

describe("approval separation: import and grading approval never share a transaction", () => {
  beforeEach(async () => {
    f = await createResultsFixture("sep");
  });

  async function nothingPersisted() {
    expect(await prisma.waiverCanonicalArtifact.count({ where: { weekId: f.weekId } })).toBe(0);
    expect(await prisma.waiverContestResult.count({ where: { weekId: f.weekId } })).toBe(0);
    expect(await prisma.waiverGradeRun.count({ where: { weekId: f.weekId } })).toBe(0);
    expect(await prisma.waiverGradeApproval.count({ where: { weekId: f.weekId } })).toBe(0);
  }

  async function gradeAndApprove(tx: Prisma.TransactionClient, artifact: ArtifactRef) {
    const ids = await f.writeAllResults(artifact, undefined, tx);
    const run = await f.writeGradeRun(await f.buildGradeRun(ids, {}, tx), tx);
    return f.approve(run.id, {}, tx);
  }

  it("refuses an approval in the import transaction", async () => {
    await expectRejected(
      prisma.$transaction(async (tx) => {
        const artifact = await f.importArtifactInTransaction(tx);
        await gradeAndApprove(tx, artifact);
      }, LONG_TX),
      /WAIVER_INVALID: grading approval cannot be recorded in the artifact import transaction/,
    );
    await nothingPersisted();
  });

  it("refuses it when the import ran under a released savepoint, or the approval runs under one", async () => {
    await expectRejected(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SAVEPOINT artifact_import");
        const artifact = await f.importArtifactInTransaction(tx);
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT artifact_import");
        await gradeAndApprove(tx, artifact);
      }, LONG_TX),
      /WAIVER_INVALID: grading approval cannot be recorded in the artifact import transaction/,
    );
    await nothingPersisted();

    await expectRejected(
      prisma.$transaction(async (tx) => {
        const artifact = await f.importArtifactInTransaction(tx);
        await tx.$executeRawUnsafe("SAVEPOINT approval");
        await gradeAndApprove(tx, artifact);
      }, LONG_TX),
      /WAIVER_INVALID: grading approval cannot be recorded in the artifact import transaction/,
    );
    await nothingPersisted();
  });

  it("refuses it when the import ran under nested savepoints, both released", async () => {
    await expectRejected(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SAVEPOINT outer_import");
        await tx.$executeRawUnsafe("SAVEPOINT inner_import");
        const artifact = await f.importArtifactInTransaction(tx);
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT inner_import");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT outer_import");
        await tx.$executeRawUnsafe("SAVEPOINT approval");
        await gradeAndApprove(tx, artifact);
      }, LONG_TX),
      /WAIVER_INVALID: grading approval cannot be recorded in the artifact import transaction/,
    );
    await nothingPersisted();
  });

  it("allows the approval once the import has committed in its own transaction", async () => {
    const artifact = await f.importArtifact(1);
    const approval = await prisma.$transaction((tx) => gradeAndApprove(tx, artifact), LONG_TX);
    expect(approval.artifactRowId).toBe(artifact.id);
    expect(await prisma.waiverGradeApproval.count({ where: { weekId: f.weekId } })).toBe(1);
  });

  it("allows an approval recorded under a savepoint once the import has committed", async () => {
    const artifact = await f.importArtifact(1);
    const approval = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SAVEPOINT approval");
      const created = await gradeAndApprove(tx, artifact);
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT approval");
      return created;
    }, LONG_TX);
    expect(approval.artifactRowId).toBe(artifact.id);
  });

  it("the shared same-transaction test recognizes top-level, savepoint, nested and exception-block writes, and nothing committed", async () => {
    const results = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE waiver_xmin_probe (label text) ON COMMIT DROP`);
      await tx.$executeRawUnsafe(`INSERT INTO waiver_xmin_probe VALUES ('top_level')`);
      await tx.$executeRawUnsafe("SAVEPOINT a");
      await tx.$executeRawUnsafe(`INSERT INTO waiver_xmin_probe VALUES ('released_savepoint')`);
      await tx.$executeRawUnsafe("SAVEPOINT b");
      await tx.$executeRawUnsafe(`INSERT INTO waiver_xmin_probe VALUES ('nested_savepoint')`);
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT b");
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT a");
      await tx.$executeRawUnsafe("SAVEPOINT open_savepoint");
      await tx.$executeRawUnsafe(`INSERT INTO waiver_xmin_probe VALUES ('open_savepoint')`);
      await tx.$executeRawUnsafe(
        `DO $$ BEGIN BEGIN INSERT INTO waiver_xmin_probe VALUES ('exception_block'); END; EXCEPTION WHEN OTHERS THEN RAISE; END $$`,
      );
      const probe = await tx.$queryRawUnsafe<Array<{ label: string; current: boolean }>>(
        `SELECT label, "waiver_xmin_is_current_transaction"(xmin::text::bigint) AS current FROM waiver_xmin_probe ORDER BY label`,
      );
      const committed = await tx.$queryRaw<Array<{ current: boolean }>>`
        SELECT "waiver_xmin_is_current_transaction"(w.xmin::text::bigint) AS current FROM "Week" w WHERE w."id" = ${f.weekId}`;
      const frozen = await tx.$queryRawUnsafe<Array<{ current: boolean }>>(`SELECT "waiver_xmin_is_current_transaction"(2) AS current`);
      return { probe, committed, frozen };
    }, LONG_TX);
    expect(results.probe).toEqual([
      { label: "exception_block", current: true },
      { label: "nested_savepoint", current: true },
      { label: "open_savepoint", current: true },
      { label: "released_savepoint", current: true },
      { label: "top_level", current: true },
    ]);
    expect(results.committed).toEqual([{ current: false }]);
    expect(results.frozen).toEqual([{ current: false }]);
  });
});

describe("fingerprint and authority review", () => {
  beforeEach(async () => {
    f = await createResultsFixture("review");
  });

  async function history() {
    return {
      artifacts: await prisma.waiverCanonicalArtifact.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
      contents: await prisma.waiverCanonicalArtifactContent.findMany({ where: { artifact: { weekId: f.weekId } }, orderBy: { artifactRowId: "asc" } }),
      resolutions: await prisma.waiverConflictResolution.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
      results: await prisma.waiverContestResult.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" }, include: { poolResults: { orderBy: { id: "asc" } } } }),
      runs: await prisma.waiverGradeRun.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
      boards: await prisma.waiverBoardGrade.findMany({ where: { gradeRun: { weekId: f.weekId } }, orderBy: { id: "asc" }, include: { callGrades: { orderBy: { id: "asc" } } } }),
      approvals: await prisma.waiverGradeApproval.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
      changes: await prisma.waiverGradeAuthorityChange.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
      week: await prisma.waiverWeekGradeAuthority.findUnique({ where: { weekId: f.weekId } }),
      contestPointers: await prisma.waiverContestResultAuthority.findMany({ where: { weekId: f.weekId }, orderBy: { contestId: "asc" } }),
      boardPointers: await prisma.waiverBoardGradeAuthority.findMany({ where: { weekId: f.weekId }, orderBy: { submissionId: "asc" } }),
    };
  }

  it("identical inputs replay identically; a different artifact revision never shares input identity", async () => {
    const graded = await f.gradeWeek();
    expect((await f.buildGradeRun(graded.resultIds)).run.inputFingerprint).toBe(graded.run.inputFingerprint);

    const r2 = await f.importArtifact(2);
    const r1Decision = await prisma.waiverConflictResolution.findFirstOrThrow({ where: { artifactRowId: graded.artifact.id, contestId: f.contests.WR } });
    await f.resolve({ position: "WR", key: "wr6", artifact: r2, resolution: "NEUTRALIZED", reconfirmsResolutionId: r1Decision.id });
    const r2Ids = await f.writeAllResults(r2);
    const r1Results = await prisma.waiverContestResult.findMany({ where: { id: { in: Object.values(graded.resultIds) } } });
    const r2Results = await prisma.waiverContestResult.findMany({ where: { id: { in: Object.values(r2Ids) } } });
    for (const r of r2Results) {
      const prior = r1Results.find((x) => x.position === r.position)!;
      expect(r.inputFingerprint, r.position).not.toBe(prior.inputFingerprint);
      expect(r.artifactRowId).not.toBe(prior.artifactRowId);
    }
    const run2 = await f.buildGradeRun(r2Ids);
    expect(run2.run.inputFingerprint).not.toBe(graded.run.inputFingerprint);
    // A run cannot borrow another run's input identity in the same week.
    await expectRejected(f.writeGradeRun({ ...run2, run: { ...run2.run, inputFingerprint: graded.run.inputFingerprint } }), /Unique constraint/);
    await f.writeGradeRun(run2);
  });

  it("withdrawing the source deletes no grading evidence; the grades stay current with a withdrawn notice and no new apply is possible", async () => {
    const graded = await f.gradeWeek();
    const before = await history();
    await withdrawWaiverArtifact({
      artifactRowId: graded.artifact.id,
      adminUserId: f.adminUserId,
      expectedSequence: 1,
      attested: true,
      reason: "fixture withdrawal",
      sourceReference: "sng-admin://fixture/withdrawn",
      sourceObservedAt: new Date(Date.now() - 60_000),
    });
    expect(await history()).toEqual(before);
    const events = await prisma.waiverCanonicalArtifactEvent.findMany({ where: { artifactRowId: graded.artifact.id }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => e.state)).toEqual(["ACCEPTED", "WITHDRAWN"]);
    expect(
      deriveWaiverGradeRunLifecycle({ gradeRunId: graded.run.id, approved: true, currentGradeRunId: before.week!.gradeRunId, everAuthoritative: true, artifactState: "WITHDRAWN" }),
    ).toBe("CURRENT_SOURCE_WITHDRAWN");
    await expectDbGuard(f.approve(graded.run.id, { approvedByUserId: f.secondAdminUserId }), "WAIVER_INVALID");
    await expectDbGuard(f.applyAuthority(graded.run.id, graded.approval.id), "WAIVER_INVALID");
    expect(await history()).toEqual(before);
  });
});
