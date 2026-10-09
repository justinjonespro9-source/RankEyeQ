import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createResultsFixture, type ResultsFixture } from "@/lib/waivers/__fixtures__/results";

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
});
