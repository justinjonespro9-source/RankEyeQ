import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { WaiverPosition } from "@/lib/waivers/constants";
import { createResultsFixture, type ArtifactRef, type BuiltGradeRun, type PoolFact, type ResultsFixture } from "@/lib/waivers/__fixtures__/results";

/**
 * Stage 4B.4 full-board honors in the database: PERFECT PODIUM is earned on
 * the contest's scoreable slots (a cancelled/moved game or a D3 NEUTRALIZED
 * decision reduces them; a DNP or a D3 zero does not), checked at COMMIT
 * against the stored pool rows. Alpha's DEF board is [def1, def2]; def1 and
 * def2 rank 1 and 2 whenever def3 does not play. Synthetic local fixtures only.
 */

let f: ResultsFixture;
let artifact: ArtifactRef;
let resultIds: Record<WaiverPosition, string>;
let alphaDef: string;

beforeAll(async () => {
  f = await createResultsFixture("honor");
  artifact = await f.importArtifact(1);
  resultIds = await f.writeAllResults(artifact);
  alphaDef = (await prisma.waiverSubmission.findFirstOrThrow({ where: { contestId: f.contests.DEF, universalProfileId: f.alpha.profileId } })).id;
}, 300_000);

afterAll(async () => {
  await f.cleanup();
}, 300_000);

async function defResult(facts: Record<string, PoolFact>, db?: Parameters<ResultsFixture["writeContestResult"]>[1]) {
  return (await f.writeContestResult(await f.buildContestResult("DEF", { artifact, facts }, db), db)).id;
}

async function buildWithDef(defResultId: string, db?: Parameters<ResultsFixture["buildGradeRun"]>[2]) {
  return f.buildGradeRun({ ...resultIds, DEF: defResultId }, {}, db);
}

const alphaBoard = (built: BuiltGradeRun) => built.boards.find((b) => b.board.submissionId === alphaDef)!;

async function storedAlphaHonor(runId: string) {
  const grade = await prisma.waiverBoardGrade.findFirstOrThrow({ where: { gradeRunId: runId, submissionId: alphaDef } });
  return { honor: grade.awardedHonor, eyeq: grade.eyeqHundredths, exact: grade.exactCallCount, kind: grade.resultKind };
}

function withAlphaHonor(built: BuiltGradeRun, honor: "PERFECT_CALL" | "PERFECT_PODIUM" | null): BuiltGradeRun {
  return {
    ...built,
    boards: built.boards.map((b) => (b.board.submissionId === alphaDef ? { ...b, board: { ...b.board, awardedHonor: honor } } : b)),
  };
}

describe("full-board honors on the scoreable slots (database)", () => {
  it("a cancelled third DEF leaves two slots: two exact calls earn PERFECT PODIUM, and PERFECT CALL is refused", async () => {
    const built = await buildWithDef(await defResult({ def3: { cls: "SYSTEMIC_NEUTRALIZE" } }));
    expect(alphaBoard(built).board).toMatchObject({ awardedHonor: "PERFECT_PODIUM", exactCallCount: 2, neutralizedCallCount: 0, eyeqHundredths: 9000 });

    await expect(f.writeGradeRun(withAlphaHonor(built, "PERFECT_CALL"))).rejects.toThrow(/WAIVER_INVALID: awarded honor must follow the Waiver honor rules/);
    await expect(f.writeGradeRun(withAlphaHonor(built, null))).rejects.toThrow(/WAIVER_INVALID: awarded honor must follow the Waiver honor rules/);
    const run = await f.writeGradeRun(built);
    expect(await storedAlphaHonor(run.id)).toEqual({ honor: "PERFECT_PODIUM", eyeq: 9000, exact: 2, kind: "SCORED" });
  });

  it("a DNP third DEF keeps three slots: two exact calls earn PERFECT CALL, and PERFECT PODIUM is refused", async () => {
    const built = await buildWithDef(await defResult({ def3: { cls: "NON_PARTICIPANT" } }));
    expect(alphaBoard(built).board).toMatchObject({ awardedHonor: "PERFECT_CALL", exactCallCount: 2 });

    await expect(f.writeGradeRun(withAlphaHonor(built, "PERFECT_PODIUM"))).rejects.toThrow(/WAIVER_INVALID: awarded honor must follow the Waiver honor rules/);
    const run = await f.writeGradeRun(built);
    expect(await storedAlphaHonor(run.id)).toEqual({ honor: "PERFECT_CALL", eyeq: 9000, exact: 2, kind: "SCORED" });
  });

  it("a ranked third DEF that splits the calls earns no honor, and no honor can be claimed", async () => {
    // Default facts: def1 1100, def3 800, def2 300 -> def2 ranks 3rd at slot 2.
    const built = await f.buildGradeRun(resultIds);
    expect(alphaBoard(built).board).toMatchObject({ awardedHonor: null, exactCallCount: 1 });
    await expect(f.writeGradeRun(withAlphaHonor(built, "PERFECT_PODIUM"))).rejects.toThrow(/WAIVER_INVALID: awarded honor must follow/);
    await expect(f.writeGradeRun(withAlphaHonor(built, "PERFECT_CALL"))).rejects.toThrow(/WAIVER_INVALID: awarded honor must follow/);
  });

  it("settles the honor at COMMIT when the contest result, pool rows and grades share one transaction", async () => {
    const facts = { def3: { cls: "SYSTEMIC_NEUTRALIZE", disposition: "MOVED_OUT_OF_WEEK" } } as const;
    const runId = await prisma.$transaction(
      async (tx) => {
        const built = await buildWithDef(await defResult(facts, tx), tx);
        expect(alphaBoard(built).board.awardedHonor).toBe("PERFECT_PODIUM");
        return (await f.writeGradeRun(built, tx)).id;
      },
      { maxWait: 10_000, timeout: 300_000 },
    );
    expect((await storedAlphaHonor(runId)).honor).toBe("PERFECT_PODIUM");
  });

  it("a D3 NEUTRALIZED decision reduces the slots; a superseding D3 zero restores them", async () => {
    const bye = { def3: { cls: "SNAPSHOT_CONFLICT" } } as const;
    const neutralized = await f.resolve({ position: "DEF", key: "def3", artifact, resolution: "NEUTRALIZED" });
    const podium = await buildWithDef(await defResult(bye));
    expect(alphaBoard(podium).board.awardedHonor).toBe("PERFECT_PODIUM");
    expect((await storedAlphaHonor((await f.writeGradeRun(podium)).id)).honor).toBe("PERFECT_PODIUM");

    await f.resolve({ position: "DEF", key: "def3", artifact, resolution: "NON_PARTICIPANT_ZERO", supersedes: { id: neutralized.id, sequence: neutralized.sequence } });
    const call = await buildWithDef(await defResult(bye));
    expect(alphaBoard(call).board.awardedHonor).toBe("PERFECT_CALL");
    await expect(f.writeGradeRun(withAlphaHonor(call, "PERFECT_PODIUM"))).rejects.toThrow(/WAIVER_INVALID: awarded honor must follow/);
    expect((await storedAlphaHonor((await f.writeGradeRun(call)).id)).honor).toBe("PERFECT_CALL");
  });
});
