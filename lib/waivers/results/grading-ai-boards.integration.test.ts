import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createResultsFixture, type ResultsFixture } from "@/lib/waivers/__fixtures__/results";
import { overrideWaiverAiBoard } from "@/lib/waivers/ai/competitive-override";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { recordWaiverAiEvidence, reviewWaiverAiEvidence } from "@/lib/waivers/ai/evidence";
import { approveWaiverAiLateEntry, verifyWaiverAiLateEntry } from "@/lib/waivers/ai/late-entry";
import { sha256Utf8 } from "@/lib/waivers/ai/text";

/**
 * Stage 4B.3A: a system-operated AI board is a locked board like any other,
 * so the week-atomic grade run must include it (and nothing in grading
 * depends on authority). Synthetic local fixtures only.
 */

let f: ResultsFixture;

afterEach(async () => {
  await f.cleanup();
});

describe("AI boards in week-atomic grading", () => {
  it("grades the AI board's locked revision in the same run as every human board", async () => {
    f = await createResultsFixture("aigrade", { aiBoard: true });
    const aiSubmission = await prisma.waiverSubmission.findFirstOrThrow({
      where: { contestId: f.contests.DEF, universalProfileId: f.ai!.profileId },
      include: { lockedRevision: { include: { aiResponse: true } } },
    });
    expect(aiSubmission).toMatchObject({ authority: "SYSTEM_OPERATED", status: "LOCKED" });
    expect(aiSubmission.lockedRevision!.aiResponse).not.toBeNull();

    const graded = await f.gradeWeek();
    const lockedBoards = await prisma.waiverSubmission.count({ where: { contest: { weekId: f.weekId }, lockedRevisionId: { not: null } } });
    const boardGrades = await prisma.waiverBoardGrade.findMany({ where: { gradeRunId: graded.run.id }, select: { submissionId: true, revisionId: true } });
    expect(boardGrades).toHaveLength(lockedBoards);

    const aiGrade = await prisma.waiverBoardGrade.findFirstOrThrow({
      where: { gradeRunId: graded.run.id, submissionId: aiSubmission.id },
      include: { callGrades: { orderBy: { slot: "asc" } } },
    });
    expect(aiGrade).toMatchObject({ revisionId: aiSubmission.lockedRevisionId, submittedCallCount: 2 });
    expect(aiGrade.callGrades.map((call) => call.slot)).toEqual([1, 2]);
    expect(graded.change).toBeTruthy();
  });

  it("grades an approved late-entered AI board at its locked revision, like any other board", async () => {
    f = await createResultsFixture("lategrade", { lateAiBoard: true });
    const late = await prisma.waiverSubmission.findFirstOrThrow({
      where: { contestId: f.contests.DEF, universalProfileId: f.lateAi!.profileId },
      include: { lateEntry: true, revisions: true },
    });
    expect(late).toMatchObject({ authority: "SYSTEM_OPERATED", status: "LOCKED", currentRevisionId: late.lockedRevisionId });
    expect(late.lateEntry).toMatchObject({ submissionId: late.id, revisionId: late.lockedRevisionId });
    expect(late.revisions).toHaveLength(1);
    // Legacy/unknown original prompt: the board never claims the canonical prompt.
    const verification = await prisma.waiverAiLateEntryVerification.findUniqueOrThrow({ where: { id: late.lateEntry!.verificationId } });
    expect(verification).toMatchObject({ promptEquivalence: "UNKNOWN", originalPromptVersion: null, originalPromptSha256: null });
    expect(verification.verifiedByUserId).toBe(late.lateEntry!.approvedByUserId);
    expect(await prisma.waiverAiResponse.findUniqueOrThrow({ where: { revisionId: late.lockedRevisionId! } })).toMatchObject({ promptVersion: null, promptSha256: null });
    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: f.contests.DEF } });
    expect(late.lockedAt!.getTime()).toBeGreaterThanOrEqual(contest.locksAt.getTime());

    const graded = await f.gradeWeek();
    const lateGrade = await prisma.waiverBoardGrade.findFirstOrThrow({
      where: { gradeRunId: graded.run.id, submissionId: late.id },
      include: { callGrades: { orderBy: { slot: "asc" } } },
    });
    expect(lateGrade).toMatchObject({ revisionId: late.lockedRevisionId, submittedCallCount: 2 });
    expect(lateGrade.callGrades.map((call) => call.rankableEntryId)).toEqual([f.players.def2.id, f.players.def3.id]);
  });

  it("grades an admin competitive override board at its locked revision, like any other AI board", async () => {
    f = await createResultsFixture("ovrgrade");
    const overrideAi = await f.base.addAiCompetitor("ovrgrader");
    const text = `1. ${f.players.def3.name}\n2. ${f.players.def2.name}\n`;
    const result = await overrideWaiverAiBoard({
      adminUserId: f.adminUserId,
      contestId: f.contests.DEF,
      universalProfileId: overrideAi.profileId,
      responseText: text,
      expectedResponseSha256: sha256Utf8(text),
      confirmedRankableEntryIds: [f.players.def3.id, f.players.def2.id],
      modelLabel: "Fixture override model",
      reason: "fixture override",
      sourceReference: null,
      evidenceId: null,
      confirmation: sha256Utf8(text).slice(0, 12),
      includeInCompetition: true,
    });
    const board = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: result.submissionId }, include: { competitiveOverride: true, revisions: true } });
    expect(board).toMatchObject({ authority: "SYSTEM_OPERATED", status: "LOCKED", lockedRevisionId: result.revisionId, currentRevisionId: result.revisionId });
    expect(board.competitiveOverride).toMatchObject({ submissionId: board.id, revisionId: result.revisionId });
    expect(board.revisions).toHaveLength(1);

    const graded = await f.gradeWeek();
    const lockedBoards = await prisma.waiverSubmission.count({ where: { contest: { weekId: f.weekId }, lockedRevisionId: { not: null } } });
    expect(await prisma.waiverBoardGrade.count({ where: { gradeRunId: graded.run.id } })).toBe(lockedBoards);
    const grade = await prisma.waiverBoardGrade.findFirstOrThrow({
      where: { gradeRunId: graded.run.id, submissionId: board.id },
      include: { callGrades: { orderBy: { slot: "asc" } } },
    });
    expect(grade).toMatchObject({ revisionId: result.revisionId, submittedCallCount: 2 });
    expect(grade.callGrades.map((call) => call.rankableEntryId)).toEqual([f.players.def3.id, f.players.def2.id]);
  });

  it("refuses an admin competitive override once the week has a grade run", async () => {
    f = await createResultsFixture("ovrgraded");
    await f.gradeWeek();
    const overrideAi = await f.base.addAiCompetitor("ovraftergrade");
    const text = `1. ${f.players.def2.name}\n`;
    const input = {
      adminUserId: f.adminUserId,
      contestId: f.contests.DEF,
      universalProfileId: overrideAi.profileId,
      responseText: text,
      expectedResponseSha256: sha256Utf8(text),
      confirmedRankableEntryIds: [f.players.def2.id],
      modelLabel: "Fixture override model",
      reason: "after grading",
      sourceReference: null,
      evidenceId: null,
      confirmation: sha256Utf8(text).slice(0, 12),
      includeInCompetition: true,
    };
    await expect(overrideWaiverAiBoard(input)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/grade run/) });
    // The database refuses it too, whatever the application checks.
    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: f.contests.DEF } });
    await expect(
      prisma.waiverAiCompetitiveOverride.create({
        data: {
          contestId: contest.id,
          position: contest.position,
          snapshotId: contest.snapshotId,
          universalProfileId: overrideAi.profileId,
          responseSha256: sha256Utf8(text),
          boardFingerprint: "a".repeat(64),
          callCount: 1,
          parserVersion: "WAIVEREYEQ_AI_PARSER_V1",
          modelLabel: "x",
          reason: "after grading",
          submissionId: "ovr-graded-sub",
          revisionId: "ovr-graded-rev",
          confirmation: sha256Utf8(text).slice(0, 12),
          authorizedByUserId: f.adminUserId,
        },
      }),
    ).rejects.toThrow(/WAIVER_INVALID: the week has a grade run/);
    expect(await prisma.waiverSubmission.count({ where: { contestId: contest.id, universalProfileId: overrideAi.profileId } })).toBe(0);
    expect(await prisma.waiverAiCompetitiveOverride.count({ where: { contestId: contest.id } })).toBe(0);
  });

  it("refuses a late entry once the week has a grade run, even with eligible pre-lock evidence", async () => {
    f = await createResultsFixture("lategraded");
    await f.gradeWeek();
    const lateAi = await f.base.addAiCompetitor("aftergrade");
    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: f.contests.DEF }, include: { snapshot: true } });
    const text = `1. ${f.players.def2.name}\n2. ${f.players.def3.name}\n`;
    const evidence = await recordWaiverAiEvidence({
      adminUserId: f.adminUserId,
      contestId: contest.id,
      universalProfileId: lateAi.profileId,
      responseText: text,
      expectedResponseSha256: sha256Utf8(text),
      modelLabel: "Fixture late model",
      statedSourceAt: null,
      evidenceSource: "CHAT_EXPORT",
      evidenceReference: "conversation.json",
      note: null,
    });
    await reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: evidence.evidenceId, expectedSequence: 0, status: "TEXT_CONFIRMED", note: "matches export" });
    const at = new Date((contest.snapshot.frozenAt!.getTime() + contest.locksAt.getTime()) / 2);
    const json = JSON.stringify({ messages: [{ role: "assistant", created_at: at.toISOString(), content: text }] });
    const context = await loadWaiverAiContestContext(prisma, contest.id);
    const pickIds = [f.players.def2.id, f.players.def3.id];
    const verified = await verifyWaiverAiLateEntry({
      adminUserId: f.adminUserId,
      evidenceId: evidence.evidenceId,
      expectedSequence: 0,
      basis: "PROVIDER_ARTIFACT",
      originalPredictionAt: null,
      sourceReference: "conversation.json",
      artifact: { name: "conversation.json", bytes: new TextEncoder().encode(json), expectedSha256: sha256Utf8(json) },
      expectedPromptSha256: context!.prompt.sha256,
      originalPrompt: { version: null, reference: null, text: null },
      confirmedRankableEntryIds: pickIds,
      attestation: "export reviewed",
    });
    expect(verified).toMatchObject({ eligible: true, timestampMethod: "PROVIDER_MESSAGE" });

    await expect(
      approveWaiverAiLateEntry({
        adminUserId: f.adminUserId,
        verificationId: verified.verificationId,
        confirmation: evidence.responseSha256.slice(0, 12),
        confirmedRankableEntryIds: pickIds,
        note: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/grade run/) });
    expect(await prisma.waiverSubmission.count({ where: { contestId: contest.id, universalProfileId: lateAi.profileId } })).toBe(0);
    expect(await prisma.waiverAiLateEntryApproval.count({ where: { contestId: contest.id } })).toBe(0);
  });
});
