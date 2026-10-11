import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildSyntheticCanonicalArtifact, SYNTHETIC_PARTICIPANTS, type SyntheticParticipantSpec } from "@/lib/waivers/__fixtures__/canonical-artifact";
import { createWaiverFixture, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { deleteWaiverFixtureGradingRows } from "@/lib/waivers/__fixtures__/results";
import { overrideWaiverAiBoard } from "@/lib/waivers/ai/competitive-override";
import { sha256Utf8 } from "@/lib/waivers/ai/text";
import { applyWaiverArtifactImport, previewWaiverArtifactImport } from "@/lib/waivers/artifacts/import";
import { withdrawWaiverArtifact } from "@/lib/waivers/artifacts/withdraw";
import { detectSnapshotCanonicalConflicts } from "@/lib/waivers/canonical/policy";
import { sngTeamForRankEyeQTeam } from "@/lib/waivers/canonical/team-crosswalk";
import type { WaiverPosition } from "@/lib/waivers/constants";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { loadWaiverWeekGradingPreview } from "@/lib/waivers/grading/preview";
import {
  waiverBoardGradeCreateData,
  waiverCallGradeCreateData,
  waiverContestResultCreateData,
  waiverEmptyPositionResultCreateData,
  waiverGradeRunCreateData,
  waiverPoolResultCreateData,
} from "@/lib/waivers/grading/rows";
import type { WaiverWeekGradingPreview } from "@/lib/waivers/grading/week";
import * as fingerprints from "@/lib/waivers/results/fingerprints";
import { WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT, WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION } from "@/lib/waivers/results/model";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Stage 4B.4 end to end on the local database: contract-identity players, a
 * corrected snapshot, locked human boards and an ADMIN_COMPETITIVE_OVERRIDE AI
 * board, a synthetic artifact imported through the shipped service, a D3
 * decision, and the read-only week preview. The preview's output is then
 * written through the row builders in a test transaction so every Stage 4B.3
 * storage guard re-checks it; a corrected revision then exercises regrade
 * lineage through test-only approval and authority rows.
 */

const MINUTE = 60_000;
const CONTEST_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

type Spec = { key: string; position: (typeof CONTEST_POSITIONS)[number]; team: string } & Pick<SyntheticParticipantSpec, "points" | "state" | "disposition" | "proof" | "eventKey">;
const VNP = "VERIFIED_NON_PARTICIPANT" as const;
const SPECS: Spec[] = [
  { key: "qbA", position: "QB", team: "SF", points: 2410 },
  { key: "qbB", position: "QB", team: "SEA", points: 1800 },
  { key: "qbDnp", position: "QB", team: "LAR", state: VNP, disposition: "DNP", proof: "OFFICIAL_INACTIVE" },
  { key: "qbX", position: "QB", team: "WAS", points: 3000 },
  { key: "rbA", position: "RB", team: "SF", points: 2810 },
  { key: "rbT1", position: "RB", team: "SEA", points: 1940 },
  { key: "rbT2", position: "RB", team: "LAR", points: 1940 },
  { key: "rbCancel", position: "RB", team: "KC", state: VNP, disposition: "CANCELLED_GAME", proof: "WEEK_DISPOSITION" },
  { key: "rbBye", position: "RB", team: "GB", state: VNP, disposition: "BYE", proof: "WEEK_DISPOSITION", eventKey: null },
  // Called while scheduled on v1; the v2 correction freezes his team on bye and excludes him.
  { key: "rbByeCalled", position: "RB", team: "GB", state: VNP, disposition: "BYE", proof: "WEEK_DISPOSITION", eventKey: null },
  { key: "wrA", position: "WR", team: "SF", points: 2200 },
  { key: "wrB", position: "WR", team: "SEA", points: 1600 },
  { key: "wrC", position: "WR", team: "WAS", points: 1500 },
  { key: "wrD", position: "WR", team: "LAR", points: 1400 },
  { key: "wrE", position: "WR", team: "SF", points: 900 },
  { key: "wrF", position: "WR", team: "SEA", points: 50 },
  { key: "teA", position: "TE", team: "SF", points: 1200 },
  { key: "teNeg", position: "TE", team: "LAR", points: -120 },
  { key: "teMoved", position: "TE", team: "DAL", state: VNP, disposition: "MOVED_OUT_OF_WEEK", proof: "WEEK_DISPOSITION" },
];

let base: WaiverFixture;
let weekId: string;
let artifactRowId: string;
let v1SnapshotId: string;
let r2ArtifactRowId: string;
let run2Id: string;
const players: Record<string, { id: string; name: string; externalId: string }> = {};
const contests = {} as Record<(typeof CONTEST_POSITIONS)[number], string>;
const submissions: Record<string, string> = {};
let lockedEvidence: Awaited<ReturnType<typeof lockedEvidenceState>>;

beforeAll(async () => {
  base = await createWaiverFixture("gpreview", { years: { min: 2001, max: 2024 } });
  for (const spec of SPECS) players[spec.key] = await base.addContractPlayer({ position: spec.position, team: spec.team, label: spec.key });
  const alpha = await base.addParticipant("alpha");
  const bravo = await base.addParticipant("bravo");
  const charlie = await base.addParticipant("charlie");
  ({ weekId } = await base.addWeek());

  const rows = (excluded: string[], bye: string[] = []) =>
    SPECS.map((spec) => ({
      player: { id: players[spec.key].id, position: spec.position, name: players[spec.key].name },
      team: spec.team,
      eligibility: excluded.includes(spec.key) ? ("EXCLUDED" as const) : ("ELIGIBLE" as const),
      bye: bye.includes(spec.key),
    }));
  const v1 = await base.freezeSnapshot({ weekId, rows: rows([]) });
  for (const position of CONTEST_POSITIONS) contests[position] = (await base.createContest({ weekId, snapshotId: v1.id, position, locksInMs: 60 * MINUTE })).id;
  const submit = async (label: string, who: typeof alpha, position: (typeof CONTEST_POSITIONS)[number], keys: string[]) => {
    const result = await submitWaiverBoard({ contestId: contests[position], universalProfileId: who.profileId, userId: who.userId, playerIds: keys.map((k) => players[k].id) });
    submissions[label] = result.submissionId;
  };
  // qbX and rbByeCalled are called on v1, then the v2 correction excludes them (C2 invalidation).
  await submit("alphaQB", alpha, "QB", ["qbX", "qbA", "qbB"]);
  await submit("charlieRB", charlie, "RB", ["rbByeCalled"]);
  const v2 = await base.freezeSnapshot({ weekId, rows: rows(["qbX", "rbByeCalled"], ["rbByeCalled"]), supersedesId: v1.id });
  v1SnapshotId = v1.id;
  for (const position of CONTEST_POSITIONS) await prisma.waiverContest.update({ where: { id: contests[position] }, data: { snapshotId: v2.id } });
  await submit("bravoQB", bravo, "QB", []);
  await submit("alphaRB", alpha, "RB", ["rbA", "rbT2"]);
  await submit("bravoRB", bravo, "RB", ["rbCancel", "rbA"]);
  await submit("alphaWR", alpha, "WR", ["wrA", "wrB", "wrC", "wrD", "wrE"]);
  await submit("bravoWR", bravo, "WR", ["wrF"]);
  await submit("alphaTE", alpha, "TE", ["teA", "teNeg"]);
  await submit("bravoTE", bravo, "TE", ["teMoved"]);
  const lockAt = new Date();
  for (const position of CONTEST_POSITIONS) await base.passLock(contests[position], lockAt);
  for (const position of CONTEST_POSITIONS) await ensureWaiverContestLocked(contests[position]);

  const ai = await base.addAiCompetitor("gpreview");
  const text = `1. ${players.teA.name}\n2. ${players.teNeg.name}\n`;
  const override = await overrideWaiverAiBoard({
    adminUserId: base.adminUserId,
    contestId: contests.TE,
    universalProfileId: ai.profileId,
    responseText: text,
    expectedResponseSha256: sha256Utf8(text),
    confirmedRankableEntryIds: [players.teA.id, players.teNeg.id],
    modelLabel: "Fixture override model",
    sourceReference: null,
    allowLateSubmission: true,
  });
  submissions.aiTE = override.submissionId;

  ({ artifactRowId } = await importRevision(1));
  lockedEvidence = await lockedEvidenceState();
}, 300_000);

/** Imports a synthetic artifact revision through the shipped service; `points` corrects stats. */
async function importRevision(revision: number, points: Record<string, number> = {}) {
  // The DEF ledger rows stay in the artifact; the week has no DEF candidates.
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
      ...(spec.eventKey !== undefined ? { eventKey: spec.eventKey } : {}),
    })),
  ];
  const acceptedAt = new Date(Math.floor((Date.now() - (60 - revision) * MINUTE) / 1000) * 1000).toISOString();
  const artifactIdFor = (r: number) => `${base.suffix}-prev-r${r}`;
  const sealed = buildSyntheticCanonicalArtifact({
    season: base.year,
    week: 1,
    revision,
    artifactId: artifactIdFor(revision),
    supersedesArtifactId: revision === 1 ? null : artifactIdFor(revision - 1),
    acceptedAt,
    participants,
  });
  const sealedArtifact = sealed.artifact as { artifactId: string; revision: number; payload: { acceptance: { id: string; acceptedAt: string } } };
  const request = {
    weekId,
    artifactText: sealed.bytes,
    evidence: {
      expectedContentChecksum: sealed.checksum,
      sngArtifactId: sealedArtifact.artifactId,
      sngRevision: sealedArtifact.revision,
      sngAcceptanceId: sealedArtifact.payload.acceptance.id,
      sngAcceptedAt: new Date(sealedArtifact.payload.acceptance.acceptedAt),
      attestedPublicationState: "ACCEPTED" as const,
      sourceReference: `sng-admin://fixture/${sealedArtifact.artifactId}`,
      sourceObservedAt: new Date(Date.parse(acceptedAt) + 30 * MINUTE),
    },
  };
  const importPreview = await previewWaiverArtifactImport(request);
  if (importPreview.blockers.length) throw new Error(`fixture artifact blocked: ${importPreview.blockers.map((b) => b.code).join(", ")}`);
  const applied = await applyWaiverArtifactImport({ ...request, adminUserId: base.adminUserId, previewFingerprint: importPreview.previewFingerprint, attested: true });
  return { artifactRowId: applied.artifactRowId };
}

/** Every locked revision, call, AI response and override of the week, for before/after comparison. */
async function lockedEvidenceState() {
  return prisma.waiverSubmission.findMany({
    where: { contest: { weekId } },
    orderBy: { id: "asc" },
    include: {
      revisions: { orderBy: { id: "asc" }, include: { calls: { orderBy: { slot: "asc" } }, aiResponse: true } },
      competitiveOverride: true,
      lateEntry: true,
    },
  });
}

afterAll(async () => {
  if (weekId) await deleteWaiverFixtureGradingRows(weekId);
  await base?.cleanup();
}, 300_000);

const gradingRowCount = async () =>
  (await prisma.waiverContestResult.count({ where: { weekId } })) +
  (await prisma.waiverEmptyPositionResult.count({ where: { weekId } })) +
  (await prisma.waiverGradeRun.count({ where: { weekId } }));

/** An explicit operator D3 decision on a canonical BYE, bound to one frozen entry and one artifact revision. */
async function resolveBye(key: "rbBye" | "rbByeCalled", onArtifactRowId: string, options: { snapshotId?: string; reconfirmsResolutionId?: string | null } = {}) {
  const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: contests.RB } });
  const snapshotId = options.snapshotId ?? contest.snapshotId;
  const entry = await prisma.waiverSnapshotEntry.findUniqueOrThrow({ where: { snapshotId_rankableEntryId: { snapshotId, rankableEntryId: players[key].id } } });
  const artifact = await prisma.waiverCanonicalArtifact.findUniqueOrThrow({ where: { id: onArtifactRowId } });
  const [conflict] = detectSnapshotCanonicalConflicts({
    artifactContentChecksum: artifact.contentChecksum,
    snapshotEntryId: entry.id,
    snapshot: { isByeAtFreeze: false, teamAtFreeze: entry.teamAtFreeze },
    canonical: { participantId: key, cls: "SNAPSHOT_CONFLICT", disposition: "BYE", teamKey: "green-bay-packers" },
  });
  return prisma.waiverConflictResolution.create({
    data: {
      weekId,
      contestId: contest.id,
      position: "RB",
      snapshotId,
      snapshotEntryId: entry.id,
      artifactRowId: artifact.id,
      artifactRevision: artifact.revision,
      artifactContentChecksum: artifact.contentChecksum,
      sngParticipantId: key,
      conflictKey: conflict.conflictKey,
      conflictKind: conflict.kind,
      sequence: 1,
      reconfirmsResolutionId: options.reconfirmsResolutionId ?? null,
      resolution: "NEUTRALIZED",
      evidenceReference: `sng-admin://fixture/evidence/${key}`,
      reason: "fixture D3 decision: team was on bye",
      inputFingerprint: fingerprints.conflictResolutionInputFingerprint({
        artifactFingerprint: fingerprints.artifactIdentityFingerprint({
          seriesKey: artifact.seriesKey,
          revision: artifact.revision,
          artifactId: artifact.artifactId,
          contentChecksum: artifact.contentChecksum,
        }),
        position: "RB",
        conflictKey: conflict.conflictKey,
        conflictKind: conflict.kind,
        snapshotEntryId: entry.id,
        sngParticipantId: key,
      }),
      resolvedByUserId: base.adminUserId,
    },
  });
}

/** Test-only storage of a preview through the row builders (no service exists yet); regrades get new result versions. */
async function storePreview(preview: WaiverWeekGradingPreview) {
  return prisma.$transaction(
    async (tx) => {
      const contestResultIds: Partial<Record<WaiverPosition, string>> = {};
      const emptyPositionResultIds: Partial<Record<WaiverPosition, string>> = {};
      const poolIds = new Map<string, Map<string, string>>();
      for (const position of preview.positions) {
        if (position.kind === "EMPTY_ELIGIBLE_POOL") {
          const { weekId: w, position: p, snapshotId } = position.emptyResult;
          const existing = await tx.waiverEmptyPositionResult.findUnique({ where: { weekId_position_snapshotId: { weekId: w, position: p, snapshotId } } });
          emptyPositionResultIds[position.position] = (existing ?? (await tx.waiverEmptyPositionResult.create({ data: waiverEmptyPositionResultCreateData(position.emptyResult) }))).id;
        } else if (position.kind === "CONTEST_RESULT") {
          const latest = await tx.waiverContestResult.aggregate({ where: { contestId: position.contestId }, _max: { resultVersion: true } });
          const result = await tx.waiverContestResult.create({ data: waiverContestResultCreateData(position.result, (latest._max.resultVersion ?? 0) + 1) });
          await tx.waiverPoolResult.createMany({ data: waiverPoolResultCreateData(position.rows, result.id) });
          const stored = await tx.waiverPoolResult.findMany({ where: { contestResultId: result.id }, select: { id: true, rankableEntryId: true } });
          poolIds.set(position.position, new Map(stored.map((row) => [row.rankableEntryId, row.id])));
          contestResultIds[position.position] = result.id;
        }
      }
      const lastRun = await tx.waiverGradeRun.aggregate({ where: { weekId }, _max: { runNumber: true } });
      const run = await tx.waiverGradeRun.create({
        data: waiverGradeRunCreateData(preview.run!, {
          weekId,
          runNumber: (lastRun._max.runNumber ?? 0) + 1,
          artifactRowId: preview.artifact.rowId,
          artifactContentChecksum: preview.artifact.contentChecksum,
          contestResultIds,
          emptyPositionResultIds,
          initiatedByUserId: base.adminUserId,
        }),
      });
      for (const grade of preview.boards) {
        const board = await tx.waiverBoardGrade.create({
          data: waiverBoardGradeCreateData(grade, { gradeRunId: run.id, contestResultId: contestResultIds[grade.board.position]! }),
        });
        const calls = waiverCallGradeCreateData(grade, { boardGradeId: board.id, poolResultIdByEntry: poolIds.get(grade.board.position)! });
        if (calls.length) await tx.waiverCallGrade.createMany({ data: calls });
      }
      return run;
    },
    { maxWait: 10_000, timeout: 300_000 },
  );
}

/**
 * Test-only approval and authority move for a stored run, so regrade lineage can be
 * checked against the storage guards. The official approval workflow is out of scope.
 */
async function approveAndApply(gradeRunId: string) {
  return prisma.$transaction(
    async (tx) => {
      const run = await tx.waiverGradeRun.findUniqueOrThrow({ where: { id: gradeRunId }, include: { boardGrades: { orderBy: { submissionId: "asc" } } } });
      const artifact = await tx.waiverCanonicalArtifact.findUniqueOrThrow({ where: { id: run.artifactRowId } });
      const approval = await tx.waiverGradeApproval.create({
        data: {
          weekId,
          gradeRunId,
          artifactRowId: artifact.id,
          artifactRevision: artifact.revision,
          artifactContentChecksum: artifact.contentChecksum,
          snapshotSetFingerprint: run.snapshotSetFingerprint,
          resolutionSetFingerprint: run.resolutionSetFingerprint,
          inputFingerprint: run.inputFingerprint,
          outputFingerprint: run.outputFingerprint,
          defCrosswalkVersion: artifact.defCrosswalkVersion,
          defCrosswalkAcknowledged: true,
          approvalPolicy: "SINGLE_ADMIN_EXPLICIT",
          approvedByUserId: base.adminUserId,
          artifactImportedByUserId: artifact.importedByUserId,
          gradeRunInitiatedByUserId: run.initiatedByUserId,
          attestationVersion: WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION,
          attestationText: WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT,
          reason: "test grading approval",
        },
      });
      const last = await tx.waiverGradeAuthorityChange.findFirst({ where: { weekId }, orderBy: { sequence: "desc" } });
      const change = await tx.waiverGradeAuthorityChange.create({
        data: {
          weekId,
          sequence: (last?.sequence ?? 0) + 1,
          changeType: last ? "REGRADE" : "INITIAL_GRADE",
          priorChangeId: last?.id ?? null,
          priorGradeRunId: last?.newGradeRunId ?? null,
          newGradeRunId: run.id,
          approvalId: approval.id,
          approvedByUserId: approval.approvedByUserId,
          reason: last ? "test regrade" : "test initial grade",
          inputFingerprint: run.inputFingerprint,
          outputFingerprint: run.outputFingerprint,
        },
      });
      const pointer = { gradeRunId: run.id, changeId: change.id };
      await tx.waiverWeekGradeAuthority.upsert({ where: { weekId }, create: { weekId, ...pointer, outputFingerprint: run.outputFingerprint }, update: { ...pointer, outputFingerprint: run.outputFingerprint } });
      const resultIds = { QB: run.qbContestResultId, RB: run.rbContestResultId, WR: run.wrContestResultId, TE: run.teContestResultId };
      for (const position of CONTEST_POSITIONS) {
        const contestResultId = resultIds[position]!;
        const data = { weekId, contestResultId, artifactRowId: run.artifactRowId, ...pointer };
        await tx.waiverContestResultAuthority.upsert({ where: { contestId: contests[position] }, create: { contestId: contests[position], ...data }, update: data });
      }
      for (const board of run.boardGrades) {
        const data = { weekId, contestId: board.contestId, boardGradeId: board.id, ...pointer };
        await tx.waiverBoardGradeAuthority.upsert({ where: { submissionId: board.submissionId }, create: { submissionId: board.submissionId, ...data }, update: data });
      }
      return change;
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

/** A stored run with every row it owns, for byte-level before/after comparison. */
async function storedRunState(gradeRunId: string) {
  return prisma.waiverGradeRun.findUniqueOrThrow({
    where: { id: gradeRunId },
    include: {
      boardGrades: { orderBy: { submissionId: "asc" }, include: { callGrades: { orderBy: { slot: "asc" } } } },
      qbContestResult: { include: { poolResults: { orderBy: { rankableEntryId: "asc" } } } },
      rbContestResult: { include: { poolResults: { orderBy: { rankableEntryId: "asc" } } } },
      wrContestResult: { include: { poolResults: { orderBy: { rankableEntryId: "asc" } } } },
      teContestResult: { include: { poolResults: { orderBy: { rankableEntryId: "asc" } } } },
      defEmptyPositionResult: true,
      approvals: { orderBy: { id: "asc" } },
    },
  });
}

const boardOf = (preview: WaiverWeekGradingPreview, label: string) => preview.boards.find((b) => b.board.submissionId === submissions[label])!;

describe("week grading preview (local database, end to end)", () => {
  it("blocks on the unresolved BYE conflicts and writes nothing", async () => {
    const preview = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId });
    expect(preview.status).toBe("BLOCKED");
    expect(preview.run).toBeNull();
    // The eligible RB on its pinned entry; the invalidated RB on the scheduled entry his board originally called.
    const pinnedRb = await prisma.waiverContest.findUniqueOrThrow({ where: { id: contests.RB } });
    const entryOf = async (key: string, snapshotId: string) =>
      (await prisma.waiverSnapshotEntry.findUniqueOrThrow({ where: { snapshotId_rankableEntryId: { snapshotId, rankableEntryId: players[key].id } } })).id;
    expect(preview.issues.map((i) => [i.code, i.position, i.snapshotEntryId]).sort()).toEqual(
      [
        ["UNRESOLVED_SNAPSHOT_CONFLICT", "RB", await entryOf("rbBye", pinnedRb.snapshotId)],
        ["UNRESOLVED_SNAPSHOT_CONFLICT", "RB", await entryOf("rbByeCalled", v1SnapshotId)],
      ].sort(),
    );
    const missing = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId: "no-such-artifact" });
    expect([missing.status, missing.run, missing.boards, missing.issues.map((i) => i.code)]).toEqual(["BLOCKED", null, [], ["ARTIFACT_NOT_FOUND"]]);
    expect(await gradingRowCount()).toBe(0);
  });

  it("grades every locked board with the approved rules once the D3 decisions exist", async () => {
    await resolveBye("rbBye", artifactRowId);
    // The corrected entry is frozen on bye, so storage refuses a BYE decision there; it binds to the called entry.
    await expect(resolveBye("rbByeCalled", artifactRowId)).rejects.toThrow(/BYE_VS_SCHEDULED requires a frozen entry with a scheduled game/);
    const calledDecision = await resolveBye("rbByeCalled", artifactRowId, { snapshotId: v1SnapshotId });
    const preview = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId });
    expect(preview.issues).toEqual([]);
    expect(preview.status).toBe("READY");
    expect(preview.positions.map((p) => [p.position, p.kind])).toEqual([
      ["QB", "CONTEST_RESULT"],
      ["RB", "CONTEST_RESULT"],
      ["WR", "CONTEST_RESULT"],
      ["TE", "CONTEST_RESULT"],
      ["DEF", "EMPTY_ELIGIBLE_POOL"],
    ]);
    const pools = Object.fromEntries(preview.positions.flatMap((p) => (p.kind === "CONTEST_RESULT" ? [[p.position, { ...p.pool, slots: p.result.effectiveAvailableSlots, honorSlots: p.honorScoreableSlots }]] : [])));
    expect(pools).toEqual({
      QB: { ranked: 2, nonParticipantZero: 1, neutralized: 0, invalidated: 1, slots: 3, honorSlots: 3 },
      RB: { ranked: 3, nonParticipantZero: 0, neutralized: 3, invalidated: 1, slots: 3, honorSlots: 3 },
      WR: { ranked: 6, nonParticipantZero: 0, neutralized: 0, invalidated: 0, slots: 5, honorSlots: 5 },
      TE: { ranked: 2, nonParticipantZero: 0, neutralized: 1, invalidated: 0, slots: 3, honorSlots: 2 },
    });
    const rb = preview.positions.find((p) => p.position === "RB");
    const pinnedRb = await prisma.waiverContest.findUniqueOrThrow({ where: { id: contests.RB } });
    const pinnedByeEntry = await prisma.waiverSnapshotEntry.findUniqueOrThrow({
      where: { snapshotId_rankableEntryId: { snapshotId: pinnedRb.snapshotId, rankableEntryId: players.rbByeCalled.id } },
    });
    expect(rb?.kind === "CONTEST_RESULT" && rb.rows.find((row) => row.rankableEntryId === players.rbByeCalled.id)).toMatchObject({
      category: "INVALIDATED_CALLED_PLAYER",
      snapshotEntryId: pinnedByeEntry.id,
      treatment: "NEUTRALIZED",
      neutralizationPrecedence: "D3_NEUTRALIZATION_OVER_C2_INVALIDATION",
      conflictResolutionId: calledDecision.id,
    });

    const view = (label: string) => {
      const { board, calls } = boardOf(preview, label);
      return { kind: board.resultKind, eyeq: board.eyeqHundredths, honor: board.awardedHonor, fpPerCall: board.fpPerCallHundredths, fpPerSlot: board.fpPerAvailableSlotHundredths, outcomes: calls.map((c) => c.outcome) };
    };
    // Invalidated 0 + (10 + 3 - 1) + (10 + 3 - 1) = 24 of 84 -> 28.57.
    expect(view("alphaQB")).toEqual({ kind: "SCORED", eyeq: 2857, honor: null, fpPerCall: 1403, fpPerSlot: 1403, outcomes: ["INVALIDATED_PRE_LOCK", "IN_RESULT_FIELD", "IN_RESULT_FIELD"] });
    expect(view("bravoQB")).toEqual({ kind: "NA_ZERO_CALL", eyeq: null, honor: null, fpPerCall: null, fpPerSlot: 0, outcomes: [] });
    expect(view("alphaRB")).toEqual({ kind: "SCORED", eyeq: 9000, honor: "PERFECT_CALL", fpPerCall: 2375, fpPerSlot: 1583, outcomes: ["EXACT", "EXACT"] });
    expect(view("bravoRB")).toEqual({ kind: "SCORED", eyeq: 3643, honor: null, fpPerCall: 2810, fpPerSlot: 1405, outcomes: ["NEUTRALIZED", "IN_RESULT_FIELD"] });
    expect(view("charlieRB")).toEqual({ kind: "NA_ALL_NEUTRALIZED", eyeq: null, honor: null, fpPerCall: null, fpPerSlot: null, outcomes: ["NEUTRALIZED"] });
    expect(view("alphaWR")).toEqual({ kind: "SCORED", eyeq: 10000, honor: "PERFECT_FIVE", fpPerCall: 1520, fpPerSlot: 1520, outcomes: Array(5).fill("EXACT") });
    expect(view("bravoWR")).toEqual({ kind: "SCORED", eyeq: 0, honor: null, fpPerCall: 50, fpPerSlot: 10, outcomes: ["OUTSIDE_RESULT_FIELD"] });
    // The moved TE leaves two scoreable slots: both exact is a PERFECT PODIUM; coverage stays 2 of 3.
    expect(view("alphaTE")).toEqual({ kind: "SCORED", eyeq: 9000, honor: "PERFECT_PODIUM", fpPerCall: 540, fpPerSlot: 360, outcomes: ["EXACT", "EXACT"] });
    expect(view("bravoTE")).toEqual({ kind: "NA_ALL_NEUTRALIZED", eyeq: null, honor: null, fpPerCall: null, fpPerSlot: null, outcomes: ["NEUTRALIZED"] });

    // The ADMIN_COMPETITIVE_OVERRIDE AI board is graded exactly like the human board with the same calls.
    const ai = boardOf(preview, "aiTE");
    const human = boardOf(preview, "alphaTE");
    expect(ai.competitor).toMatchObject({ profileType: "AI", authority: "SYSTEM_OPERATED", entryBasis: "ADMIN_COMPETITIVE_OVERRIDE" });
    expect(ai.board.outputFingerprint).toBe(human.board.outputFingerprint);
    expect(preview.summary).toMatchObject({
      boards: 10,
      byResultKind: { SCORED: 7, NA_ZERO_CALL: 1, NA_ALL_NEUTRALIZED: 2 },
      byHonor: { NONE: 6, PERFECT_CALL: 1, PERFECT_FIVE: 1, PERFECT_PODIUM: 2 },
      byEntryBasis: { STANDARD: 9, ADMIN_COMPETITIVE_OVERRIDE: 1 },
    });
    expect(await gradingRowCount()).toBe(0);

    // Reproducible: a second dry run is identical.
    expect(await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId })).toEqual(preview);
  });

  it("produces rows every storage guard accepts, and recognizes them as already stored", async () => {
    const preview = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId });
    const run = await storePreview(preview);
    const stored = await prisma.waiverBoardGrade.findMany({ where: { gradeRunId: run.id }, select: { submissionId: true, awardedHonor: true, eyeqHundredths: true, outputFingerprint: true } });
    expect(stored).toHaveLength(10);
    const storedBye = await prisma.waiverPoolResult.findFirstOrThrow({
      where: { contestResultId: run.rbContestResultId!, rankableEntryId: players.rbByeCalled.id },
      include: { conflictResolution: { include: { snapshotEntry: true } } },
    });
    expect([storedBye.treatment, storedBye.neutralizationPrecedence, storedBye.conflictResolution?.snapshotEntry.snapshotId]).toEqual([
      "NEUTRALIZED",
      "D3_NEUTRALIZATION_OVER_C2_INVALIDATION",
      v1SnapshotId,
    ]);
    for (const grade of preview.boards) {
      expect(stored.find((s) => s.submissionId === grade.board.submissionId)).toEqual({
        submissionId: grade.board.submissionId,
        awardedHonor: grade.board.awardedHonor,
        eyeqHundredths: grade.board.eyeqHundredths,
        outputFingerprint: grade.board.outputFingerprint,
      });
    }
    expect(await prisma.waiverGradeApproval.count({ where: { weekId } })).toBe(0);
    expect(await prisma.waiverWeekGradeAuthority.count({ where: { weekId } })).toBe(0);

    const again = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId });
    expect(again.run).toEqual(preview.run);
    const stores = again.advisories.filter((a) => a.code === "CONTEST_RESULT_ALREADY_STORED" || a.code === "GRADE_RUN_ALREADY_STORED");
    expect(stores).toHaveLength(5);
    expect(stores.every((a) => / and the same (result|output)$/.test(a.detail))).toBe(true);
  });

  it("regrades a corrected artifact as new versions, keeps run 1 and its authority intact, and never touches locked boards", async () => {
    const run1 = await prisma.waiverGradeRun.findUniqueOrThrow({ where: { weekId_runNumber: { weekId, runNumber: 1 } } });
    const change1 = await approveAndApply(run1.id);
    const run1Before = await storedRunState(run1.id);
    const change1Before = await prisma.waiverGradeAuthorityChange.findUniqueOrThrow({ where: { id: change1.id } });

    // SNG corrects wrE from 9.00 to 14.50 points: wrE and wrD swap places 4 and 5.
    const r2 = await importRevision(2, { wrE: 1450 });
    const stale = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId });
    expect(stale.status).toBe("BLOCKED");
    expect(stale.run).toBeNull();
    expect(stale.issues.map((i) => i.code)).toContain("ARTIFACT_NOT_LATEST");

    // Revision 1 D3 decisions are never carried forward automatically.
    const unconfirmed = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId: r2.artifactRowId });
    expect(unconfirmed.issues.map((i) => [i.code, i.position])).toEqual([
      ["UNRESOLVED_SNAPSHOT_CONFLICT", "RB"],
      ["UNRESOLVED_SNAPSHOT_CONFLICT", "RB"],
    ]);
    const r1Decisions = await prisma.waiverConflictResolution.findMany({ where: { artifactRowId }, orderBy: { id: "asc" } });
    expect(r1Decisions).toHaveLength(2);
    for (const decision of r1Decisions) {
      await resolveBye(decision.sngParticipantId as "rbBye" | "rbByeCalled", r2.artifactRowId, { snapshotId: decision.snapshotId, reconfirmsResolutionId: decision.id });
    }

    const preview = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId: r2.artifactRowId });
    expect(preview.issues).toEqual([]);
    expect(preview.run!.inputFingerprint).not.toBe(run1.inputFingerprint);
    // 35 + 30 + 25 + (10 + 5 - 1) + (10 + 5 - 1) = 118 of 120 -> 98.33; no longer a PERFECT FIVE.
    const { board, calls } = boardOf(preview, "alphaWR");
    expect([board.eyeqHundredths, board.awardedHonor, calls.map((c) => c.outcome)]).toEqual([9833, null, ["EXACT", "EXACT", "EXACT", "IN_RESULT_FIELD", "IN_RESULT_FIELD"]]);

    const run2 = await storePreview(preview);
    expect(run2.runNumber).toBe(2);
    const versions = await prisma.waiverContestResult.findMany({ where: { weekId }, select: { position: true, resultVersion: true, artifactRowId: true } });
    expect(versions.map((v) => `${v.position} v${v.resultVersion} r${v.artifactRowId === r2.artifactRowId ? 2 : 1}`).sort()).toEqual(
      CONTEST_POSITIONS.flatMap((p) => [`${p} v1 r1`, `${p} v2 r2`]).sort(),
    );
    expect(await prisma.waiverEmptyPositionResult.count({ where: { weekId } })).toBe(1);

    const change2 = await approveAndApply(run2.id);
    expect(change2).toMatchObject({ sequence: 2, changeType: "REGRADE", priorChangeId: change1.id, priorGradeRunId: run1.id, newGradeRunId: run2.id });
    expect(await prisma.waiverWeekGradeAuthority.findUniqueOrThrow({ where: { weekId } })).toMatchObject({ gradeRunId: run2.id, changeId: change2.id });
    const wrAuthority = await prisma.waiverBoardGradeAuthority.findUniqueOrThrow({ where: { submissionId: submissions.alphaWR }, include: { boardGrade: true } });
    expect([wrAuthority.gradeRunId, wrAuthority.boardGrade.eyeqHundredths]).toEqual([run2.id, 9833]);

    // Run 1, its result rows, grades, approval and authority change are unchanged.
    expect(await storedRunState(run1.id)).toEqual(run1Before);
    expect(await prisma.waiverGradeAuthorityChange.findUniqueOrThrow({ where: { id: change1.id } })).toEqual(change1Before);
    const run1Wr = run1Before.boardGrades.find((g) => g.submissionId === submissions.alphaWR)!;
    expect([run1Wr.eyeqHundredths, run1Wr.awardedHonor]).toEqual([10000, "PERFECT_FIVE"]);

    // Grading never alters locked revisions, calls, AI responses or overrides.
    expect(await lockedEvidenceState()).toEqual(lockedEvidence);
    r2ArtifactRowId = r2.artifactRowId;
    run2Id = run2.id;
  });

  it("rejects an artifact of another week and a withdrawn artifact, leaving stored grades untouched", async () => {
    const other = await base.addWeek();
    const foreign = await loadWaiverWeekGradingPreview(prisma, { weekId: other.weekId, artifactRowId: r2ArtifactRowId });
    expect([foreign.status, foreign.run, foreign.boards]).toEqual(["BLOCKED", null, []]);
    expect(foreign.issues.map((i) => i.code)).toContain("ARTIFACT_WEEK_MISMATCH");

    const run2Before = await storedRunState(run2Id);
    const authorityBefore = await prisma.waiverWeekGradeAuthority.findUniqueOrThrow({ where: { weekId } });
    await withdrawWaiverArtifact({
      artifactRowId: r2ArtifactRowId,
      adminUserId: base.adminUserId,
      expectedSequence: 1,
      attested: true,
      reason: "fixture withdrawal",
      sourceReference: "sng-admin://fixture/withdrawn",
      sourceObservedAt: new Date(Date.now() - 60_000),
    });
    const withdrawn = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId: r2ArtifactRowId });
    expect([withdrawn.status, withdrawn.run]).toEqual(["BLOCKED", null]);
    expect(withdrawn.issues.map((i) => i.code)).toContain("ARTIFACT_NOT_ACCEPTED");
    expect(await storedRunState(run2Id)).toEqual(run2Before);
    expect(await prisma.waiverWeekGradeAuthority.findUniqueOrThrow({ where: { weekId } })).toEqual(authorityBefore);
    expect(await lockedEvidenceState()).toEqual(lockedEvidence);
  });
});
