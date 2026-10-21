import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { buildSyntheticCanonicalArtifact, SYNTHETIC_PARTICIPANTS, type SyntheticParticipantSpec } from "@/lib/waivers/__fixtures__/canonical-artifact";
import { createWaiverFixture, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { deleteWaiverFixtureGradingRows } from "@/lib/waivers/__fixtures__/results";
import { applyWaiverArtifactImport, previewWaiverArtifactImport } from "@/lib/waivers/artifacts/import";
import { sngTeamForRankEyeQTeam } from "@/lib/waivers/canonical/team-crosswalk";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { WaiverGradingError } from "@/lib/waivers/grading/errors";
import { applyWaiverGradeAuthority, approveWaiverGradeRun, publishWaiverWeekGrades, storeWaiverWeekGradingRun } from "@/lib/waivers/grading/lifecycle";
import { buildWaiverGradingReview } from "@/lib/waivers/grading/review-model";
import { loadWaiverWeekGradingPreviewFromSource, type WaiverGradingSource } from "@/lib/waivers/grading/source";
import { loadWaiverGradingLifecycleState } from "@/lib/waivers/grading/state";
import { indexRankEyeQResultsLedger, type VerifiedRankEyeQResultsSource } from "@/lib/waivers/rankeyeq-results/ledger";
import type { RankEyeQParticipant } from "@/lib/waivers/rankeyeq-results/types";
import { loadGradedWaiverBoards } from "@/lib/waivers/leaderboard-queries";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Grading lifecycle on the local database: a READY SNG-artifact preview is
 * stored, approved, applied and published through the production services, and
 * public leaderboards read graded boards only after publication.
 */

// The RankEyeQ results store is another stage's module (its migration may not be applied locally): mock its loader.
const rankeyeq = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/waivers/rankeyeq-results/store", () => ({ loadVerifiedRankEyeQResultsSource: rankeyeq.load }));

const MINUTE = 60_000;
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = (typeof POSITIONS)[number];

type Spec = { key: string; position: Position; team: string } & Pick<SyntheticParticipantSpec, "points" | "state" | "disposition" | "proof">;
const VNP = "VERIFIED_NON_PARTICIPANT" as const;
const SPECS: Spec[] = [
  { key: "qbA", position: "QB", team: "SF", points: 2410 },
  { key: "qbB", position: "QB", team: "SEA", points: 1800 },
  { key: "qbDnp", position: "QB", team: "LAR", state: VNP, disposition: "DNP", proof: "OFFICIAL_INACTIVE" },
  { key: "rbA", position: "RB", team: "SF", points: 2810 },
  { key: "rbB", position: "RB", team: "SEA", points: 1940 },
  { key: "wrA", position: "WR", team: "SF", points: 2200 },
  { key: "wrB", position: "WR", team: "SEA", points: 1600 },
  { key: "wrC", position: "WR", team: "WAS", points: 1500 },
  { key: "teA", position: "TE", team: "SF", points: 1200 },
  { key: "teZero", position: "TE", team: "LAR", points: 0 },
];

let base: WaiverFixture;
let weekId: string;
let memberUserId: string;
let r1: string;
let r2: string;
let alpha: { userId: string; profileId: string };
let bravo: { userId: string; profileId: string };
const players: Record<string, { id: string; name: string; externalId: string }> = {};
const contests = {} as Record<Position, string>;

beforeEach(() => {
  rankeyeq.load.mockReset();
  rankeyeq.load.mockResolvedValue({ ok: false, code: "NO_ACCEPTED_SNAPSHOT", issues: [] });
});

/** A verified RankEyeQ source over the fixture week's frozen snapshot, mirroring the SNG artifact's results (same points, DNP and played zero). */
async function rankEyeQSourceFromFixture(): Promise<VerifiedRankEyeQResultsSource> {
  const snapshot = await prisma.waiverSnapshot.findFirstOrThrow({
    where: { currentForWeekId: weekId, status: "FROZEN" },
    select: {
      id: true,
      version: true,
      entriesFingerprint: true,
      entries: {
        select: {
          rankableEntryId: true,
          position: true,
          displayNameAtFreeze: true,
          teamAtFreeze: true,
          identityProviderAtFreeze: true,
          identityExternalIdAtFreeze: true,
          rankableEntry: { select: { provider: true, externalId: true, team: true } },
        },
      },
    },
  });
  const specById = new Map(SPECS.map((spec) => [players[spec.key].id, spec]));
  const participants: RankEyeQParticipant[] = snapshot.entries.map((entry) => {
    const spec = specById.get(entry.rankableEntryId)!;
    const dnp = spec.state === VNP;
    return {
      rankableEntryId: entry.rankableEntryId,
      snapshotEntryId: `unused-${entry.rankableEntryId}`,
      provider: entry.identityProviderAtFreeze ?? entry.rankableEntry.provider,
      externalId: entry.identityExternalIdAtFreeze ?? entry.rankableEntry.externalId,
      kind: "PLAYER",
      position: entry.position as RankEyeQParticipant["position"],
      team: entry.teamAtFreeze,
      displayName: entry.displayNameAtFreeze,
      participationState: dnp ? "VERIFIED_NON_PARTICIPANT" : spec.points === 0 ? "PARTICIPATED_ZERO" : "PARTICIPATED_WITH_STATS",
      disposition: dnp ? "DNP" : "PLAYED",
      proof: dnp ? "OPERATOR_DID_NOT_PLAY_REVIEW" : spec.points === 0 ? "OPERATOR_PLAYED_ZERO_REVIEW" : "WEEK_STAT_LINE",
      pointsHundredths: dnp ? null : (spec.points ?? 0),
      gameIds: [],
      evidence: { statTable: "PlayerWeekStat", statRowId: null, statProvider: null, statScoringVersion: null, isProvisional: null, games: [], decision: null, issues: [] },
    };
  });
  return {
    sourceKind: "RANKEYEQ_FINAL_WEEK_STATS",
    schemaVersion: "rankeyeq-final-week-stats/1",
    contentChecksum: "c".repeat(64),
    seriesKey: `NFL:${base.year}:1:RANKEYEQ_FINAL_WEEK_STATS@1:FANTASYTRACK_NFL_HALF_PPR_V2`,
    scoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
    week: { id: weekId, season: base.year, weekNumber: 1 },
    waiverSnapshot: { id: snapshot.id, version: snapshot.version, entriesFingerprint: snapshot.entriesFingerprint },
    provenance: { snapshotRowId: "rankeyeq-snapshot-row-1", revision: 1, authorityBasis: "RANKEYEQ_OPERATOR_ATTESTED" },
    participants,
    ledger: indexRankEyeQResultsLedger(participants),
  } as VerifiedRankEyeQResultsSource;
}

const sng = (artifactRowId: string): WaiverGradingSource => ({ kind: "SNG_ARTIFACT", artifactRowId });

beforeAll(async () => {
  base = await createWaiverFixture("glife", { years: { min: 2001, max: 2024 } });
  for (const spec of SPECS) players[spec.key] = await base.addContractPlayer({ position: spec.position, team: spec.team, label: spec.key });
  alpha = await base.addParticipant("alpha");
  bravo = await base.addParticipant("bravo");
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

  r1 = await importRevision(1);
}, 300_000);

afterAll(async () => {
  if (weekId) await deleteWaiverFixtureGradingRows(weekId);
  await base?.cleanup();
  if (memberUserId) await prisma.user.deleteMany({ where: { id: memberUserId } });
}, 300_000);

/** Imports a synthetic artifact revision through the shipped service; `points` corrects stats. */
async function importRevision(revision: number, points: Record<string, number> = {}): Promise<string> {
  const participants: SyntheticParticipantSpec[] = [
    ...SYNTHETIC_PARTICIPANTS.filter((p) => p.position === "DEF"),
    ...SPECS.map((spec) => ({
      id: spec.key,
      position: spec.position,
      teamKey: sngTeamForRankEyeQTeam(spec.team)!.sngTeamKey,
      externalId: players[spec.key].externalId,
      name: players[spec.key].name,
      ...(spec.points !== undefined ? { points: points[spec.key] ?? spec.points } : {}),
      ...(spec.state ? { state: spec.state, disposition: spec.disposition, proof: spec.proof } : {}),
    })),
  ];
  const acceptedAt = new Date(Math.floor((Date.now() - (60 - revision) * MINUTE) / 1000) * 1000).toISOString();
  const artifactIdFor = (n: number) => `${base.suffix}-life-r${n}`;
  const sealed = buildSyntheticCanonicalArtifact({
    season: base.year,
    week: 1,
    revision,
    artifactId: artifactIdFor(revision),
    supersedesArtifactId: revision === 1 ? null : artifactIdFor(revision - 1),
    acceptedAt,
    participants,
  });
  const artifact = sealed.artifact as { artifactId: string; revision: number; payload: { acceptance: { id: string; acceptedAt: string } } };
  const request = {
    weekId,
    artifactText: sealed.bytes,
    evidence: {
      expectedContentChecksum: sealed.checksum,
      sngArtifactId: artifact.artifactId,
      sngRevision: artifact.revision,
      sngAcceptanceId: artifact.payload.acceptance.id,
      sngAcceptedAt: new Date(artifact.payload.acceptance.acceptedAt),
      attestedPublicationState: "ACCEPTED" as const,
      sourceReference: `sng-admin://fixture/${artifact.artifactId}`,
      sourceObservedAt: new Date(Date.parse(acceptedAt) + 30 * MINUTE),
    },
  };
  const preview = await previewWaiverArtifactImport(request);
  if (preview.blockers.length) throw new Error(`fixture artifact blocked: ${preview.blockers.map((b) => b.code).join(", ")}`);
  const applied = await applyWaiverArtifactImport({ ...request, adminUserId: base.adminUserId, previewFingerprint: preview.previewFingerprint, attested: true });
  return applied.artifactRowId;
}

const counts = async () => ({
  results: await prisma.waiverContestResult.count({ where: { weekId } }),
  emptyResults: await prisma.waiverEmptyPositionResult.count({ where: { weekId } }),
  runs: await prisma.waiverGradeRun.count({ where: { weekId } }),
  boardGrades: await prisma.waiverBoardGrade.count({ where: { gradeRun: { weekId } } }),
  approvals: await prisma.waiverGradeApproval.count({ where: { weekId } }),
  changes: await prisma.waiverGradeAuthorityChange.count({ where: { weekId } }),
  authority: await prisma.waiverWeekGradeAuthority.count({ where: { weekId } }),
  boardPointers: await prisma.waiverBoardGradeAuthority.count({ where: { weekId } }),
  publications: await prisma.waiverWeekGradePublication.count({ where: { weekId } }),
  audits: await prisma.adminAuditLog.count({ where: { action: { startsWith: "waivers.grading_" }, adminUserId: base.adminUserId } }),
});

async function rejectedWith(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WaiverGradingError);
  expect((error as WaiverGradingError).code).toBe(code);
}

const published = () => loadGradedWaiverBoards([weekId]);
const boardKey = (b: { universalProfileId: string; position: string }) => `${b.universalProfileId}:${b.position}`;

describe("grading lifecycle: preview → store → approve → apply → publish", () => {
  let run1: Awaited<ReturnType<typeof storeWaiverWeekGradingRun>>;
  let approval1: Awaited<ReturnType<typeof approveWaiverGradeRun>>;
  let change1: Awaited<ReturnType<typeof applyWaiverGradeAuthority>>;

  const reviewed = async (artifactRowId: string) => {
    const preview = await loadWaiverWeekGradingPreviewFromSource(prisma, { weekId, source: sng(artifactRowId) });
    expect(preview.issues).toEqual([]);
    expect(preview.status).toBe("READY");
    return preview.run!;
  };
  const storeInput = (artifactRowId: string, run: { inputFingerprint: string; outputFingerprint: string }, adminUserId = base.adminUserId) => ({
    weekId,
    source: sng(artifactRowId),
    adminUserId,
    expectedInputFingerprint: run.inputFingerprint,
    expectedOutputFingerprint: run.outputFingerprint,
  });

  it("previews without writing anything (no rows, no audit) and builds the operator review", async () => {
    const before = await counts();
    const preview = await loadWaiverWeekGradingPreviewFromSource(prisma, { weekId, source: sng(r1) });
    expect(preview.status).toBe("READY");
    expect(await counts()).toEqual(before);
    expect(before).toMatchObject({ runs: 0, approvals: 0, authority: 0, publications: 0 });

    const review = buildWaiverGradingReview(preview, new Map([[alpha.profileId, "alpha"]]));
    expect(review.positions.map((p) => [p.position, p.kind])).toEqual([
      ["QB", "CONTEST_RESULT"],
      ["RB", "CONTEST_RESULT"],
      ["WR", "CONTEST_RESULT"],
      ["TE", "CONTEST_RESULT"],
      ["DEF", "EMPTY_ELIGIBLE_POOL"],
    ]);
    expect(review.positions.find((p) => p.position === "WR")!.topFinishes.map((t) => t.poolRank)).toEqual([1, 2, 3]);
    // The DNP quarterback and the player who played for 0.00 are surfaced for review.
    expect(review.zeroPoint.rows.map((r) => [r.position, r.treatment]).sort()).toEqual([
      ["QB", "NON_PARTICIPANT_ZERO"],
      ["TE", "RANKED"],
    ]);
    expect(review.zeroPoint.rows.find((r) => r.position === "TE")!.calledBy).toBe(1);
    expect(review.boards).toMatchObject({ total: 5, zeroCall: 1 });
    expect(review.boards.top[0].profileName).toBe("alpha");
    expect(review.d3).toEqual({ applied: [], unresolved: [] });
  });

  it("the RankEyeQ source returns a real preview: BLOCKED without an accepted snapshot, READY from a matching one, never an SNG fallback, no writes", async () => {
    const rankEyeQ: WaiverGradingSource = { kind: "RANKEYEQ_SNAPSHOT", snapshotId: null };
    const before = await counts();

    const none = await loadWaiverWeekGradingPreviewFromSource(prisma, { weekId, source: rankEyeQ });
    expect(none.status).toBe("BLOCKED");
    expect(none.run).toBeNull();
    expect(none.issues.map((i) => i.code)).toEqual(["ARTIFACT_NOT_FOUND"]);

    rankeyeq.load.mockResolvedValueOnce({ ok: true, source: await rankEyeQSourceFromFixture() });
    const preview = await loadWaiverWeekGradingPreviewFromSource(prisma, { weekId, source: rankEyeQ });
    expect(preview.issues).toEqual([]);
    expect(preview.status).toBe("READY");
    expect(preview.artifact).toMatchObject({ rowId: "rankeyeq-snapshot-row-1", revision: 1 });
    expect(preview.artifact.artifactId).toBe(`rankeyeq-final-week-stats:${"c".repeat(64)}`);
    expect(preview.positions.map((p) => [p.position, p.kind])).toEqual([
      ["QB", "CONTEST_RESULT"],
      ["RB", "CONTEST_RESULT"],
      ["WR", "CONTEST_RESULT"],
      ["TE", "CONTEST_RESULT"],
      ["DEF", "EMPTY_ELIGIBLE_POOL"],
    ]);
    expect(preview.advisories.map((a) => a.code)).not.toContain("TEAM_CROSSWALK_PENDING_PRODUCER_CONFIRMATION");

    // Same facts through either source grade identically (pool rows, ranks and board scores).
    const sngPreview = await loadWaiverWeekGradingPreviewFromSource(prisma, { weekId, source: sng(r1) });
    const shape = (p: typeof preview) =>
      p.positions.flatMap((pos) => (pos.kind === "CONTEST_RESULT" ? pos.rows.map((r) => [pos.position, r.rankableEntryId, r.treatment, r.waiverPoolRank, r.fpHundredths]) : []));
    expect(shape(preview)).toEqual(shape(sngPreview));
    expect(preview.boards.map((b) => [b.board.submissionId, b.board.eyeqHundredths, b.board.awardedHonor])).toEqual(
      sngPreview.boards.map((b) => [b.board.submissionId, b.board.eyeqHundredths, b.board.awardedHonor]),
    );
    // ...but the fingerprints are the RankEyeQ source's own.
    expect(preview.run!.inputFingerprint).not.toBe(sngPreview.run!.inputFingerprint);

    // A pinned snapshot id that is not the current ACCEPTED one is refused.
    rankeyeq.load.mockResolvedValueOnce({ ok: true, source: await rankEyeQSourceFromFixture() });
    const stale = await loadWaiverWeekGradingPreviewFromSource(prisma, { weekId, source: { kind: "RANKEYEQ_SNAPSHOT", snapshotId: "older-row" } });
    expect(stale.status).toBe("BLOCKED");
    expect(stale.issues.map((i) => i.code)).toEqual(["ARTIFACT_NOT_LATEST"]);

    expect(rankeyeq.load.mock.calls.map((call) => call[1])).toEqual([weekId, weekId, weekId]);
    expect(await counts()).toEqual(before);
  });

  it("refuses stores that are unauthorized, stale or blocked, and writes nothing", async () => {
    const run = await reviewed(r1);
    const before = await counts();
    await rejectedWith(storeWaiverWeekGradingRun(storeInput(r1, run, memberUserId)), "FORBIDDEN");
    await rejectedWith(storeWaiverWeekGradingRun({ ...storeInput(r1, run), expectedOutputFingerprint: "0".repeat(64) }), "STALE");
    await rejectedWith(storeWaiverWeekGradingRun(storeInput("no-such-artifact", run)), "PREVIEW_BLOCKED");
    await rejectedWith(storeWaiverWeekGradingRun({ ...storeInput(r1, run), weekId: "no-such-week" }), "NOT_FOUND");
    await rejectedWith(storeWaiverWeekGradingRun({ ...storeInput(r1, run), source: { kind: "RANKEYEQ_SNAPSHOT", snapshotId: null } }), "SOURCE_UNSUPPORTED");
    // Refused before any source is loaded: a RankEyeQ snapshot id would break the WaiverCanonicalArtifact FK.
    expect(rankeyeq.load).not.toHaveBeenCalled();
    expect(await counts()).toEqual(before);
  });

  it("stores a versioned run: no approval, authority or publication, and nothing public", async () => {
    run1 = await storeWaiverWeekGradingRun(storeInput(r1, await reviewed(r1)));
    expect(run1).toMatchObject({ status: "STORED", runNumber: 1, boardGradeCount: 5, reusedContestResults: 0 });
    expect(await counts()).toMatchObject({ results: 4, emptyResults: 1, runs: 1, boardGrades: 5, approvals: 0, changes: 0, authority: 0, publications: 0, audits: 1 });
    expect(await published()).toEqual([]);
    const state = await loadWaiverGradingLifecycleState(weekId);
    expect(state.runs.map((r) => [r.runNumber, r.stage, r.nextAction])).toEqual([[1, "STORED", "APPROVE"]]);
    expect(state.authority).toBeNull();
  });

  it("is idempotent: storing the same preview again writes nothing", async () => {
    const before = await counts();
    const again = await storeWaiverWeekGradingRun(storeInput(r1, await reviewed(r1)));
    expect(again).toMatchObject({ status: "ALREADY_STORED", gradeRunId: run1.gradeRunId, runNumber: 1 });
    expect(await counts()).toEqual(before);
  });

  it("refuses apply and publish before their prerequisites", async () => {
    await rejectedWith(applyWaiverGradeAuthority({ approvalId: "no-such-approval", adminUserId: base.adminUserId, reason: "x" }), "NOT_FOUND");
    await rejectedWith(publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: "x", reason: "x" }), "NOT_APPLIED");
    await rejectedWith(approveWaiverGradeRun({ gradeRunId: run1.gradeRunId, adminUserId: memberUserId, expectedOutputFingerprint: run1.outputFingerprint, reason: "ok", attested: true, acknowledgeDefCrosswalk: true }), "FORBIDDEN");
  });

  it("approves only with the explicit attestations and the reviewed fingerprint; approval alone publishes nothing", async () => {
    const approve = (over: Partial<Parameters<typeof approveWaiverGradeRun>[0]> = {}) =>
      approveWaiverGradeRun({ gradeRunId: run1.gradeRunId, adminUserId: base.adminUserId, expectedOutputFingerprint: run1.outputFingerprint, reason: "reviewed zero-point players", attested: true, acknowledgeDefCrosswalk: true, ...over });
    await rejectedWith(approve({ attested: false }), "ATTESTATION_REQUIRED");
    await rejectedWith(approve({ acknowledgeDefCrosswalk: false }), "ATTESTATION_REQUIRED");
    await rejectedWith(approve({ reason: "  " }), "INVALID_INPUT");
    await rejectedWith(approve({ expectedOutputFingerprint: "f".repeat(64) }), "STALE");
    expect((await counts()).approvals).toBe(0);

    approval1 = await approve();
    expect(approval1.status).toBe("APPROVED");
    expect(await approve()).toMatchObject({ status: "ALREADY_APPROVED", approvalId: approval1.approvalId });
    expect(await counts()).toMatchObject({ approvals: 1, changes: 0, authority: 0, publications: 0 });
    expect(await published()).toEqual([]);
  });

  it("applies week-atomic CURRENT authority without publishing", async () => {
    change1 = await applyWaiverGradeAuthority({ approvalId: approval1.approvalId, adminUserId: base.adminUserId, reason: "initial grade" });
    expect(change1).toMatchObject({ status: "APPLIED", sequence: 1, changeType: "INITIAL_GRADE", unpublishedPriorPublication: false });
    expect(await counts()).toMatchObject({ changes: 1, authority: 1, boardPointers: 5, publications: 0 });
    expect(await prisma.waiverContestResultAuthority.count({ where: { weekId } })).toBe(4);
    // Applied is not published: the public leaderboard still shows nothing.
    expect(await published()).toEqual([]);
    expect(await applyWaiverGradeAuthority({ approvalId: approval1.approvalId, adminUserId: base.adminUserId, reason: "again" })).toMatchObject({ status: "ALREADY_APPLIED", changeId: change1.changeId });
    expect(await counts()).toMatchObject({ changes: 1 });
    const state = await loadWaiverGradingLifecycleState(weekId);
    expect(state.runs[0]).toMatchObject({ stage: "APPLIED", nextAction: "PUBLISH" });
    expect(state.publication).toBeNull();
  });

  it("publishes the CURRENT authority; only then do leaderboards return the graded boards", async () => {
    await rejectedWith(publishWaiverWeekGrades({ weekId, adminUserId: memberUserId, expectedChangeId: change1.changeId, reason: "go" }), "FORBIDDEN");
    await rejectedWith(publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: "stale-change", reason: "go" }), "STALE");
    await rejectedWith(publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: change1.changeId, reason: "" }), "INVALID_INPUT");
    expect(await published()).toEqual([]);

    const result = await publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: change1.changeId, reason: "official results" });
    expect(result).toMatchObject({ status: "PUBLISHED", changeId: change1.changeId, gradeRunId: run1.gradeRunId });
    expect(await publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: change1.changeId, reason: "again" })).toMatchObject({ status: "ALREADY_PUBLISHED", publicationId: result.publicationId });

    const boards = await published();
    expect(boards).toHaveLength(5);
    expect(boards.every((b) => b.weekId === weekId)).toBe(true);
    const byKey = new Map(boards.map((b) => [boardKey(b), b]));
    // alpha WR: perfect five-of-three podium order => 100.00 and three exact calls.
    expect(byKey.get(`${alpha.profileId}:WR`)).toMatchObject({ callsMade: 3, eyeqHundredths: 10000, perfectCalls: 3, totalFpHundredths: 5300 });
    // bravo's zero-call QB board is N/A (never zero) but still played over the available slots.
    expect(byKey.get(`${bravo.profileId}:QB`)).toMatchObject({ callsMade: 0, eyeqHundredths: null, perfectCalls: null, totalFpHundredths: 0, availableSlots: 3 });
    // Boards of other weeks are never returned.
    expect(await loadGradedWaiverBoards(["no-such-week"])).toEqual([]);
    expect(await loadGradedWaiverBoards([])).toEqual([]);

    expect(await counts()).toMatchObject({ publications: 1, audits: 4 });
    const actions = await prisma.adminAuditLog.findMany({ where: { adminUserId: base.adminUserId, action: { startsWith: "waivers.grading_" } }, select: { action: true } });
    expect(actions.map((a) => a.action).sort()).toEqual([
      "waivers.grading_authority_applied",
      "waivers.grading_published",
      "waivers.grading_run_approved",
      "waivers.grading_run_stored",
    ]);
    const state = await loadWaiverGradingLifecycleState(weekId);
    expect(state.runs[0].stage).toBe("PUBLISHED");
    expect(state.publication).not.toBeNull();
  });

  it("the database refuses direct publication of anything but the current applied authority, and publications are append-only", async () => {
    const authority = await prisma.waiverWeekGradeAuthority.findUniqueOrThrow({ where: { weekId } });
    const publication = await prisma.waiverWeekGradePublication.findUniqueOrThrow({ where: { changeId: authority.changeId } });
    await expect(prisma.waiverWeekGradePublication.update({ where: { id: publication.id }, data: { reason: "edited" } })).rejects.toThrow(/append-only/);
    await expect(prisma.waiverWeekGradePublication.delete({ where: { id: publication.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(
      prisma.waiverWeekGradePublication.create({
        data: { weekId, changeId: authority.changeId, gradeRunId: authority.gradeRunId, outputFingerprint: authority.outputFingerprint, publishedByUserId: base.adminUserId, reason: "dup" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.waiverWeekGradePublication.create({
        data: { weekId, changeId: "x", gradeRunId: authority.gradeRunId, outputFingerprint: authority.outputFingerprint, publishedByUserId: memberUserId, reason: "bad" },
      }),
    ).rejects.toThrow();
  });

  it("refuses a superseded source, then a regrade is unpublished until it is published again", async () => {
    r2 = await importRevision(2, { qbA: 1700 });
    const before = await counts();
    // r1 is no longer the latest revision: it cannot be stored or approved again.
    await rejectedWith(storeWaiverWeekGradingRun(storeInput(r1, { inputFingerprint: "a".repeat(64), outputFingerprint: "b".repeat(64) })), "SOURCE_SUPERSEDED");
    // A second admin approving the stored r1 run is refused: its source is superseded.
    const second = await base.addAdmin("second");
    await rejectedWith(
      approveWaiverGradeRun({ gradeRunId: run1.gradeRunId, adminUserId: second.userId, expectedOutputFingerprint: run1.outputFingerprint, reason: "ok", attested: true, acknowledgeDefCrosswalk: true }),
      "SOURCE_SUPERSEDED",
    );
    expect(await counts()).toEqual(before);

    const run2 = await storeWaiverWeekGradingRun(storeInput(r2, await reviewed(r2)));
    expect(run2).toMatchObject({ status: "STORED", runNumber: 2 });
    // A new stored run changes nothing public: run 1 stays CURRENT and published.
    expect(await published()).toHaveLength(5);
    const approval2 = await approveWaiverGradeRun({ gradeRunId: run2.gradeRunId, adminUserId: base.adminUserId, expectedOutputFingerprint: run2.outputFingerprint, reason: "regrade", attested: true, acknowledgeDefCrosswalk: true });
    expect(await published()).toHaveLength(5);

    const change2 = await applyWaiverGradeAuthority({ approvalId: approval2.approvalId, adminUserId: base.adminUserId, reason: "r2 correction" });
    expect(change2).toMatchObject({ status: "APPLIED", sequence: 2, changeType: "REGRADE", unpublishedPriorPublication: true });
    // The regrade is CURRENT but unpublished: its numbers are not public, and neither are the old ones.
    expect(await published()).toEqual([]);
    const state = await loadWaiverGradingLifecycleState(weekId);
    expect(state.runs.map((r) => [r.runNumber, r.stage])).toEqual([
      [2, "APPLIED"],
      [1, "SUPERSEDED"],
    ]);
    await rejectedWith(publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: change1.changeId, reason: "old" }), "STALE");

    await publishWaiverWeekGrades({ weekId, adminUserId: base.adminUserId, expectedChangeId: change2.changeId, reason: "official regrade" });
    const boards = await published();
    expect(boards).toHaveLength(5);
    // qbA's corrected points reorder the QB pool: alpha's [qbA, qbB] board no longer scores the same as run 1.
    const alphaQb = boards.find((b) => b.universalProfileId === alpha.profileId && b.position === "QB")!;
    expect(alphaQb.eyeqHundredths).not.toBeNull();
    const priorQb = await prisma.waiverBoardGrade.findFirstOrThrow({ where: { gradeRunId: run1.gradeRunId, submission: { universalProfileId: alpha.profileId }, position: "QB" } });
    expect(alphaQb.eyeqHundredths).not.toBe(priorQb.eyeqHundredths);
  });
});
