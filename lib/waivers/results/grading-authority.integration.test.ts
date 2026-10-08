import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { withdrawWaiverArtifact } from "@/lib/waivers/artifacts/withdraw";
import { WAIVER_POSITIONS } from "@/lib/waivers/constants";
import { expectDbGuard, MAINTENANCE_SQL } from "@/lib/waivers/__fixtures__/competition";
import { createResultsFixture, expectRejected, type ResultsFixture } from "@/lib/waivers/__fixtures__/results";

/**
 * Approval, week-atomic grading authority, regrading and storage guards
 * (Stage 4B.3 tests 15-22 and 24-28). Synthetic local fixtures only.
 */

let f: ResultsFixture;

beforeEach(async () => {
  f = await createResultsFixture("auth");
});

afterEach(async () => {
  await f.cleanup();
});

type Graded = Awaited<ReturnType<ResultsFixture["gradeWeek"]>>;

/** SNG publishes revision 2; wr6's D3 decision is reconfirmed and every contest gets result version 2 and a new run. */
async function prepareRegrade(first: Graded) {
  const r2 = await f.importArtifact(2);
  const r1Decision = await prisma.waiverConflictResolution.findFirstOrThrow({ where: { artifactRowId: first.artifact.id, contestId: f.contests.WR } });
  await f.resolve({ position: "WR", key: "wr6", artifact: r2, resolution: "NEUTRALIZED", reconfirmsResolutionId: r1Decision.id });
  const resultIds = await f.writeAllResults(r2);
  const run = await f.writeGradeRun(await f.buildGradeRun(resultIds));
  return { r2, resultIds, run };
}

async function authorityState() {
  return {
    week: await prisma.waiverWeekGradeAuthority.findUnique({ where: { weekId: f.weekId } }),
    contests: await prisma.waiverContestResultAuthority.findMany({ where: { weekId: f.weekId }, orderBy: { contestId: "asc" } }),
    boards: await prisma.waiverBoardGradeAuthority.findMany({ where: { weekId: f.weekId }, orderBy: { submissionId: "asc" } }),
    changes: await prisma.waiverGradeAuthorityChange.findMany({ where: { weekId: f.weekId }, orderBy: { sequence: "asc" } }),
  };
}

async function gradingHistory() {
  return {
    resolutions: await prisma.waiverConflictResolution.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
    results: await prisma.waiverContestResult.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" }, include: { poolResults: { orderBy: { id: "asc" } } } }),
    runs: await prisma.waiverGradeRun.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
    boards: await prisma.waiverBoardGrade.findMany({ where: { gradeRun: { weekId: f.weekId } }, orderBy: { id: "asc" }, include: { callGrades: { orderBy: { id: "asc" } } } }),
    approvals: await prisma.waiverGradeApproval.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
    changes: await prisma.waiverGradeAuthorityChange.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
  };
}

async function competitiveRows() {
  const contestIds = Object.values(f.contests);
  return {
    contests: await prisma.waiverContest.findMany({ where: { id: { in: contestIds } }, orderBy: { id: "asc" } }),
    submissions: await prisma.waiverSubmission.findMany({ where: { contestId: { in: contestIds } }, orderBy: { id: "asc" } }),
    revisions: await prisma.waiverSubmissionRevision.findMany({ where: { submission: { contestId: { in: contestIds } } }, orderBy: { id: "asc" } }),
    calls: await prisma.waiverCall.findMany({ where: { revision: { submission: { contestId: { in: contestIds } } } }, orderBy: { id: "asc" } }),
    snapshots: await prisma.waiverSnapshot.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
    entries: await prisma.waiverSnapshotEntry.findMany({ where: { snapshot: { weekId: f.weekId } }, orderBy: { id: "asc" } }),
  };
}

async function artifactRows() {
  return {
    artifacts: await prisma.waiverCanonicalArtifact.findMany({ where: { weekId: f.weekId }, orderBy: { id: "asc" } }),
    contents: await prisma.waiverCanonicalArtifactContent.findMany({ where: { artifact: { weekId: f.weekId } }, orderBy: { artifactRowId: "asc" } }),
    events: await prisma.waiverCanonicalArtifactEvent.findMany({ where: { artifact: { weekId: f.weekId } }, orderBy: { id: "asc" } }),
  };
}

async function rankingsCounts() {
  return {
    rankIQContest: await prisma.rankIQContest.count(),
    rankingSubmission: await prisma.rankingSubmission.count(),
    contestPregameSnapshot: await prisma.contestPregameSnapshot.count(),
    officialBoardVersion: await prisma.officialBoardVersion.count(),
  };
}

describe("approval", () => {
  it("22. importing an artifact records no approval, no grade run and no authority", async () => {
    await f.importArtifact(1);
    expect(await prisma.waiverGradeApproval.count({ where: { weekId: f.weekId } })).toBe(0);
    expect(await prisma.waiverGradeRun.count({ where: { weekId: f.weekId } })).toBe(0);
    expect(await authorityState()).toEqual({ week: null, contests: [], boards: [], changes: [] });
  });

  it("22. a stored grade run cannot become authoritative without an explicit approval of that run", async () => {
    const r1 = await f.importArtifact(1);
    const run = await f.writeGradeRun(await f.buildGradeRun(await f.writeAllResults(r1)));
    await expectRejected(f.applyAuthority(run.id, "no-such-approval"), /No record was found|WAIVER_INVALID/);
    await expectDbGuard(
      prisma.waiverGradeAuthorityChange.create({
        data: {
          weekId: f.weekId,
          sequence: 1,
          changeType: "INITIAL_GRADE",
          newGradeRunId: run.id,
          approvalId: "no-such-approval",
          approvedByUserId: f.adminUserId,
          reason: "unapproved",
          inputFingerprint: run.inputFingerprint,
          outputFingerprint: run.outputFingerprint,
        },
      }),
      "WAIVER_INVALID",
    );
    expect(await authorityState()).toEqual({ week: null, contests: [], boards: [], changes: [] });
  });

  it("21. approval is explicit evidence bound to the exact run, artifact, crosswalk and importer, by an ADMIN", async () => {
    const r1 = await f.importArtifact(1);
    const run = await f.writeGradeRun(await f.buildGradeRun(await f.writeAllResults(r1)));
    const data = await f.approvalData(run.id);
    await expectDbGuard(prisma.waiverGradeApproval.create({ data: { ...data, outputFingerprint: "f".repeat(64) } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverGradeApproval.create({ data: { ...data, resolutionSetFingerprint: "f".repeat(64) } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverGradeApproval.create({ data: { ...data, defCrosswalkVersion: "def-crosswalk/0" } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverGradeApproval.create({ data: { ...data, artifactImportedByUserId: f.secondAdminUserId } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverGradeApproval.create({ data: { ...data, approvedByUserId: f.memberUserId } }), "WAIVER_INVALID");
    await expectRejected(prisma.waiverGradeApproval.create({ data: { ...data, defCrosswalkAcknowledged: false } }), /WaiverGradeApproval_shape_check/);
    await expectRejected(prisma.waiverGradeApproval.create({ data: { ...data, attestationVersion: "unversioned" } }), /WaiverGradeApproval_shape_check/);
    await expectRejected(prisma.waiverGradeApproval.create({ data: { ...data, reason: "  " } }), /WaiverGradeApproval_shape_check/);

    const approval = await f.approve(run.id);
    expect(approval).toMatchObject({ approvalPolicy: "SINGLE_ADMIN_EXPLICIT", approvedByUserId: f.adminUserId, artifactImportedByUserId: f.adminUserId, outputFingerprint: run.outputFingerprint });
    expect(approval.approvedAt).toBeInstanceOf(Date);
    await expectRejected(f.approve(run.id), /Unique constraint/);
    await expectDbGuard(prisma.waiverGradeApproval.update({ where: { id: approval.id }, data: { reason: "edited" } }), "WAIVER_IMMUTABLE");
    // the approval alone changes no authority
    expect((await authorityState()).week).toBeNull();
  });

  it("21. SEPARATE_APPROVER is enforced by the database and a week cannot be silently downgraded afterwards", async () => {
    const r1 = await f.importArtifact(1);
    const run = await f.writeGradeRun(await f.buildGradeRun(await f.writeAllResults(r1)));
    await expectRejected(f.approve(run.id, { policy: "SEPARATE_APPROVER" }), /WaiverGradeApproval_shape_check/);
    const separate = await f.approve(run.id, { policy: "SEPARATE_APPROVER", approvedByUserId: f.secondAdminUserId });
    expect(separate.approvalPolicy).toBe("SEPARATE_APPROVER");
    await expectDbGuard(f.approve(run.id, { policy: "SINGLE_ADMIN_EXPLICIT" }), "WAIVER_INVALID");
    await f.applyAuthority(run.id, separate.id);
    expect((await authorityState()).changes[0]).toMatchObject({ approvalId: separate.id, approvedByUserId: f.secondAdminUserId });
  });
});

describe("week-atomic grading authority", () => {
  it("an apply moves the week, all five contest pointers and every board pointer to one run in one change", async () => {
    const graded = await f.gradeWeek();
    const state = await authorityState();
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0]).toMatchObject({ sequence: 1, changeType: "INITIAL_GRADE", priorChangeId: null, priorGradeRunId: null, newGradeRunId: graded.run.id, approvalId: graded.approval.id });
    expect(state.week).toMatchObject({ gradeRunId: graded.run.id, changeId: graded.change.id, outputFingerprint: graded.run.outputFingerprint });
    expect(state.contests).toHaveLength(5);
    expect(new Set(state.contests.map((c) => c.contestResultId))).toEqual(new Set(Object.values(graded.resultIds)));
    expect(state.boards).toHaveLength(graded.run.boardGradeCount);
    expect([...state.contests, ...state.boards].every((p) => p.gradeRunId === graded.run.id && p.changeId === graded.change.id)).toBe(true);
  });

  it("19. a partial week (missing contest or board pointer) fails at commit and records nothing", async () => {
    const r1 = await f.importArtifact(1);
    const run = await f.writeGradeRun(await f.buildGradeRun(await f.writeAllResults(r1)));
    const approval = await f.approve(run.id);
    await expectDbGuard(f.applyAuthority(run.id, approval.id, { skipContest: "DEF" }), "WAIVER_INVALID");
    await expectDbGuard(f.applyAuthority(run.id, approval.id, { skipBoards: 1 }), "WAIVER_INVALID");
    await expectDbGuard(
      prisma.$transaction(async (tx) => {
        const change = await tx.waiverGradeAuthorityChange.create({
          data: {
            weekId: f.weekId,
            sequence: 1,
            changeType: "INITIAL_GRADE",
            newGradeRunId: run.id,
            approvalId: approval.id,
            approvedByUserId: approval.approvedByUserId,
            reason: "change without pointers",
            inputFingerprint: run.inputFingerprint,
            outputFingerprint: run.outputFingerprint,
          },
        });
        return change;
      }),
      "WAIVER_INVALID",
    );
    expect(await authorityState()).toEqual({ week: null, contests: [], boards: [], changes: [] });
    await f.applyAuthority(run.id, approval.id);
    expect((await authorityState()).contests).toHaveLength(5);
  });

  it("17 + 18. pointers cannot be redirected across contests or submissions, or moved outside an authority change", async () => {
    const graded = await f.gradeWeek();
    const qbPointer = await prisma.waiverContestResultAuthority.findUniqueOrThrow({ where: { contestId: f.contests.QB } });
    await expectDbGuard(prisma.waiverContestResultAuthority.update({ where: { contestId: f.contests.QB }, data: { contestResultId: graded.resultIds.RB } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverContestResultAuthority.update({ where: { contestId: f.contests.QB }, data: { contestId: f.contests.RB } }), "WAIVER_IMMUTABLE");

    const boards = await prisma.waiverBoardGradeAuthority.findMany({ where: { weekId: f.weekId }, orderBy: { submissionId: "asc" } });
    const [a, b] = boards;
    await expectDbGuard(prisma.waiverBoardGradeAuthority.update({ where: { submissionId: a.submissionId }, data: { boardGradeId: b.boardGradeId } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverBoardGradeAuthority.update({ where: { submissionId: a.submissionId }, data: { submissionId: b.submissionId } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.$executeRaw`UPDATE "WaiverWeekGradeAuthority" SET "weekId" = 'elsewhere' WHERE "weekId" = ${f.weekId}`, "WAIVER_IMMUTABLE");

    // a newer approved run cannot be pointed at without appending an authority change
    const { run: run2 } = await prepareRegrade(graded);
    await f.approve(run2.id);
    await expectDbGuard(prisma.waiverWeekGradeAuthority.update({ where: { weekId: f.weekId }, data: { gradeRunId: run2.id, outputFingerprint: run2.outputFingerprint } }), "WAIVER_INVALID");
    expect(await prisma.waiverContestResultAuthority.findUniqueOrThrow({ where: { contestId: f.contests.QB } })).toEqual(qbPointer);
  });

  it("15 + 16. a regrade appends a REGRADE change, creates new result versions and grades, and preserves every prior record", async () => {
    const graded = await f.gradeWeek();
    const beforeRegrade = await gradingHistory();
    const { r2, resultIds, run: run2 } = await prepareRegrade(graded);
    const approval2 = await f.approve(run2.id);
    const change2 = await f.applyAuthority(run2.id, approval2.id, { reason: "SNG revision 2" });

    expect(change2).toMatchObject({ sequence: 2, changeType: "REGRADE", priorChangeId: graded.change.id, priorGradeRunId: graded.run.id, newGradeRunId: run2.id });
    expect(run2.runNumber).toBe(2);
    expect(run2.artifactRowId).toBe(r2.id);
    for (const position of WAIVER_POSITIONS) {
      const versions = await prisma.waiverContestResult.findMany({ where: { contestId: f.contests[position] }, orderBy: { resultVersion: "asc" }, select: { id: true, resultVersion: true } });
      expect(versions.map((v) => v.resultVersion)).toEqual([1, 2]);
      expect(versions[1].id).toBe(resultIds[position]);
    }
    const state = await authorityState();
    expect(state.week).toMatchObject({ gradeRunId: run2.id, changeId: change2.id });
    expect(new Set(state.contests.map((c) => c.contestResultId))).toEqual(new Set(Object.values(resultIds)));
    expect(state.boards.every((p) => p.gradeRunId === run2.id)).toBe(true);
    expect(state.changes.map((c) => c.sequence)).toEqual([1, 2]);

    const after = await gradingHistory();
    for (const key of Object.keys(beforeRegrade) as Array<keyof typeof beforeRegrade>) {
      const ids = new Set(after[key].map((row) => row.id));
      for (const row of beforeRegrade[key]) {
        expect(ids.has(row.id)).toBe(true);
        expect(after[key].find((r) => r.id === row.id)).toEqual(row);
      }
    }
    expect(after.runs).toHaveLength(2);
    expect(after.boards).toHaveLength(beforeRegrade.boards.length * 2);
  });

  it("an approval for one run cannot authorize another, and the same run cannot be reapplied from a stale chain", async () => {
    const graded = await f.gradeWeek();
    const { run: run2 } = await prepareRegrade(graded);
    await expectDbGuard(f.applyAuthority(run2.id, graded.approval.id), "WAIVER_INVALID");
    const approval2 = await f.approve(run2.id);
    await expectDbGuard(
      prisma.$transaction(async (tx) => {
        await tx.waiverGradeAuthorityChange.create({
          data: {
            weekId: f.weekId,
            sequence: 1,
            changeType: "REGRADE",
            priorChangeId: null,
            newGradeRunId: run2.id,
            approvalId: approval2.id,
            approvedByUserId: approval2.approvedByUserId,
            reason: "stale chain",
            inputFingerprint: run2.inputFingerprint,
            outputFingerprint: run2.outputFingerprint,
          },
        });
      }),
      "WAIVER_INVALID",
    );
    expect((await authorityState()).week?.gradeRunId).toBe(graded.run.id);
  });

  it("19 + 20. a regrade that leaves any contest pointer behind, or fails mid-apply, keeps the prior authority intact", async () => {
    const graded = await f.gradeWeek();
    const prior = await authorityState();
    const { run: run2 } = await prepareRegrade(graded);
    const approval2 = await f.approve(run2.id);

    await expectDbGuard(f.applyAuthority(run2.id, approval2.id, { skipContest: "TE" }), "WAIVER_INVALID");
    expect(await authorityState()).toEqual(prior);
    await expectDbGuard(f.applyAuthority(run2.id, approval2.id, { skipBoards: 2 }), "WAIVER_INVALID");
    expect(await authorityState()).toEqual(prior);
    await expectRejected(f.applyAuthority(run2.id, approval2.id, { failAfterPointers: true }), /simulated failure after pointer writes/);
    expect(await authorityState()).toEqual(prior);

    await f.applyAuthority(run2.id, approval2.id);
    expect((await authorityState()).week?.gradeRunId).toBe(run2.id);
  });

  it("concurrent applies for one week serialize: exactly one wins and the loser changes nothing", async () => {
    const graded = await f.gradeWeek();
    const { run: run2 } = await prepareRegrade(graded);
    const first = await f.approve(run2.id);
    const second = await f.approve(run2.id, { approvedByUserId: f.secondAdminUserId });
    const outcomes = await Promise.allSettled([f.applyAuthority(run2.id, first.id), f.applyAuthority(run2.id, second.id)]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const state = await authorityState();
    expect(state.changes.map((c) => c.sequence)).toEqual([1, 2]);
    expect(state.week?.changeId).toBe(state.changes[1].id);
  });

  it("a withdrawn or superseded source refuses new applies while the current authority stays recorded", async () => {
    const graded = await f.gradeWeek();
    const { r2, run: run2 } = await prepareRegrade(graded);
    const approval2 = await f.approve(run2.id);
    // r1 is now SUPERSEDED: its run can no longer be (re)applied
    await expectDbGuard(f.applyAuthority(graded.run.id, graded.approval.id), "WAIVER_INVALID");
    await withdrawWaiverArtifact({
      artifactRowId: r2.id,
      adminUserId: f.adminUserId,
      expectedSequence: 1,
      attested: true,
      reason: "fixture withdrawal",
      sourceReference: "sng-admin://fixture/withdrawn",
      sourceObservedAt: new Date(Date.now() - 60_000),
    });
    await expectDbGuard(f.applyAuthority(run2.id, approval2.id), "WAIVER_INVALID");
    await expectDbGuard(f.approve(run2.id, { approvedByUserId: f.secondAdminUserId }), "WAIVER_INVALID");
    expect((await authorityState()).week?.gradeRunId).toBe(graded.run.id);
  });
});

describe("storage guards and boundaries", () => {
  const ID_TABLES = [
    "WaiverConflictResolution",
    "WaiverContestResult",
    "WaiverPoolResult",
    "WaiverGradeRun",
    "WaiverBoardGrade",
    "WaiverCallGrade",
    "WaiverGradeApproval",
    "WaiverGradeAuthorityChange",
  ] as const;
  const POINTER_TABLES = [
    ["WaiverWeekGradeAuthority", "weekId"],
    ["WaiverContestResultAuthority", "contestId"],
    ["WaiverBoardGradeAuthority", "submissionId"],
  ] as const;

  const RUN_IDS = `SELECT g."id" FROM "WaiverGradeRun" g WHERE g."weekId" = $1`;
  const WEEK_SCOPE: Record<string, string> = {
    WaiverPoolResult: `t."contestResultId" IN (SELECT r."id" FROM "WaiverContestResult" r WHERE r."weekId" = $1)`,
    WaiverBoardGrade: `t."gradeRunId" IN (${RUN_IDS})`,
    WaiverCallGrade: `t."boardGradeId" IN (SELECT b."id" FROM "WaiverBoardGrade" b WHERE b."gradeRunId" IN (${RUN_IDS}))`,
  };

  async function oneId(table: string, key: string) {
    const scope = WEEK_SCOPE[table] ?? `t."weekId" = $1`;
    const rows = await prisma.$queryRawUnsafe<Array<{ k: string }>>(`SELECT t."${key}" AS k FROM "${table}" t WHERE ${scope} LIMIT 1`, f.weekId);
    return rows[0].k;
  }

  it("24. UPDATE and DELETE are refused on every results and grading table, even under fixture maintenance for UPDATE", async () => {
    await f.gradeWeek();
    for (const table of ID_TABLES) {
      const id = await oneId(table, "id");
      await expectDbGuard(prisma.$executeRawUnsafe(`UPDATE "${table}" SET "id" = "id" WHERE "id" = $1`, id), "WAIVER_IMMUTABLE");
      await expectDbGuard(prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" = $1`, id), "WAIVER_IMMUTABLE");
      await expectDbGuard(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(MAINTENANCE_SQL);
          await tx.$executeRawUnsafe(`UPDATE "${table}" SET "id" = "id" WHERE "id" = $1`, id);
        }),
        "WAIVER_IMMUTABLE",
      );
    }
    for (const [table, key] of POINTER_TABLES) {
      const id = await oneId(table, key);
      await expectDbGuard(prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${key}" = $1`, id), "WAIVER_IMMUTABLE");
    }
  });

  it("25. TRUNCATE is refused on every results and grading table", async () => {
    await f.gradeWeek();
    for (const table of [...ID_TABLES, ...POINTER_TABLES.map(([t]) => t)]) {
      await expectDbGuard(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`TRUNCATE "${table}" CASCADE`);
          throw new Error(`TRUNCATE of ${table} was not refused`);
        }),
        "WAIVER_IMMUTABLE",
      );
    }
    expect(await prisma.waiverGradeRun.count({ where: { weekId: f.weekId } })).toBe(1);
  });

  it("26 + 27 + 28. resolving, storing results, grading, approving and applying never modify Rankings, Waivers competition data or artifacts", async () => {
    const rankings = await rankingsCounts();
    const competitive = await competitiveRows();
    const r1 = await f.importArtifact(1);
    const artifacts = await artifactRows();
    const graded = await f.gradeWeek(r1);
    const { run: run2 } = await prepareRegrade(graded);
    const artifactsAfterR2 = await artifactRows();
    await f.applyAuthority(run2.id, (await f.approve(run2.id)).id);

    expect(await rankingsCounts()).toEqual(rankings);
    expect(await competitiveRows()).toEqual(competitive);
    expect((await artifactRows()).artifacts).toEqual(artifactsAfterR2.artifacts);
    expect((await artifactRows()).events).toEqual(artifactsAfterR2.events);
    expect(artifactsAfterR2.artifacts.filter((a) => a.id === r1.id)).toEqual(artifacts.artifacts);
    expect(artifactsAfterR2.contents.find((c) => c.artifactRowId === r1.id)).toEqual(artifacts.contents[0]);
  });
});
