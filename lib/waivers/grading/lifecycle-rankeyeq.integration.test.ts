import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { deleteWaiverFixtureGradingRows } from "@/lib/waivers/__fixtures__/results";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { WaiverGradingError } from "@/lib/waivers/grading/errors";
import { applyWaiverGradeAuthority, approveWaiverGradeRun, publishWaiverWeekGrades, storeWaiverWeekGradingRun } from "@/lib/waivers/grading/lifecycle";
import { buildWaiverGradingReview } from "@/lib/waivers/grading/review-model";
import { isWaiverGradingSourceStorable, loadWaiverWeekGradingPreviewFromSource, type WaiverGradingSource } from "@/lib/waivers/grading/source";
import { loadWaiverGradingLifecycleState } from "@/lib/waivers/grading/state";
import { loadGradedWaiverBoards } from "@/lib/waivers/leaderboard-queries";
import { commitRankEyeQFinalWeekStats, previewRankEyeQFinalWeekStats } from "@/lib/waivers/rankeyeq-results/store";
import type { RankEyeQParticipationDecisionInput } from "@/lib/waivers/rankeyeq-results/types";
import {
  WAIVER_GRADING_APPROVAL_RANKEYEQ_ATTESTATION_VERSION,
  WAIVER_RANKEYEQ_NATIVE_CROSSWALK_VERSION,
} from "@/lib/waivers/results/model";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Dual-source grading storage on the local database: the RankEyeQ
 * final-week-stats source is stored, approved, applied and published through the
 * same production services as SNG, with every stored row bound to the ACCEPTED
 * RankEyeQ snapshot (`rankEyeQSnapshotId`, never `artifactRowId`). Nothing is
 * mocked: PlayerWeekStat rows are committed into a real snapshot through
 * `commitRankEyeQFinalWeekStats`, and the real loader re-verifies it at every stage.
 */

const MINUTE = 60_000;
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = (typeof POSITIONS)[number];

type Spec = { key: string; position: Position; team: string; points: number; decision?: "PLAYED_ZERO" | "DID_NOT_PLAY" };
const SPECS: Spec[] = [
  { key: "qbA", position: "QB", team: "SF", points: 2410 },
  { key: "qbB", position: "QB", team: "SEA", points: 1800 },
  { key: "qbDnp", position: "QB", team: "LAR", points: 0, decision: "DID_NOT_PLAY" },
  { key: "rbA", position: "RB", team: "SF", points: 2810 },
  { key: "rbB", position: "RB", team: "SEA", points: 1940 },
  { key: "wrA", position: "WR", team: "SF", points: 2200 },
  { key: "wrB", position: "WR", team: "SEA", points: 1600 },
  { key: "wrC", position: "WR", team: "WAS", points: 1500 },
  { key: "teA", position: "TE", team: "SF", points: 1200 },
  { key: "teZero", position: "TE", team: "LAR", points: 0, decision: "PLAYED_ZERO" },
];

let base: WaiverFixture;
let weekId: string;
let gameId: string;
let memberUserId: string;
let second: { userId: string };
let alpha: { userId: string; profileId: string };
let bravo: { userId: string; profileId: string };
const players: Record<string, { id: string; name: string; externalId: string }> = {};
const contests = {} as Record<Position, string>;

const rankEyeQ: WaiverGradingSource = { kind: "RANKEYEQ_SNAPSHOT", snapshotId: null };

beforeAll(async () => {
  base = await createWaiverFixture("glrq");
  for (const spec of SPECS) players[spec.key] = await base.addContractPlayer({ position: spec.position, team: spec.team, label: spec.key });
  alpha = await base.addParticipant("alpha");
  bravo = await base.addParticipant("bravo");
  second = await base.addAdmin("second");
  memberUserId = (await prisma.user.create({ data: { email: `waivers-member-${base.suffix}@example.test` } })).id;
  ({ weekId } = await base.addWeek());

  const snapshot = await base.freezeSnapshot({
    weekId,
    rows: SPECS.map((spec) => ({ player: { id: players[spec.key].id, position: spec.position, name: players[spec.key].name }, team: spec.team, eligibility: "ELIGIBLE" as const })),
  });
  for (const position of POSITIONS) contests[position] = (await base.createContest({ weekId, snapshotId: snapshot.id, position, locksInMs: 60 * MINUTE })).id;
  const submit = (who: typeof alpha, position: Position, keys: string[]) =>
    submitWaiverBoard({ contestId: contests[position], universalProfileId: who.profileId, userId: who.userId, playerIds: keys.map((k) => players[k].id) });
  await submit(alpha, "QB", ["qbA", "qbB"]);
  await submit(bravo, "QB", []);
  await submit(alpha, "RB", ["rbA"]);
  await submit(alpha, "WR", ["wrA", "wrB", "wrC"]);
  await submit(alpha, "TE", ["teA", "teZero"]);
  const lockAt = new Date();
  for (const position of POSITIONS) await base.passLock(contests[position], lockAt);
  for (const position of POSITIONS) await ensureWaiverContestLocked(contests[position]);

  // The week's games are final and every pool member has a final manual WeekStat line (the RankEyeQ source's inputs).
  const game = await prisma.nflGame.findFirstOrThrow({ where: { weekId }, select: { id: true } });
  gameId = game.id;
  await prisma.nflGame.update({ where: { id: gameId }, data: { status: "FINAL" } });
  await prisma.week.update({ where: { id: weekId }, data: { status: "COMPLETE" } });
  for (const spec of SPECS) await writeStat(spec, spec.points);
}, 300_000);

afterAll(async () => {
  if (weekId) await deleteWaiverFixtureGradingRows(weekId);
  await base?.cleanup();
  if (memberUserId) await prisma.user.deleteMany({ where: { id: memberUserId } });
}, 300_000);

async function writeStat(spec: Spec, pointsHundredths: number) {
  const data = {
    provider: "manual",
    weekId,
    rankableEntryId: players[spec.key].id,
    gameId,
    externalPlayerId: `${base.suffix}-${spec.key}`,
    scoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
    fantasyPoints: pointsHundredths / 100,
    isProvisional: false,
  };
  await prisma.playerWeekStat.upsert({
    where: { provider_weekId_externalPlayerId: { provider: "manual", weekId, externalPlayerId: data.externalPlayerId } },
    create: data,
    update: { fantasyPoints: data.fantasyPoints },
  });
}

/** Zero-point rows need an operator decision before a snapshot can be committed. */
const decisions = (): RankEyeQParticipationDecisionInput[] =>
  SPECS.filter((spec) => spec.decision).map((spec) => ({
    rankableEntryId: players[spec.key].id,
    decision: spec.decision!,
    evidenceReference: "https://example.test/boxscore/fixture",
    reason: "Reviewed official box score and game book",
    decidedByUserId: base.adminUserId,
    decidedAt: new Date(Date.now() - 5 * MINUTE).toISOString(),
  }));

async function commitSnapshot() {
  // One decision set per commit: decidedAt is part of the snapshot content, so preview and commit must share it.
  const reviewedDecisions = decisions();
  const preview = await previewRankEyeQFinalWeekStats({ weekId, decisions: reviewedDecisions });
  expect(preview.blockers).toEqual([]);
  expect(preview.status).toBe("READY");
  return commitRankEyeQFinalWeekStats({
    weekId,
    decisions: reviewedDecisions,
    adminUserId: base.adminUserId,
    previewFingerprint: preview.previewFingerprint!,
    sourceReference: "fixture://rankeyeq-results",
    attested: true,
  });
}

const counts = async () => ({
  results: await prisma.waiverContestResult.count({ where: { weekId } }),
  emptyResults: await prisma.waiverEmptyPositionResult.count({ where: { weekId } }),
  runs: await prisma.waiverGradeRun.count({ where: { weekId } }),
  boardGrades: await prisma.waiverBoardGrade.count({ where: { gradeRun: { weekId } } }),
  approvals: await prisma.waiverGradeApproval.count({ where: { weekId } }),
  changes: await prisma.waiverGradeAuthorityChange.count({ where: { weekId } }),
  authority: await prisma.waiverWeekGradeAuthority.count({ where: { weekId } }),
  publications: await prisma.waiverWeekGradePublication.count({ where: { weekId } }),
});

async function rejectedWith(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WaiverGradingError);
  expect((error as WaiverGradingError).code).toBe(code);
}

const reviewed = async () => {
  const preview = await loadWaiverWeekGradingPreviewFromSource(prisma, { weekId, source: rankEyeQ });
  expect(preview.issues).toEqual([]);
  expect(preview.status).toBe("READY");
  return { preview, run: preview.run! };
};
const storeInput = (run: { inputFingerprint: string; outputFingerprint: string }, adminUserId = base.adminUserId) => ({
  weekId,
  source: rankEyeQ,
  adminUserId,
  expectedInputFingerprint: run.inputFingerprint,
  expectedOutputFingerprint: run.outputFingerprint,
});
const published = () => loadGradedWaiverBoards([weekId]);

/** Fields of an approval copied to build a conflicting direct insert. */
const approvalCopy = {
  weekId: true,
  gradeRunId: true,
  artifactRowId: true,
  rankEyeQSnapshotId: true,
  artifactRevision: true,
  artifactContentChecksum: true,
  snapshotSetFingerprint: true,
  resolutionSetFingerprint: true,
  inputFingerprint: true,
  outputFingerprint: true,
  defCrosswalkVersion: true,
  defCrosswalkAcknowledged: true,
  artifactImportedByUserId: true,
  gradeRunInitiatedByUserId: true,
  attestationVersion: true,
  attestationText: true,
} as const;

describe("dual-source grading storage: RankEyeQ source lifecycle", () => {
  let snapshot1: Awaited<ReturnType<typeof commitSnapshot>>;
  let run1: Awaited<ReturnType<typeof storeWaiverWeekGradingRun>>;
  let approval1: Awaited<ReturnType<typeof approveWaiverGradeRun>>;
  let change1: Awaited<ReturnType<typeof applyWaiverGradeAuthority>>;

  it("treats both verified sources as storable and no longer reports SOURCE_UNSUPPORTED", () => {
    expect(isWaiverGradingSourceStorable(rankEyeQ)).toBe(true);
    expect(isWaiverGradingSourceStorable({ kind: "SNG_ARTIFACT", artifactRowId: "x" })).toBe(true);
  });

  it("is blocked without an ACCEPTED snapshot: nothing is stored, and never SOURCE_UNSUPPORTED", async () => {
    const before = await counts();
    await rejectedWith(storeWaiverWeekGradingRun({ weekId, source: rankEyeQ, adminUserId: base.adminUserId, expectedInputFingerprint: "a".repeat(64), expectedOutputFingerprint: "b".repeat(64) }), "PREVIEW_BLOCKED");
    expect(await counts()).toEqual(before);
  });

  it("previews READY from the committed snapshot and builds the operator review", async () => {
    snapshot1 = await commitSnapshot();
    expect(snapshot1).toMatchObject({ revision: 1, alreadyCommitted: false });
    const before = await counts();
    const { preview } = await reviewed();
    expect(preview.artifact).toMatchObject({ rowId: snapshot1.snapshotRowId, revision: 1, contentChecksum: snapshot1.contentChecksum });
    expect(preview.positions.map((p) => [p.position, p.kind])).toEqual([
      ["QB", "CONTEST_RESULT"],
      ["RB", "CONTEST_RESULT"],
      ["WR", "CONTEST_RESULT"],
      ["TE", "CONTEST_RESULT"],
      ["DEF", "EMPTY_ELIGIBLE_POOL"],
    ]);
    const review = buildWaiverGradingReview(preview, new Map([[alpha.profileId, "alpha"]]));
    expect(review.zeroPoint.rows.map((r) => [r.position, r.treatment]).sort()).toEqual([
      ["QB", "NON_PARTICIPANT_ZERO"],
      ["TE", "RANKED"],
    ]);
    expect(await counts()).toEqual(before);
  });

  it("refuses unauthorized and stale stores, and a RankEyeQ store never needs an SNG artifact", async () => {
    const { run } = await reviewed();
    const before = await counts();
    await rejectedWith(storeWaiverWeekGradingRun(storeInput(run, memberUserId)), "FORBIDDEN");
    await rejectedWith(storeWaiverWeekGradingRun({ ...storeInput(run), expectedOutputFingerprint: "0".repeat(64) }), "STALE");
    // A pinned snapshot that is not the current ACCEPTED one is a superseded source.
    await rejectedWith(storeWaiverWeekGradingRun({ ...storeInput(run), source: { kind: "RANKEYEQ_SNAPSHOT", snapshotId: "older-row" } }), "SOURCE_SUPERSEDED");
    expect(await counts()).toEqual(before);
    expect(await prisma.waiverCanonicalArtifact.count({ where: { weekId } })).toBe(0);
  });

  it("stores a run bound to the snapshot (rankEyeQSnapshotId set, artifactRowId null) and nothing else", async () => {
    const { run } = await reviewed();
    run1 = await storeWaiverWeekGradingRun(storeInput(run));
    expect(run1).toMatchObject({ status: "STORED", runNumber: 1, boardGradeCount: 5, reusedContestResults: 0 });
    expect(await counts()).toMatchObject({ results: 4, emptyResults: 1, runs: 1, boardGrades: 5, approvals: 0, changes: 0, authority: 0, publications: 0 });

    const stored = await prisma.waiverGradeRun.findUniqueOrThrow({ where: { id: run1.gradeRunId } });
    expect(stored).toMatchObject({ artifactRowId: null, rankEyeQSnapshotId: snapshot1.snapshotRowId, artifactContentChecksum: snapshot1.contentChecksum, scoringVersion: "WAIVER_EYEQ_V1" });
    const results = await prisma.waiverContestResult.findMany({ where: { weekId } });
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result).toMatchObject({ artifactRowId: null, rankEyeQSnapshotId: snapshot1.snapshotRowId, artifactContentChecksum: snapshot1.contentChecksum });
    }
    expect(await published()).toEqual([]);
    const state = await loadWaiverGradingLifecycleState(weekId);
    expect(state.runs.map((r) => [r.runNumber, r.stage, r.nextAction, r.sourceKind, r.artifactRevision])).toEqual([[1, "STORED", "APPROVE", "RANKEYEQ_SNAPSHOT", 1]]);
  });

  it("is idempotent on the same preview", async () => {
    const before = await counts();
    const { run } = await reviewed();
    expect(await storeWaiverWeekGradingRun(storeInput(run))).toMatchObject({ status: "ALREADY_STORED", gradeRunId: run1.gradeRunId, runNumber: 1 });
    expect(await counts()).toEqual(before);
  });

  it("approves with RankEyeQ-specific evidence: native crosswalk N/A, snapshot revision, builder as importer equivalent", async () => {
    const approve = (over: Partial<Parameters<typeof approveWaiverGradeRun>[0]> = {}) =>
      approveWaiverGradeRun({
        gradeRunId: run1.gradeRunId,
        adminUserId: second.userId,
        expectedOutputFingerprint: run1.outputFingerprint,
        reason: "independent review of zero-point players",
        attested: true,
        // The SNG crosswalk acknowledgement does not apply to RankEyeQ.
        acknowledgeDefCrosswalk: false,
        policy: "SEPARATE_APPROVER",
        ...over,
      });
    await rejectedWith(approve({ attested: false }), "ATTESTATION_REQUIRED");
    await rejectedWith(approve({ adminUserId: memberUserId }), "FORBIDDEN");
    await rejectedWith(approve({ expectedOutputFingerprint: "f".repeat(64) }), "STALE");
    expect((await counts()).approvals).toBe(0);

    approval1 = await approve();
    expect(approval1.status).toBe("APPROVED");
    expect(await approve()).toMatchObject({ status: "ALREADY_APPROVED", approvalId: approval1.approvalId });
    const row = await prisma.waiverGradeApproval.findUniqueOrThrow({ where: { id: approval1.approvalId } });
    expect(row).toMatchObject({
      artifactRowId: null,
      rankEyeQSnapshotId: snapshot1.snapshotRowId,
      artifactRevision: 1,
      artifactContentChecksum: snapshot1.contentChecksum,
      defCrosswalkVersion: WAIVER_RANKEYEQ_NATIVE_CROSSWALK_VERSION,
      defCrosswalkAcknowledged: true,
      approvalPolicy: "SEPARATE_APPROVER",
      approvedByUserId: second.userId,
      // The snapshot builder is the importer equivalent.
      artifactImportedByUserId: base.adminUserId,
      attestationVersion: WAIVER_GRADING_APPROVAL_RANKEYEQ_ATTESTATION_VERSION,
    });
    expect(row.attestationText).toContain("RankEyeQ");
    expect(await counts()).toMatchObject({ approvals: 1, changes: 0, authority: 0, publications: 0 });
    expect(await published()).toEqual([]);
  });

  it("the snapshot builder cannot be the SEPARATE approver (database check)", async () => {
    const copy = await prisma.waiverGradeApproval.findUniqueOrThrow({ where: { id: approval1.approvalId }, select: approvalCopy });
    await expect(
      prisma.waiverGradeApproval.create({ data: { ...copy, approvedByUserId: base.adminUserId, approvalPolicy: "SEPARATE_APPROVER", reason: "builder as separate approver" } }),
    ).rejects.toThrow(/WaiverGradeApproval_shape_check/);
    // An SNG-style approval (no RankEyeQ marker) cannot reuse the RankEyeQ snapshot either.
    await expect(
      prisma.waiverGradeApproval.create({ data: { ...copy, approvedByUserId: base.adminUserId, approvalPolicy: "SEPARATE_APPROVER", defCrosswalkVersion: "sng-team-crosswalk/1", reason: "wrong crosswalk" } }),
    ).rejects.toThrow(/source_xor_check|copy its RankEyeQ snapshot/);
    expect(await prisma.waiverGradeApproval.count({ where: { weekId } })).toBe(1);
  });

  it("applies week-atomic CURRENT authority with source-bound contest pointers, without publishing", async () => {
    change1 = await applyWaiverGradeAuthority({ approvalId: approval1.approvalId, adminUserId: base.adminUserId, reason: "initial grade" });
    expect(change1).toMatchObject({ status: "APPLIED", sequence: 1, changeType: "INITIAL_GRADE", unpublishedPriorPublication: false });
    const pointers = await prisma.waiverContestResultAuthority.findMany({ where: { weekId } });
    expect(pointers).toHaveLength(4);
    for (const pointer of pointers) expect(pointer).toMatchObject({ artifactRowId: null, rankEyeQSnapshotId: snapshot1.snapshotRowId });
    expect(await published()).toEqual([]);
    expect((await loadWaiverGradingLifecycleState(weekId)).runs[0]).toMatchObject({ stage: "APPLIED", nextAction: "PUBLISH" });
  });

  it("publishes; only then do leaderboards return the RankEyeQ-graded boards", async () => {
    await rejectedWith(publishWaiverWeekGrades({ weekId, adminUserId: memberUserId, expectedChangeId: change1.changeId, reason: "go" }), "FORBIDDEN");
    expect(await published()).toEqual([]);
    const result = await publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: change1.changeId, reason: "official results" });
    expect(result).toMatchObject({ status: "PUBLISHED", changeId: change1.changeId, gradeRunId: run1.gradeRunId });

    const boards = await published();
    expect(boards).toHaveLength(5);
    const byKey = new Map(boards.map((b) => [`${b.universalProfileId}:${b.position}`, b]));
    // Same facts as the SNG lifecycle fixture: alpha's WR podium is perfect.
    expect(byKey.get(`${alpha.profileId}:WR`)).toMatchObject({ callsMade: 3, eyeqHundredths: 10000, perfectCalls: 3, totalFpHundredths: 5300 });
    expect(byKey.get(`${bravo.profileId}:QB`)).toMatchObject({ callsMade: 0, eyeqHundredths: null, perfectCalls: null, totalFpHundredths: 0, availableSlots: 3 });
    expect((await loadWaiverGradingLifecycleState(weekId)).runs[0].stage).toBe("PUBLISHED");

    const audits = await prisma.adminAuditLog.findMany({ where: { adminUserId: base.adminUserId, action: { startsWith: "waivers.grading_" } }, select: { action: true, metadata: true } });
    const stored = audits.find((a) => a.action === "waivers.grading_run_stored")!;
    expect(stored.metadata).toMatchObject({ sourceKind: "RANKEYEQ_SNAPSHOT", artifactRowId: null, rankEyeQSnapshotId: snapshot1.snapshotRowId });
  });

  it("a newer ACCEPTED snapshot supersedes the old source: the old run cannot be approved, and the regrade is unpublished until published again", async () => {
    // qbA's corrected final stat line reorders the QB pool; a new revision supersedes snapshot 1.
    await writeStat(SPECS[0], 1500);
    const snapshot2 = await commitSnapshot();
    expect(snapshot2).toMatchObject({ revision: 2, supersededSnapshotRowId: snapshot1.snapshotRowId });
    expect((await prisma.waiverRankEyeQResultsSnapshot.findUniqueOrThrow({ where: { id: snapshot1.snapshotRowId } })).publicationState).toBe("SUPERSEDED");

    const before = await counts();
    await rejectedWith(storeWaiverWeekGradingRun({ ...storeInput({ inputFingerprint: "a".repeat(64), outputFingerprint: "b".repeat(64) }), source: { kind: "RANKEYEQ_SNAPSHOT", snapshotId: snapshot1.snapshotRowId } }), "SOURCE_SUPERSEDED");
    // The old run is bound to the superseded snapshot: a fresh approver is refused.
    const third = await base.addAdmin("third");
    await rejectedWith(
      approveWaiverGradeRun({ gradeRunId: run1.gradeRunId, adminUserId: third.userId, expectedOutputFingerprint: run1.outputFingerprint, reason: "ok", attested: true, acknowledgeDefCrosswalk: true }),
      "SOURCE_SUPERSEDED",
    );
    expect(await counts()).toEqual(before);
    // The published week keeps showing the already-published authority until a regrade is applied.
    expect(await published()).toHaveLength(5);

    const { run } = await reviewed();
    const run2 = await storeWaiverWeekGradingRun(storeInput(run));
    expect(run2).toMatchObject({ status: "STORED", runNumber: 2 });
    expect(await prisma.waiverGradeRun.findUniqueOrThrow({ where: { id: run2.gradeRunId } })).toMatchObject({ artifactRowId: null, rankEyeQSnapshotId: snapshot2.snapshotRowId });
    const approval2 = await approveWaiverGradeRun({
      gradeRunId: run2.gradeRunId,
      adminUserId: second.userId,
      expectedOutputFingerprint: run2.outputFingerprint,
      reason: "regrade",
      attested: true,
      acknowledgeDefCrosswalk: false,
      policy: "SEPARATE_APPROVER",
    });
    const change2 = await applyWaiverGradeAuthority({ approvalId: approval2.approvalId, adminUserId: base.adminUserId, reason: "qbA corrected" });
    expect(change2).toMatchObject({ status: "APPLIED", sequence: 2, changeType: "REGRADE", unpublishedPriorPublication: true });
    expect(await published()).toEqual([]);
    await publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: change2.changeId, reason: "official regrade" });
    const boards = await published();
    expect(boards).toHaveLength(5);
    const alphaQb = boards.find((b) => b.universalProfileId === alpha.profileId && b.position === "QB")!;
    const priorQb = await prisma.waiverBoardGrade.findFirstOrThrow({ where: { gradeRunId: run1.gradeRunId, submission: { universalProfileId: alpha.profileId }, position: "QB" } });
    expect(alphaQb.eyeqHundredths).not.toBe(priorQb.eyeqHundredths);
  });
});

describe("dual-source grading storage: database XOR and source guards", () => {
  const sourceChecks = [
    "WaiverContestResult_source_xor_check",
    "WaiverGradeRun_source_xor_check",
    "WaiverGradeApproval_source_xor_check",
    "WaiverContestResultAuthority_source_xor_check",
  ];

  it("pins exactly-one-source CHECK constraints on all four tables, validated", async () => {
    const rows = await prisma.$queryRaw<Array<{ conname: string; convalidated: boolean; def: string }>>`
      SELECT conname, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ANY(${sourceChecks})`;
    expect(rows.map((r) => r.conname).sort()).toEqual([...sourceChecks].sort());
    for (const row of rows) {
      expect(row.convalidated).toBe(true);
      expect(row.def).toMatch(/num_nonnulls\("artifactRowId", "rankEyeQSnapshotId"\) = 1/);
    }
  });

  it("refuses a contest result or grade run with both sources or neither", async () => {
    const result = await prisma.waiverContestResult.findFirstOrThrow({ where: { weekId, resultVersion: 1 } });
    const { id: _id, createdAt: _createdAt, ...copy } = result;
    void _id;
    void _createdAt;
    const next = { ...copy, resultVersion: 3 };
    await expect(prisma.waiverContestResult.create({ data: { ...next, artifactRowId: null, rankEyeQSnapshotId: null } })).rejects.toThrow(/exactly one source|source_xor_check/);
    await expect(prisma.waiverContestResult.create({ data: { ...next, artifactRowId: "no-such-artifact", rankEyeQSnapshotId: result.rankEyeQSnapshotId } })).rejects.toThrow(/exactly one source|source_xor_check|foreign key/i);

    const run = await prisma.waiverGradeRun.findFirstOrThrow({ where: { weekId, runNumber: 1 } });
    const { id: _runId, createdAt: _runCreated, ...runCopy } = run;
    void _runId;
    void _runCreated;
    await expect(prisma.waiverGradeRun.create({ data: { ...runCopy, runNumber: 3, inputFingerprint: "e".repeat(64), artifactRowId: null, rankEyeQSnapshotId: null } })).rejects.toThrow(/exactly one source|source_xor_check/);
    await expect(prisma.waiverGradeRun.create({ data: { ...runCopy, runNumber: 3, inputFingerprint: "e".repeat(64), artifactRowId: "no-such-artifact" } })).rejects.toThrow(/exactly one source|source_xor_check|foreign key/i);
  });

  it("refuses a RankEyeQ-sourced result whose snapshot is superseded or from another checksum", async () => {
    const result = await prisma.waiverContestResult.findFirstOrThrow({ where: { weekId, resultVersion: 1, rankEyeQSnapshotId: { not: null } } });
    const { id: _id, createdAt: _createdAt, ...copy } = result;
    void _id;
    void _createdAt;
    // snapshot 1 is SUPERSEDED by now (the regrade scenario above); revision 2 is the ACCEPTED one.
    await expect(prisma.waiverContestResult.create({ data: { ...copy, resultVersion: 3, inputFingerprint: "d".repeat(64) } })).rejects.toThrow(/ACCEPTED RankEyeQ results snapshot/);
    const accepted = await prisma.waiverRankEyeQResultsSnapshot.findFirstOrThrow({ where: { weekId, publicationState: "ACCEPTED" } });
    await expect(
      prisma.waiverContestResult.create({
        data: { ...copy, resultVersion: 3, inputFingerprint: "d".repeat(64), rankEyeQSnapshotId: accepted.id, artifactContentChecksum: "0".repeat(64) },
      }),
    ).rejects.toThrow(/RankEyeQ results snapshot of its week by checksum/);
  });
});
