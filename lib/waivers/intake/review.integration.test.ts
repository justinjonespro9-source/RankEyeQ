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
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { loadWaiverWeekGradingPreview } from "@/lib/waivers/grading/preview";
import { loadWaiverResultsIntake } from "@/lib/waivers/intake/review";
import * as fingerprints from "@/lib/waivers/results/fingerprints";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Stage 4B.5A on the local database: the grading preview's week (a corrected
 * snapshot, an invalidated called player, two canonical BYE conflicts, locked
 * boards) reviewed by results intake. Intake must list exactly the D3
 * decisions the preview blocks on, run inside a read-only transaction, and
 * refuse later-superseded or withdrawn revisions.
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
  { key: "rbCancel", position: "RB", team: "KC", state: VNP, disposition: "CANCELLED_GAME", proof: "WEEK_DISPOSITION" },
  { key: "rbBye", position: "RB", team: "GB", state: VNP, disposition: "BYE", proof: "WEEK_DISPOSITION", eventKey: null },
  { key: "rbByeCalled", position: "RB", team: "GB", state: VNP, disposition: "BYE", proof: "WEEK_DISPOSITION", eventKey: null },
  { key: "wrA", position: "WR", team: "SF", points: 2200 },
  { key: "wrB", position: "WR", team: "SEA", points: 1600 },
  { key: "teA", position: "TE", team: "SF", points: 1200 },
  { key: "teMoved", position: "TE", team: "DAL", state: VNP, disposition: "MOVED_OUT_OF_WEEK", proof: "WEEK_DISPOSITION" },
];

let base: WaiverFixture;
let weekId: string;
let artifactRowId: string;
let v1SnapshotId: string;
let pendingFingerprint: string;
let aiProfileId: string;
let aiSubmissionId: string;
const players: Record<string, { id: string; name: string; externalId: string }> = {};
const contests = {} as Record<(typeof CONTEST_POSITIONS)[number], string>;
let lockedEvidence: Awaited<ReturnType<typeof lockedEvidenceState>>;

beforeAll(async () => {
  base = await createWaiverFixture("intake", { years: { min: 2001, max: 2024 } });
  for (const spec of SPECS) players[spec.key] = await base.addContractPlayer({ position: spec.position, team: spec.team, label: spec.key });
  const alpha = await base.addParticipant("alpha");
  const bravo = await base.addParticipant("bravo");
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
  const submit = (who: typeof alpha, position: (typeof CONTEST_POSITIONS)[number], keys: string[]) =>
    submitWaiverBoard({ contestId: contests[position], universalProfileId: who.profileId, userId: who.userId, playerIds: keys.map((k) => players[k].id) });
  await submit(alpha, "QB", ["qbX", "qbA"]);
  await submit(bravo, "RB", ["rbByeCalled", "rbA"]);
  const v2 = await base.freezeSnapshot({ weekId, rows: rows(["qbX", "rbByeCalled"], ["rbByeCalled"]), supersedesId: v1.id });
  v1SnapshotId = v1.id;
  for (const position of CONTEST_POSITIONS) await prisma.waiverContest.update({ where: { id: contests[position] }, data: { snapshotId: v2.id } });
  await submit(alpha, "RB", ["rbA", "rbT1"]);
  await submit(alpha, "WR", ["wrA", "wrB"]);
  await submit(alpha, "TE", ["teA"]);
  const lockAt = new Date();
  for (const position of CONTEST_POSITIONS) await base.passLock(contests[position], lockAt);
  for (const position of CONTEST_POSITIONS) await ensureWaiverContestLocked(contests[position]);

  const ai = await base.addAiCompetitor("intake");
  aiProfileId = ai.profileId;
  const text = `1. ${players.teA.name}\n2. ${players.teMoved.name}\n`;
  aiSubmissionId = (
    await overrideWaiverAiBoard({
      adminUserId: base.adminUserId,
      contestId: contests.TE,
      universalProfileId: ai.profileId,
      responseText: text,
      expectedResponseSha256: sha256Utf8(text),
      confirmedRankableEntryIds: [players.teA.id, players.teMoved.id],
      modelLabel: "Fixture override model",
      sourceReference: null,
      allowLateSubmission: true,
    })
  ).submissionId;

  ({ artifactRowId } = await importRevision(1));
  lockedEvidence = await lockedEvidenceState();
}, 300_000);

afterAll(async () => {
  if (weekId) await deleteWaiverFixtureGradingRows(weekId);
  await base?.cleanup();
}, 300_000);

/** Imports a synthetic artifact revision through the shipped import service. */
async function importRevision(revision: number) {
  const participants: SyntheticParticipantSpec[] = [
    ...SYNTHETIC_PARTICIPANTS.filter((p) => p.position === "DEF"),
    ...SPECS.map((spec) => ({
      id: spec.key,
      position: spec.position,
      teamKey: sngTeamForRankEyeQTeam(spec.team)!.sngTeamKey,
      externalId: players[spec.key].externalId,
      name: players[spec.key].name,
      ...(spec.points !== undefined ? { points: spec.points + revision - 1 } : {}),
      ...(spec.state ? { state: spec.state, disposition: spec.disposition, proof: spec.proof } : {}),
      ...(spec.eventKey !== undefined ? { eventKey: spec.eventKey } : {}),
    })),
  ];
  const acceptedAt = new Date(Math.floor((Date.now() - (60 - revision) * MINUTE) / 1000) * 1000).toISOString();
  const artifactIdFor = (r: number) => `${base.suffix}-intake-r${r}`;
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

async function lockedEvidenceState() {
  return prisma.waiverSubmission.findMany({
    where: { contest: { weekId } },
    orderBy: { id: "asc" },
    include: { revisions: { orderBy: { id: "asc" }, include: { calls: { orderBy: { slot: "asc" } } } } },
  });
}

/** Every row a later grading, approval or D3 step would write, plus the artifact publication history. */
async function writableRowCounts() {
  return {
    resolutions: await prisma.waiverConflictResolution.count({ where: { weekId } }),
    contestResults: await prisma.waiverContestResult.count({ where: { weekId } }),
    emptyResults: await prisma.waiverEmptyPositionResult.count({ where: { weekId } }),
    runs: await prisma.waiverGradeRun.count({ where: { weekId } }),
    approvals: await prisma.waiverGradeApproval.count({ where: { weekId } }),
    authority: await prisma.waiverWeekGradeAuthority.count({ where: { weekId } }),
    artifactEvents: await prisma.waiverCanonicalArtifactEvent.count({ where: { artifact: { weekId } } }),
    audit: await prisma.adminAuditLog.count(),
  };
}

const entryOf = async (key: string, snapshotId: string) =>
  (await prisma.waiverSnapshotEntry.findUniqueOrThrow({ where: { snapshotId_rankableEntryId: { snapshotId, rankableEntryId: players[key].id } } })).id;

/** Test-only operator D3 decision (no recording service exists yet). */
async function resolveBye(key: "rbBye" | "rbByeCalled", onArtifactRowId: string, snapshotId: string) {
  const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: contests.RB } });
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

describe("results intake review (local database, end to end)", () => {
  it("reviews the stored artifact inside a read-only transaction and lists the D3 decisions the preview blocks on", async () => {
    const before = await writableRowCounts();
    const readOnly = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return loadWaiverResultsIntake(tx, artifactRowId);
    });
    expect(readOnly).not.toBeNull();
    const intake = readOnly!;
    expect(intake.issues).toEqual([]);
    expect(intake.status).toBe("D3_DECISIONS_REQUIRED");
    expect(intake.artifact).toMatchObject({ rowId: artifactRowId, revision: 1, latestState: "ACCEPTED", gradable: true, contentVerified: true });
    expect(intake.positions.map((p) => [p.position, p.kind, p.eligiblePoolSize, p.invalidatedCalledCount, p.matchedCount, p.rows.length])).toEqual([
      ["QB", "CONTEST", 3, 1, 4, 4],
      ["RB", "CONTEST", 4, 1, 5, 5],
      ["WR", "CONTEST", 2, 0, 2, 2],
      ["TE", "CONTEST", 2, 0, 2, 2],
      ["DEF", "EMPTY_ELIGIBLE_POOL", 0, 0, 0, 0],
    ]);
    expect(intake.positions.map((p) => [p.position, p.lockedBoardCount, p.lockedBoards])).toEqual([
      ["QB", 1, { human: 1, nonHuman: 0, adminOverride: 0, aiLateEntry: 0, inactiveNonHuman: 0 }],
      ["RB", 2, { human: 2, nonHuman: 0, adminOverride: 0, aiLateEntry: 0, inactiveNonHuman: 0 }],
      ["WR", 1, { human: 1, nonHuman: 0, adminOverride: 0, aiLateEntry: 0, inactiveNonHuman: 0 }],
      ["TE", 2, { human: 1, nonHuman: 1, adminOverride: 1, aiLateEntry: 0, inactiveNonHuman: 0 }],
      ["DEF", 0, { human: 0, nonHuman: 0, adminOverride: 0, aiLateEntry: 0, inactiveNonHuman: 0 }],
    ]);
    expect(await prisma.waiverSubmission.count({ where: { contest: { weekId }, lockedRevisionId: { not: null } } })).toBe(6);
    expect(intake.acknowledgmentsRequired.map((a) => a.code)).toEqual(["OPERATOR_ATTESTED_AUTHORITY"]);

    // Parity: intake's open decisions are exactly the conflicts the grading preview refuses to grade past.
    const preview = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId });
    const pinned = (await prisma.waiverContest.findUniqueOrThrow({ where: { id: contests.RB } })).snapshotId;
    const open = intake.positions.flatMap((p) => p.conflicts.filter((c) => c.status === "DECISION_REQUIRED").map((c) => [p.position, c.snapshotEntryId]));
    expect(open.sort()).toEqual([["RB", await entryOf("rbBye", pinned)], ["RB", await entryOf("rbByeCalled", v1SnapshotId)]].sort());
    expect(preview.issues.filter((i) => i.code === "UNRESOLVED_SNAPSHOT_CONFLICT").map((i) => [i.position, i.snapshotEntryId]).sort()).toEqual(open.sort());

    expect(await loadWaiverResultsIntake(prisma, artifactRowId)).toEqual(intake);
    expect(await loadWaiverResultsIntake(prisma, "no-such-artifact")).toBeNull();
    expect(await writableRowCounts()).toEqual(before);
    expect(await lockedEvidenceState()).toEqual(lockedEvidence);
    pendingFingerprint = intake.intakeFingerprint;
  });

  it("is ready for the grading preview once both D3 decisions exist, in step with the preview", async () => {
    const byeDecision = await resolveBye("rbBye", artifactRowId, (await prisma.waiverContest.findUniqueOrThrow({ where: { id: contests.RB } })).snapshotId);
    const calledDecision = await resolveBye("rbByeCalled", artifactRowId, v1SnapshotId);
    const intake = (await loadWaiverResultsIntake(prisma, artifactRowId))!;
    expect([intake.status, intake.decisionsRequired, intake.decisionsResolved, intake.issues]).toEqual(["READY_FOR_GRADING_PREVIEW", 0, 2, []]);
    expect(intake.positions[1].conflicts.map((c) => c.resolution?.id).sort()).toEqual([byeDecision.id, calledDecision.id].sort());
    expect(intake.intakeFingerprint).not.toBe(pendingFingerprint);
    const preview = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId });
    expect(preview.status).toBe("READY");
    expect(preview.boards.length).toBe(intake.positions.reduce((n, p) => n + p.lockedBoardCount, 0));
    expect(await prisma.waiverGradeRun.count({ where: { weekId } })).toBe(0);
  });

  it("keeps reviewing an inactive AI's admin competitive override board, as the preview grades it", async () => {
    await prisma.universalProfile.update({ where: { id: aiProfileId }, data: { competitorActive: false } });
    try {
      const intake = (await loadWaiverResultsIntake(prisma, artifactRowId))!;
      expect(intake.status).toBe("READY_FOR_GRADING_PREVIEW");
      expect(intake.positions[3]).toMatchObject({ lockedBoardCount: 2, lockedBoards: { human: 1, nonHuman: 1, adminOverride: 1, inactiveNonHuman: 1 } });
      expect(intake.advisories.filter((a) => a.code === "INACTIVE_COMPETITOR_LOCKED_BOARD").map((a) => [a.position, a.detail.includes(aiSubmissionId)])).toEqual([["TE", true]]);
      const preview = await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId });
      expect(preview.boards.some((b) => b.board.submissionId === aiSubmissionId && b.competitor.entryBasis === "ADMIN_COMPETITIVE_OVERRIDE")).toBe(true);
      expect(preview.advisories.filter((a) => a.code === "INACTIVE_COMPETITOR_LOCKED_BOARD")).toHaveLength(1);
    } finally {
      await prisma.universalProfile.update({ where: { id: aiProfileId }, data: { competitorActive: true } });
    }
  });

  it("refuses a superseded or withdrawn revision and never carries D3 decisions forward", async () => {
    const r2 = await importRevision(2);
    const stale = (await loadWaiverResultsIntake(prisma, artifactRowId))!;
    expect([stale.status, stale.artifact.gradable, stale.artifact.latestState]).toEqual(["ARTIFACT_NOT_GRADABLE", false, "SUPERSEDED"]);
    expect(stale.issues.map((i) => i.code)).toEqual(["ARTIFACT_NOT_ACCEPTED", "ARTIFACT_NOT_LATEST"]);

    const fresh = (await loadWaiverResultsIntake(prisma, r2.artifactRowId))!;
    expect([fresh.status, fresh.decisionsRequired, fresh.decisionsResolved]).toEqual(["D3_DECISIONS_REQUIRED", 2, 0]);

    await withdrawWaiverArtifact({
      artifactRowId: r2.artifactRowId,
      adminUserId: base.adminUserId,
      expectedSequence: 1,
      attested: true,
      reason: "fixture withdrawal",
      sourceReference: "sng-admin://fixture/withdrawn",
      sourceObservedAt: new Date(Date.now() - 60_000),
    });
    const withdrawn = (await loadWaiverResultsIntake(prisma, r2.artifactRowId))!;
    expect([withdrawn.status, withdrawn.artifact.latestState]).toEqual(["ARTIFACT_NOT_GRADABLE", "WITHDRAWN"]);
    expect(withdrawn.issues.map((i) => i.code)).toEqual(["ARTIFACT_NOT_ACCEPTED"]);
    expect((await loadWaiverWeekGradingPreview(prisma, { weekId, artifactRowId: r2.artifactRowId })).issues.map((i) => i.code)).toContain("ARTIFACT_NOT_ACCEPTED");
    expect(await lockedEvidenceState()).toEqual(lockedEvidence);
  });
});
