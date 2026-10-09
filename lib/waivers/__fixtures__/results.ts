import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION } from "@/lib/waivers/artifacts/authority";
import { applyWaiverArtifactImport, buildWaiverArtifactImportPreview, previewWaiverArtifactImport } from "@/lib/waivers/artifacts/import";
import { WAIVER_ARTIFACT_EVENT_BASIS, waiverArtifactRowData } from "@/lib/waivers/artifacts/import-model";
import { evaluateCanonicalWaiverBoard, type CanonicalCallTreatment } from "@/lib/waivers/canonical/policy";
import { canonicalExportChecksum } from "@/lib/waivers/canonical/serialization";
import type { WaiverDb } from "@/lib/waivers/clock";
import { WAIVER_EYEQ_V1, WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { divideRoundHalfAwayFromZero } from "@/lib/waivers/precision";
import { rankWaiverPool } from "@/lib/waivers/ranking";
import * as fingerprints from "@/lib/waivers/results/fingerprints";
import {
  deriveWaiverUngradableReason,
  WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT,
  WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION,
  WAIVER_GRADING_RULESET_VERSION,
  WAIVER_HONOR_INELIGIBLE_REASONS,
  WAIVER_RESULTS_POLICY_VERSION,
  type WaiverGradeApprovalPolicy,
} from "@/lib/waivers/results/model";
import { maxRawPointsForSlot, waiverEyeqHundredths } from "@/lib/waivers/scoring";
import { saveWaiverDraft, submitWaiverBoard } from "@/lib/waivers/submissions";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { recordWaiverAiEvidence, reviewWaiverAiEvidence } from "@/lib/waivers/ai/evidence";
import { approveWaiverAiLateEntry, verifyWaiverAiLateEntry } from "@/lib/waivers/ai/late-entry";
import { importAiWaiverBoard } from "@/lib/waivers/ai/submissions";
import { sha256Utf8 } from "@/lib/waivers/ai/text";
import { buildSyntheticCanonicalArtifact, hex } from "@/lib/waivers/__fixtures__/canonical-artifact";
import { createWaiverFixture, MAINTENANCE_SQL, type FixturePlayer } from "@/lib/waivers/__fixtures__/competition";

/**
 * Local-DB fixture for Stage 4B.3 results and grading storage. One synthetic
 * week (SNG-valid season, week 1) with five locked contests, a corrected
 * snapshot (v2 excludes a QB already called on a v1 board), boards covering
 * every board shape, and an imported synthetic canonical artifact. Results
 * and grades are computed with the Stage 4A pure policy and written straight
 * to the storage tables (no grading service exists yet). `cleanup()` removes
 * everything with the fixture-maintenance switch.
 *
 * Board scenario:
 *   QB  alpha [qbX, qb1, qb2] on v1 (qbX invalidated by v2); bravo zero-call
 *   RB  alpha [rb1, rb2, rb3] (Perfect Podium); bravo draft only
 *   WR  alpha [wr1..wr5] (Perfect Five); wr6 BYE conflict needs D3
 *   TE  alpha [te1] (te1 CANCELLED_GAME: all neutralized)
 *   DEF alpha [def1, def2] (partial; slot 2 misses)
 *
 * Optional scenarios:
 *   overflowBoard   adds te3/te4 and charlie's TE board [te2, te3, te4] on
 *                   v1; v2 also excludes te3/te4, so the corrected pool has 2
 *                   available slots under charlie's 3 submitted calls.
 *   emptyPosition   every player at that position is EXCLUDED in v1 and v2:
 *                   no contest, no boards, an explicit empty-position result.
 *   emptiedTeContest the TE contest opens on v1 with alpha [te1], bravo [te2]
 *                   and charlie's zero-call board; v2 excludes every TE, so
 *                   the contest keeps its boards and gets a zero-field result.
 *   scale           replaces the WR pool with `wrPoolSize` players and adds
 *                   `wrBoards` participants with 5-call WR boards (benchmark).
 */

export type ResultsScenario = {
  overflowBoard?: boolean;
  emptyPosition?: WaiverPosition;
  emptiedTeContest?: boolean;
  scale?: { wrPoolSize: number; wrBoards: number };
  /** Adds a SYSTEM_OPERATED AI board at DEF (imported through the shipped AI service). */
  aiBoard?: boolean;
  /** Adds a second AI's DEF board as an approved administrative late entry (pre-lock evidence, post-lock import). */
  lateAiBoard?: boolean;
};

const TX = { maxWait: 10_000, timeout: 600_000 } as const;

const MINUTE = 60_000;
/** SNG-valid past seasons for results fixtures; allocated collision-free per fixture. */
const RESULTS_FIXTURE_SEASON_YEARS = { min: 2001, max: 2024 } as const;
type Cls = "RANKED" | "NON_PARTICIPANT" | "SYSTEMIC_NEUTRALIZE" | "SNAPSHOT_CONFLICT";
export type PoolFact = { cls: Cls; points?: number; state?: string; disposition?: string };

const DEFAULT_FACTS: Record<string, PoolFact> = {
  qb1: { cls: "RANKED", points: 2500 },
  qb2: { cls: "RANKED", points: 2500 },
  qb3: { cls: "NON_PARTICIPANT" },
  qbX: { cls: "RANKED", points: 3000 },
  rb1: { cls: "RANKED", points: 2000 },
  rb2: { cls: "RANKED", points: 1500 },
  rb3: { cls: "RANKED", points: 1000 },
  wr1: { cls: "RANKED", points: 2400 },
  wr2: { cls: "RANKED", points: 2000 },
  wr3: { cls: "RANKED", points: 1800 },
  wr4: { cls: "RANKED", points: 1200 },
  wr5: { cls: "RANKED", points: 900 },
  wr6: { cls: "SNAPSHOT_CONFLICT" },
  te1: { cls: "SYSTEMIC_NEUTRALIZE" },
  te2: { cls: "RANKED", points: 700 },
  te3: { cls: "RANKED", points: 650 },
  te4: { cls: "RANKED", points: 400 },
  def1: { cls: "RANKED", points: 1100 },
  def2: { cls: "RANKED", points: 300 },
  def3: { cls: "RANKED", points: 800 },
};

const PLAYER_KEYS: Record<WaiverPosition, string[]> = {
  QB: ["qb1", "qb2", "qb3", "qbX"],
  RB: ["rb1", "rb2", "rb3"],
  WR: ["wr1", "wr2", "wr3", "wr4", "wr5", "wr6"],
  TE: ["te1", "te2"],
  DEF: ["def1", "def2", "def3"],
};

const FACT_SHAPE: Record<Cls, { state: string; disposition: string }> = {
  RANKED: { state: "PARTICIPATED_WITH_STATS", disposition: "PLAYED" },
  NON_PARTICIPANT: { state: "VERIFIED_NON_PARTICIPANT", disposition: "DNP" },
  SYSTEMIC_NEUTRALIZE: { state: "VERIFIED_NON_PARTICIPANT", disposition: "CANCELLED_GAME" },
  SNAPSHOT_CONFLICT: { state: "VERIFIED_NON_PARTICIPANT", disposition: "BYE" },
};

export type ArtifactRef = {
  id: string;
  artifactId: string;
  seriesKey: string;
  revision: number;
  contentChecksum: string;
  defCrosswalkVersion: string;
  importedByUserId: string;
};

export type BuiltContestResult = {
  result: Omit<Prisma.WaiverContestResultUncheckedCreateInput, "id" | "createdAt">;
  rows: Array<Omit<Prisma.WaiverPoolResultUncheckedCreateInput, "id" | "contestResultId">>;
};

type BoardWrite = { board: Omit<Prisma.WaiverBoardGradeUncheckedCreateInput, "id" | "gradeRunId">; calls: Array<Omit<Prisma.WaiverCallGradeUncheckedCreateInput, "id" | "boardGradeId">> };
export type BuiltGradeRun = { run: Omit<Prisma.WaiverGradeRunUncheckedCreateInput, "id" | "createdAt">; boards: BoardWrite[] };

export async function createResultsFixture(tag: string, scenario: ResultsScenario = {}) {
  const base = await createWaiverFixture(tag, { years: RESULTS_FIXTURE_SEASON_YEARS });
  const year = base.year;
  const alpha = await base.addParticipant("alpha");
  const bravo = await base.addParticipant("bravo");
  const charlie = scenario.overflowBoard || scenario.emptiedTeContest ? await base.addParticipant("charlie") : null;
  const secondAdmin = await prisma.user.create({ data: { email: `waivers-admin2-${base.suffix}@example.test`, role: "ADMIN" } });
  const member = await prisma.user.create({ data: { email: `waivers-member-${base.suffix}@example.test` } });

  const playerKeys: Record<WaiverPosition, string[]> = { ...PLAYER_KEYS };
  const scenarioFacts: Record<string, PoolFact> = {};
  if (scenario.overflowBoard) playerKeys.TE = [...PLAYER_KEYS.TE, "te3", "te4"];
  if (scenario.scale) {
    playerKeys.WR = Array.from({ length: scenario.scale.wrPoolSize }, (_, i) => `wr${i + 1}`);
    for (let i = 7; i <= scenario.scale.wrPoolSize; i += 1) {
      // Realistic spread: descending points with periodic ties and non-participants.
      scenarioFacts[`wr${i}`] = i % 17 === 0 ? { cls: "NON_PARTICIPANT" } : { cls: "RANKED", points: 3000 - Math.floor(i / 2) * 2 };
    }
  }
  const players: Record<string, FixturePlayer> = {};
  for (const position of WAIVER_POSITIONS) {
    const created = await base.addPlayers(position, playerKeys[position].length);
    playerKeys[position].forEach((key, i) => (players[key] = created[i]));
  }
  const keyOf = new Map(Object.entries(players).map(([key, player]) => [player.id, key]));
  const { weekId } = await base.addWeek();
  const contestPositions = WAIVER_POSITIONS.filter((p) => p !== scenario.emptyPosition);
  const emptyKeys = scenario.emptyPosition ? playerKeys[scenario.emptyPosition] : [];

  const rows = (excluded: string[] = []) =>
    Object.entries(players).map(([key, player]) => ({
      player,
      eligibility: excluded.includes(key) || emptyKeys.includes(key) ? ("EXCLUDED" as const) : ("ELIGIBLE" as const),
    }));
  const v1 = await base.freezeSnapshot({ weekId, rows: rows() });
  const contests = {} as Record<WaiverPosition, string>;
  for (const position of contestPositions) {
    contests[position] = (await base.createContest({ weekId, snapshotId: v1.id, position, locksInMs: 60 * MINUTE })).id;
  }
  const submit = (who: typeof alpha, position: WaiverPosition, keys: string[]) =>
    contests[position]
      ? submitWaiverBoard({ contestId: contests[position], universalProfileId: who.profileId, userId: who.userId, playerIds: keys.map((k) => players[k].id) })
      : null;

  await submit(alpha, "QB", ["qbX", "qb1", "qb2"]);
  if (charlie && scenario.overflowBoard) await submit(charlie, "TE", ["te2", "te3", "te4"]);
  if (charlie && scenario.emptiedTeContest) {
    await submit(alpha, "TE", ["te1"]);
    await submit(bravo, "TE", ["te2"]);
    await submit(charlie, "TE", []);
  }
  const v2Excluded = ["qbX", ...(scenario.overflowBoard ? ["te3", "te4"] : []), ...(scenario.emptiedTeContest ? playerKeys.TE : [])];
  const v2 = await base.freezeSnapshot({ weekId, rows: rows(v2Excluded), supersedesId: v1.id });
  for (const position of contestPositions) {
    await prisma.waiverContest.update({ where: { id: contests[position] }, data: { snapshotId: v2.id } });
  }
  await submit(bravo, "QB", []);
  await submit(alpha, "RB", ["rb1", "rb2", "rb3"]);
  if (contests.RB) {
    await saveWaiverDraft({ contestId: contests.RB, universalProfileId: bravo.profileId, userId: bravo.userId, playerIds: [players.rb3.id] });
  }
  await submit(alpha, "WR", ["wr1", "wr2", "wr3", "wr4", "wr5"]);
  if (!scenario.emptiedTeContest) await submit(alpha, "TE", ["te1"]);
  await submit(alpha, "DEF", ["def1", "def2"]);
  const ai = scenario.aiBoard ? await base.addAiCompetitor("grader") : null;
  if (ai && contests.DEF) {
    const responseText = `1. ${players.def3.name}\n2. ${players.def1.name}\n`;
    const context = await loadWaiverAiContestContext(prisma, contests.DEF);
    await importAiWaiverBoard({
      adminUserId: base.adminUserId,
      contestId: contests.DEF,
      universalProfileId: ai.profileId,
      responseText,
      expectedResponseSha256: sha256Utf8(responseText),
      expectedPromptSha256: context!.prompt.sha256,
      confirmedRankableEntryIds: [players.def3.id, players.def1.id],
      modelLabel: "Fixture model",
      statedGeneratedAt: null,
      sourceReference: null,
      sourceNote: null,
    });
  }
  if (scenario.scale) {
    const callable = playerKeys.WR.filter((k) => k !== "wr6");
    for (let b = 0; b < scenario.scale.wrBoards; b += 1) {
      const who = await base.addParticipant(`wr${b}`);
      const start = (b * 7) % (callable.length - 5);
      await submit(who, "WR", callable.slice(start, start + 5));
    }
  }

  const lateAi = scenario.lateAiBoard ? await base.addAiCompetitor("lategrader") : null;
  const lateText = `1. ${players.def2.name}\n2. ${players.def3.name}\n`;
  const lateEvidence =
    lateAi && contests.DEF
      ? await recordWaiverAiEvidence({
          adminUserId: base.adminUserId,
          contestId: contests.DEF,
          universalProfileId: lateAi.profileId,
          responseText: lateText,
          expectedResponseSha256: sha256Utf8(lateText),
          modelLabel: "Fixture late model",
          statedSourceAt: null,
          evidenceSource: "CHAT_EXPORT",
          evidenceReference: "fixture-export.json",
          note: null,
        })
      : null;

  const lockAt = new Date(Math.max(Date.now(), lateEvidence ? lateEvidence.recordedAt.getTime() + 1 : 0));
  for (const position of contestPositions) await base.passLock(contests[position], lockAt);
  for (const position of contestPositions) await ensureWaiverContestLocked(contests[position]);

  if (lateEvidence) {
    const context = await loadWaiverAiContestContext(prisma, contests.DEF);
    const pickIds = [players.def2.id, players.def3.id];
    await reviewWaiverAiEvidence({ adminUserId: base.adminUserId, evidenceId: lateEvidence.evidenceId, expectedSequence: 0, status: "TEXT_CONFIRMED", note: "matches export" });
    const verified = await verifyWaiverAiLateEntry({
      adminUserId: base.adminUserId,
      evidenceId: lateEvidence.evidenceId,
      expectedSequence: 0,
      basis: "DATABASE_RECORDED_PRE_LOCK",
      originalPredictionAt: null,
      sourceReference: "fixture-export.json",
      artifact: null,
      expectedPromptSha256: context!.prompt.sha256,
      originalPrompt: { version: null, reference: null, text: null },
      confirmedRankableEntryIds: pickIds,
      attestation: "fixture late entry",
    });
    await approveWaiverAiLateEntry({
      adminUserId: base.adminUserId,
      verificationId: verified.verificationId,
      confirmation: lateEvidence.responseSha256.slice(0, 12),
      confirmedRankableEntryIds: pickIds,
      note: null,
    });
  }

  // -------------------------------------------------------------------------
  // Synthetic canonical artifacts (imported through the shipped service)
  // -------------------------------------------------------------------------
  const acceptedAt = new Date(Math.floor((Date.now() - 60 * MINUTE) / 1000) * 1000).toISOString();
  const artifactIdFor = (revision: number) => `${base.suffix}-res-r${revision}`;

  function artifactRequest(revision: number) {
    const sealed = buildSyntheticCanonicalArtifact({
      season: year,
      week: 1,
      revision,
      artifactId: artifactIdFor(revision),
      supersedesArtifactId: revision === 1 ? null : artifactIdFor(revision - 1),
      acceptedAt,
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
        sourceObservedAt: new Date(Date.parse(artifact.payload.acceptance.acceptedAt) + 30 * MINUTE),
      },
    };
    return request;
  }

  async function importArtifact(revision = 1): Promise<ArtifactRef> {
    const request = artifactRequest(revision);
    const preview = await previewWaiverArtifactImport(request);
    if (preview.blockers.length) throw new Error(`fixture artifact blocked: ${preview.blockers.map((b) => b.code).join(", ")}`);
    const applied = await applyWaiverArtifactImport({ ...request, adminUserId: base.adminUserId, previewFingerprint: preview.previewFingerprint, attested: true });
    return loadArtifact(applied.artifactRowId);
  }

  /**
   * The shipped import's artifact writes (metadata, exact content, ACCEPTED
   * event) inside the caller's transaction, for testing that grading approval
   * can never share the import transaction. First revision only.
   */
  async function importArtifactInTransaction(tx: Prisma.TransactionClient, revision = 1): Promise<ArtifactRef> {
    const request = artifactRequest(revision);
    const { preview, verification } = await buildWaiverArtifactImportPreview(tx, request);
    if (preview.status === "BLOCKED" || !verification.ok) throw new Error(`fixture artifact blocked: ${preview.blockers.map((b) => b.code).join(", ")}`);
    const artifact = await tx.waiverCanonicalArtifact.create({ data: waiverArtifactRowData(verification, request, preview, base.adminUserId), select: { id: true } });
    await tx.waiverCanonicalArtifactContent.create({
      data: { artifactRowId: artifact.id, contentText: request.artifactText, textSha256: preview.textSha256, byteLength: preview.byteLength },
    });
    await tx.waiverCanonicalArtifactEvent.create({
      data: {
        artifactRowId: artifact.id,
        sequence: 1,
        state: "ACCEPTED",
        basis: WAIVER_ARTIFACT_EVENT_BASIS.ACCEPTED,
        sourceReference: request.evidence.sourceReference,
        sourceObservedAt: request.evidence.sourceObservedAt,
        attestationVersion: WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION,
        operatorUserId: base.adminUserId,
      },
    });
    return loadArtifact(artifact.id, tx);
  }

  async function loadArtifact(id: string, db: WaiverDb = prisma): Promise<ArtifactRef> {
    return db.waiverCanonicalArtifact.findUniqueOrThrow({
      where: { id },
      select: { id: true, artifactId: true, seriesKey: true, revision: true, contentChecksum: true, defCrosswalkVersion: true, importedByUserId: true },
    });
  }

  const artifactFp = (a: ArtifactRef) =>
    fingerprints.artifactIdentityFingerprint({ seriesKey: a.seriesKey, revision: a.revision, artifactId: a.artifactId, contentChecksum: a.contentChecksum });
  const participantId = (key: string) => `sng-${key}`;

  async function pinnedEntry(position: WaiverPosition, key: string, db: WaiverDb = prisma) {
    const contest = await db.waiverContest.findUniqueOrThrow({ where: { id: contests[position] }, select: { snapshotId: true } });
    return db.waiverSnapshotEntry.findUnique({ where: { snapshotId_rankableEntryId: { snapshotId: contest.snapshotId, rankableEntryId: players[key].id } } });
  }

  /** Runs `fn` in the caller's transaction, or in a new one. */
  const inTx = <T>(db: Prisma.TransactionClient | undefined, fn: (tx: Prisma.TransactionClient) => Promise<T>) => (db ? fn(db) : prisma.$transaction(fn, TX));

  // -------------------------------------------------------------------------
  // D3 resolutions
  // -------------------------------------------------------------------------
  async function resolve(input: {
    position: WaiverPosition;
    key: string;
    artifact: ArtifactRef;
    resolution: "SCORE_AS_RANKED" | "NON_PARTICIPANT_ZERO" | "NEUTRALIZED";
    kind?: "BYE_VS_SCHEDULED" | "TEAM_CHANGED";
    supersedes?: { id: string; sequence: number };
    reconfirmsResolutionId?: string;
    resolvedByUserId?: string;
    snapshotEntryId?: string;
  }, db: WaiverDb = prisma) {
    const kind = input.kind ?? "BYE_VS_SCHEDULED";
    const entryId = input.snapshotEntryId ?? (await pinnedEntry(input.position, input.key, db))!.id;
    const entry = await db.waiverSnapshotEntry.findUniqueOrThrow({ where: { id: entryId } });
    const conflictKey = canonicalExportChecksum({
      v: 1,
      kind,
      snapshotEntryId: entryId,
      participantId: participantId(input.key),
      artifactContentChecksum: input.artifact.contentChecksum,
    });
    return db.waiverConflictResolution.create({
      data: {
        weekId,
        contestId: contests[input.position],
        position: input.position,
        snapshotId: entry.snapshotId,
        snapshotEntryId: entryId,
        artifactRowId: input.artifact.id,
        artifactRevision: input.artifact.revision,
        artifactContentChecksum: input.artifact.contentChecksum,
        sngParticipantId: participantId(input.key),
        conflictKey,
        conflictKind: kind,
        sequence: input.supersedes ? input.supersedes.sequence + 1 : 1,
        supersedesResolutionId: input.supersedes?.id ?? null,
        reconfirmsResolutionId: input.reconfirmsResolutionId ?? null,
        resolution: input.resolution,
        evidenceReference: `sng-admin://fixture/evidence/${input.key}`,
        reason: `fixture D3 decision for ${input.key}`,
        inputFingerprint: fingerprints.conflictResolutionInputFingerprint({
          artifactFingerprint: artifactFp(input.artifact),
          position: input.position,
          conflictKey,
          conflictKind: kind,
          snapshotEntryId: entryId,
          sngParticipantId: participantId(input.key),
        }),
        resolvedByUserId: input.resolvedByUserId ?? base.adminUserId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Contest results
  // -------------------------------------------------------------------------
  async function buildContestResult(
    position: WaiverPosition,
    input: { artifact: ArtifactRef; facts?: Record<string, PoolFact> },
    db: WaiverDb = prisma,
  ): Promise<BuiltContestResult> {
    const facts = { ...DEFAULT_FACTS, ...scenarioFacts, ...input.facts };
    const contest = await db.waiverContest.findUniqueOrThrow({ where: { id: contests[position] } });
    const snapshot = await db.waiverSnapshot.findUniqueOrThrow({ where: { id: contest.snapshotId } });
    const eligible = await db.waiverSnapshotEntry.findMany({
      where: { snapshotId: contest.snapshotId, position, evidenceRole: "CANDIDATE", eligibility: "ELIGIBLE" },
      include: { rankableEntry: { select: { provider: true, externalId: true } } },
    });
    const eligibleIds = new Set(eligible.map((e) => e.rankableEntryId));
    const lockedCalls = await db.waiverCall.findMany({
      where: { revision: { lockedFor: { contestId: contest.id } } },
      include: { snapshotEntry: { include: { rankableEntry: { select: { provider: true, externalId: true } } } } },
    });
    const invalidated = new Map(lockedCalls.filter((c) => !eligibleIds.has(c.snapshotEntry.rankableEntryId)).map((c) => [c.snapshotEntry.rankableEntryId, c.snapshotEntry]));
    const current = await db.waiverConflictResolution.findMany({
      where: { contestId: contest.id, artifactRowId: input.artifact.id, supersededBy: null },
      include: { snapshotEntry: { select: { rankableEntryId: true } } },
    });
    const resolutionFor = new Map(current.map((r) => [r.snapshotEntry.rankableEntryId, r]));

    const members = [
      ...eligible.map((e) => ({ category: "ELIGIBLE_POOL_MEMBER" as const, rankableEntryId: e.rankableEntryId, entry: e, identityEntry: e })),
      ...[...invalidated].map(([rankableEntryId, calledEntry]) => ({ category: "INVALIDATED_CALLED_PLAYER" as const, rankableEntryId, entry: null, identityEntry: calledEntry })),
    ];
    const canonicalRanks = new Map(
      rankWaiverPool(
        members.filter((m) => facts[keyOf.get(m.rankableEntryId)!].cls === "RANKED"),
        (m) => facts[keyOf.get(m.rankableEntryId)!].points!,
      ).map((r) => [r.item.rankableEntryId, r.waiverRank]),
    );

    const drafts = await Promise.all(
      members.map(async (m) => {
        const key = keyOf.get(m.rankableEntryId)!;
        const fact = facts[key];
        const shape = { ...FACT_SHAPE[fact.cls], ...(fact.state ? { state: fact.state } : {}), ...(fact.disposition ? { disposition: fact.disposition } : {}) };
        const resolution = resolutionFor.get(m.rankableEntryId) ?? null;
        const pinned = m.category === "INVALIDATED_CALLED_PLAYER" ? await pinnedEntry(position, key, db) : null;
        let treatment: "RANKED" | "NON_PARTICIPANT_ZERO" | "NEUTRALIZED" | "INVALIDATED_PRE_LOCK";
        let precedence: "D2_NEUTRALIZATION_OVER_C2_INVALIDATION" | "D3_NEUTRALIZATION_OVER_C2_INVALIDATION" | null = null;
        if (m.category === "ELIGIBLE_POOL_MEMBER") {
          if (resolution) treatment = resolution.resolution === "SCORE_AS_RANKED" ? "RANKED" : resolution.resolution;
          else if (fact.cls === "SNAPSHOT_CONFLICT") throw new Error(`fixture: ${key} needs a D3 resolution`);
          else treatment = fact.cls === "RANKED" ? "RANKED" : fact.cls === "NON_PARTICIPANT" ? "NON_PARTICIPANT_ZERO" : "NEUTRALIZED";
        } else if (fact.cls === "SYSTEMIC_NEUTRALIZE") {
          treatment = "NEUTRALIZED";
          precedence = "D2_NEUTRALIZATION_OVER_C2_INVALIDATION";
        } else if (resolution?.resolution === "NEUTRALIZED") {
          treatment = "NEUTRALIZED";
          precedence = "D3_NEUTRALIZATION_OVER_C2_INVALIDATION";
        } else if (fact.cls === "SNAPSHOT_CONFLICT" && !resolution) {
          throw new Error(`fixture: ${key} needs a D3 resolution`);
        } else {
          treatment = "INVALIDATED_PRE_LOCK";
        }
        const ranked = fact.cls === "RANKED";
        return {
          category: m.category,
          snapshotEntryId: m.entry?.id ?? pinned?.id ?? null,
          rankableEntryId: m.rankableEntryId,
          position,
          identityProvider: m.identityEntry.identityProviderAtFreeze ?? m.identityEntry.rankableEntry.provider,
          identityExternalId: m.identityEntry.identityExternalIdAtFreeze ?? m.identityEntry.rankableEntry.externalId,
          sngParticipantId: participantId(key),
          participationState: shape.state,
          participantDisposition: shape.disposition,
          canonicalClass: fact.cls,
          canonicalPointsHundredths: ranked ? fact.points! : null,
          canonicalPositionRank: ranked ? canonicalRanks.get(m.rankableEntryId)! : null,
          sngResultFingerprint: ranked ? hex(`result-${key}-${input.artifact.contentChecksum}`) : null,
          treatment,
          fpHundredths: treatment === "RANKED" ? fact.points! : treatment === "NEUTRALIZED" ? null : 0,
          waiverPoolRank: null as number | null,
          neutralizationPrecedence: precedence,
          conflictResolutionId: resolution?.id ?? null,
          resolutionKey: resolution ? { conflictKey: resolution.conflictKey, sequence: resolution.sequence } : null,
          invalidationBasis:
            m.category === "ELIGIBLE_POOL_MEMBER" ? null : pinned ? ("NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" as const) : ("ABSENT_FROM_PINNED_SNAPSHOT" as const),
          invalidatedBySnapshotId: m.category === "ELIGIBLE_POOL_MEMBER" ? null : contest.snapshotId,
        };
      }),
    );
    const poolRanks = new Map(rankWaiverPool(drafts.filter((d) => d.treatment === "RANKED"), (d) => d.fpHundredths!).map((r) => [r.item.rankableEntryId, r.waiverRank]));
    for (const d of drafts) d.waiverPoolRank = poolRanks.get(d.rankableEntryId) ?? null;

    const poolRows = drafts.map(({ resolutionKey, invalidatedBySnapshotId, ...row }) => ({
      ...row,
      invalidatedBySnapshotId,
      rowFingerprint: fingerprints.poolRowFingerprint({
        category: row.category,
        snapshotEntryId: row.snapshotEntryId,
        rankableEntryId: row.rankableEntryId,
        position,
        identityProvider: row.identityProvider,
        identityExternalId: row.identityExternalId,
        sngParticipantId: row.sngParticipantId,
        participationState: row.participationState,
        participantDisposition: row.participantDisposition,
        canonicalClass: row.canonicalClass,
        canonicalPointsHundredths: row.canonicalPointsHundredths,
        canonicalPositionRank: row.canonicalPositionRank,
        sngResultFingerprint: row.sngResultFingerprint,
        treatment: row.treatment,
        fpHundredths: row.fpHundredths,
        waiverPoolRank: row.waiverPoolRank,
        neutralizationPrecedence: row.neutralizationPrecedence,
        resolution: resolutionKey,
        invalidationBasis: row.invalidationBasis,
      }),
    }));

    const effectivePoolSize = poolRows.filter((r) => r.treatment === "RANKED").length;
    const effectiveAvailableSlots = Math.min(contest.maxCalls, eligible.length);
    const effectiveFieldSize = Math.min(contest.resultFieldSize, effectivePoolSize);
    const aFp = artifactFp(input.artifact);
    const snapshotFingerprint = fingerprints.snapshotIdentityFingerprint({ season: year, weekNumber: 1, version: snapshot.version, entriesFingerprint: snapshot.entriesFingerprint });
    const sngResultSetChecksum = hex(`result-set-${position}-${input.artifact.contentChecksum}`);
    const sourceFingerprint = fingerprints.contestSourceFingerprint({
      artifactFingerprint: aFp,
      position,
      sngResultSetChecksum,
      participants: poolRows.map((r) => ({
        participantId: r.sngParticipantId,
        participationState: r.participationState,
        participantDisposition: r.participantDisposition,
        pointsHundredths: r.canonicalPointsHundredths,
        competitionRank: r.canonicalPositionRank,
        resultFingerprint: r.sngResultFingerprint,
      })),
    });
    const resolutionSetFingerprint = fingerprints.resolutionSetFingerprint(
      current.map((r) => ({ conflictKey: r.conflictKey, sequence: r.sequence, conflictKind: r.conflictKind, resolution: r.resolution })),
    );
    const latest = await db.waiverContestResult.aggregate({ where: { contestId: contest.id }, _max: { resultVersion: true } });
    return {
      result: {
        contestId: contest.id,
        weekId,
        position,
        snapshotId: contest.snapshotId,
        artifactRowId: input.artifact.id,
        artifactContentChecksum: input.artifact.contentChecksum,
        resultVersion: (latest._max.resultVersion ?? 0) + 1,
        resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION,
        sngResultSetChecksum,
        sourceFingerprint,
        snapshotFingerprint,
        resolutionSetFingerprint,
        inputFingerprint: fingerprints.contestResultInputFingerprint({
          resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION,
          position,
          artifactFingerprint: aFp,
          snapshotFingerprint,
          sourceFingerprint,
          resolutionSetFingerprint,
          calledRankableEntryIds: lockedCalls.map((c) => c.snapshotEntry.rankableEntryId),
        }),
        resultFingerprint: fingerprints.contestResultFingerprint({
          position,
          resultFieldSize: contest.resultFieldSize,
          eligiblePoolSize: eligible.length,
          effectivePoolSize,
          effectiveFieldSize,
          effectiveAvailableSlots,
          invalidatedCalledCount: invalidated.size,
          rows: poolRows,
        }),
        resultFieldSize: contest.resultFieldSize,
        eligiblePoolSize: eligible.length,
        effectivePoolSize,
        effectiveFieldSize,
        effectiveAvailableSlots,
        invalidatedCalledCount: invalidated.size,
      },
      rows: poolRows,
    };
  }

  async function writeContestResult(built: BuiltContestResult, db?: Prisma.TransactionClient) {
    return inTx(db, async (tx) => {
      const result = await tx.waiverContestResult.create({ data: built.result });
      if (built.rows.length) await tx.waiverPoolResult.createMany({ data: built.rows.map((row) => ({ ...row, contestResultId: result.id })) });
      return result;
    });
  }

  /** The explicit result for a position with no eligible candidate in the week's current frozen snapshot. */
  async function buildEmptyPositionResult(position: WaiverPosition, db: WaiverDb = prisma) {
    const snapshot = await db.waiverSnapshot.findFirstOrThrow({ where: { currentForWeekId: weekId } });
    const snapshotFingerprint = fingerprints.snapshotIdentityFingerprint({ season: year, weekNumber: 1, version: snapshot.version, entriesFingerprint: snapshot.entriesFingerprint });
    return {
      weekId,
      position,
      snapshotId: snapshot.id,
      snapshotFingerprint,
      eligiblePoolSize: 0,
      resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION,
      resultFingerprint: fingerprints.emptyPositionResultFingerprint({ resultsPolicyVersion: WAIVER_RESULTS_POLICY_VERSION, position, snapshotFingerprint }),
    };
  }

  /**
   * Resolves wr6 (when no current resolution exists for the artifact) and
   * stores a result for each of the five positions: the contest result, or the
   * empty-position result for the scenario's empty position.
   */
  async function writeAllResults(artifact: ArtifactRef, facts?: Record<string, PoolFact>, db?: Prisma.TransactionClient) {
    const reader = db ?? prisma;
    const existing = await reader.waiverConflictResolution.count({ where: { contestId: contests.WR, artifactRowId: artifact.id } });
    if (!existing && (facts?.wr6 ?? DEFAULT_FACTS.wr6).cls === "SNAPSHOT_CONFLICT") await resolve({ position: "WR", key: "wr6", artifact, resolution: "NEUTRALIZED" }, reader);
    const ids = {} as Record<WaiverPosition, string>;
    for (const position of WAIVER_POSITIONS) {
      if (position === scenario.emptyPosition) {
        const data = await buildEmptyPositionResult(position, reader);
        const existingEmpty = await reader.waiverEmptyPositionResult.findUnique({
          where: { weekId_position_snapshotId: { weekId, position, snapshotId: data.snapshotId } },
        });
        ids[position] = (existingEmpty ?? (await reader.waiverEmptyPositionResult.create({ data }))).id;
      } else {
        ids[position] = (await writeContestResult(await buildContestResult(position, { artifact, facts }, reader), db)).id;
      }
    }
    return ids;
  }

  // -------------------------------------------------------------------------
  // Grade runs
  // -------------------------------------------------------------------------
  async function buildGradeRun(
    resultIds: Record<WaiverPosition, string>,
    input: { initiatedByUserId?: string | null } = {},
    db: WaiverDb = prisma,
  ): Promise<BuiltGradeRun> {
    const emptyPosition = scenario.emptyPosition;
    const results = await db.waiverContestResult.findMany({
      where: { id: { in: contestPositions.map((p) => resultIds[p]) } },
      include: { poolResults: { include: { conflictResolution: true } }, contest: true },
    });
    const empty = emptyPosition ? await db.waiverEmptyPositionResult.findUniqueOrThrow({ where: { id: resultIds[emptyPosition] } }) : null;
    const byPosition = new Map(results.map((r) => [r.position as WaiverPosition, r]));
    const artifact = await loadArtifact(results[0].artifactRowId, db);
    const boards: BoardWrite[] = [];
    const boardFps: Array<{ submissionId: string; inputFingerprint: string; outputFingerprint: string }> = [];

    for (const position of contestPositions) {
      const result = byPosition.get(position)!;
      const field = result.resultFieldSize;
      const pool = new Map(result.poolResults.map((p) => [p.rankableEntryId, p]));
      const submissions = await db.waiverSubmission.findMany({
        where: { contestId: result.contestId, lockedRevisionId: { not: null } },
        include: { lockedRevision: { include: { calls: { include: { snapshotEntry: { select: { rankableEntryId: true } } }, orderBy: { slot: "asc" } } } } },
        orderBy: { id: "asc" },
      });
      for (const submission of submissions) {
        const revision = submission.lockedRevision!;
        const calls = revision.calls.map((call) => {
          const p = pool.get(call.snapshotEntry.rankableEntryId)!;
          const treatment: CanonicalCallTreatment =
            p.treatment === "RANKED"
              ? { kind: "RANKED", waiverPoolRank: p.waiverPoolRank!, fpHundredths: p.fpHundredths! }
              : p.treatment === "NON_PARTICIPANT_ZERO"
                ? { kind: "NON_PARTICIPANT_ZERO", reason: p.participantDisposition }
                : p.treatment === "INVALIDATED_PRE_LOCK"
                  ? { kind: "INVALIDATED_PRE_LOCK" }
                  : p.neutralizationPrecedence
                    ? { kind: "NEUTRALIZED", reason: p.participantDisposition, invalidatedPreLock: true, precedence: p.neutralizationPrecedence }
                    : { kind: "NEUTRALIZED", reason: p.participantDisposition };
          return { call, p, treatment };
        });
        // Shrunken pool: per-call scoring never depends on the slot count, so
        // the 4A evaluation runs over the submitted calls and only the board
        // totals are recomputed against the corrected available slots.
        const availableSlots = result.effectiveAvailableSlots;
        const slotOverflow = calls.length > availableSlots;
        const evaluation = evaluateCanonicalWaiverBoard({
          calls: calls.map((c) => ({ slot: c.call.slot, treatment: c.treatment })),
          availableSlots: Math.max(availableSlots, calls.length),
          resultFieldSize: field,
        });
        if (evaluation.status !== "EVALUATED") throw new Error("fixture board unexpectedly blocked");
        const callWrites = calls.map(({ call, p }, i) => {
          const e = evaluation.calls[i];
          const output: fingerprints.CallGradeOutput = {
            slot: call.slot,
            treatment: p.treatment,
            scored: e.scored,
            waiverPoolRank: p.waiverPoolRank,
            canonicalPositionRank: p.canonicalPositionRank,
            fpHundredths: e.fpHundredths,
            inResultField: p.waiverPoolRank !== null && p.waiverPoolRank <= field,
            exact: e.exactSlotHit,
            earnedRawPoints: e.rawPoints,
            maxRawPoints: e.scored ? maxRawPointsForSlot(call.slot, field) : null,
            honorCreditEligible: e.honorCreditEligible,
            invalidatedPreLock: e.invalidatedPreLock,
            neutralizationPrecedence: e.precedence,
          };
          const inputFingerprint = fingerprints.callGradeInputFingerprint({
            slot: call.slot,
            callId: call.id,
            snapshotEntryId: call.snapshotEntryId,
            rankableEntryId: call.snapshotEntry.rankableEntryId,
            poolRowFingerprint: p.rowFingerprint,
            resultFieldSize: field,
          });
          return {
            callId: call.id,
            snapshotEntryId: call.snapshotEntryId,
            rankableEntryId: call.snapshotEntry.rankableEntryId,
            poolResultId: p.id,
            conflictResolutionId: p.conflictResolutionId,
            ...output,
            inputFingerprint,
            outputFingerprint: fingerprints.callGradeOutputFingerprint(output),
          };
        });
        const scored = evaluation.scoredCalls;
        const neutralized = evaluation.neutralizedSlots.length;
        const eff = Math.max(availableSlots - neutralized, 0);
        const coverageCalls = Math.min(scored, eff);
        const graded = scored > 0 && eff > 0;
        const resultKind =
          evaluation.submittedCalls === 0
            ? "NA_ZERO_CALL"
            : evaluation.allNeutralized
              ? "NA_ALL_NEUTRALIZED"
              : eff === 0
                ? "NA_NO_EFFECTIVE_SLOTS"
                : "SCORED";
        const output: fingerprints.BoardGradeOutput = {
          submittedCallCount: evaluation.submittedCalls,
          scoreableCallCount: scored,
          neutralizedCallCount: neutralized,
          invalidatedCallCount: evaluation.calls.filter((c) => c.invalidatedPreLock).length,
          exactCallCount: evaluation.calls.filter((c) => c.exactSlotHit).length,
          availableSlots,
          effectiveAvailableSlots: eff,
          coverageCallCount: coverageCalls,
          slotOverflow,
          earnedRawPoints: evaluation.earnedRawPoints,
          maxRawPoints: evaluation.maxRawPoints,
          coverageModifierNumerator: graded ? WAIVER_EYEQ_V1.coverageFloorPercent * eff + WAIVER_EYEQ_V1.coverageWeightPercent * coverageCalls : null,
          coverageModifierDenominator: graded ? 100 * eff : null,
          eyeqHundredths: graded
            ? waiverEyeqHundredths({ earnedRawPoints: evaluation.earnedRawPoints, maxRawPoints: evaluation.maxRawPoints, callsMade: coverageCalls, availableSlots: eff })
            : null,
          totalFpHundredths: evaluation.totalFpHundredths,
          fpPerCallHundredths: graded ? evaluation.fpPerCallHundredths : null,
          fpPerAvailableSlotHundredths:
            evaluation.allNeutralized || eff === 0 ? null : slotOverflow ? divideRoundHalfAwayFromZero(evaluation.totalFpHundredths, eff) : evaluation.fpPerAvailableSlotHundredths,
          resultKind,
          ungradableReason: resultKind === "NA_NO_EFFECTIVE_SLOTS" ? deriveWaiverUngradableReason(availableSlots) : null,
          played: resultKind === "SCORED" || resultKind === "NA_ZERO_CALL",
          honorEligible: resultKind === "SCORED",
          honorIneligibleReason: resultKind === "SCORED" ? null : WAIVER_HONOR_INELIGIBLE_REASONS[resultKind],
          awardedHonor: resultKind === "SCORED" ? evaluation.perfectHonor : null,
        };
        const inputFingerprint = fingerprints.boardGradeInputFingerprint({
          submissionId: submission.id,
          revisionId: revision.id,
          revisionFingerprint: revision.fingerprint,
          position,
          contestResultFingerprint: result.resultFingerprint,
          availableSlots,
          calls: callWrites.map((c) => ({ slot: c.slot, inputFingerprint: c.inputFingerprint })),
        });
        const outputFingerprint = fingerprints.boardGradeOutputFingerprint(output, callWrites);
        boards.push({
          board: {
            contestId: result.contestId,
            contestResultId: result.id,
            position,
            submissionId: submission.id,
            revisionId: revision.id,
            ...output,
            fpPerCallDenominator: scored,
            fpPerAvailableSlotDenominator: eff,
            inputFingerprint,
            outputFingerprint,
          },
          calls: callWrites,
        });
        boardFps.push({ submissionId: submission.id, inputFingerprint, outputFingerprint });
      }
    }

    const applied = results.flatMap((r) => r.poolResults.flatMap((p) => (p.conflictResolution ? [p.conflictResolution] : [])));
    const resolutionSet = fingerprints.resolutionSetFingerprint(
      applied.map((r) => ({ conflictKey: r.conflictKey, sequence: r.sequence, conflictKind: r.conflictKind, resolution: r.resolution })),
    );
    const snapshotSet = fingerprints.snapshotSetFingerprint([
      ...results.map((r) => ({ position: r.position as WaiverPosition, snapshotFingerprint: r.snapshotFingerprint })),
      ...(empty ? [{ position: empty.position as WaiverPosition, snapshotFingerprint: empty.snapshotFingerprint }] : []),
    ]);
    const positioned: fingerprints.PositionedResult[] = [
      ...results.map((r) => ({
        position: r.position as WaiverPosition,
        kind: "CONTEST_RESULT" as const,
        inputFingerprint: r.inputFingerprint,
        resultFingerprint: r.resultFingerprint,
      })),
      ...(empty ? [{ position: empty.position as WaiverPosition, kind: "EMPTY_ELIGIBLE_POOL" as const, inputFingerprint: null, resultFingerprint: empty.resultFingerprint }] : []),
    ];
    const inputFingerprint = fingerprints.gradeRunInputFingerprint({
      gradingRulesetVersion: WAIVER_GRADING_RULESET_VERSION,
      scoringVersion: WAIVER_EYEQ_V1.slug,
      season: year,
      weekNumber: 1,
      artifactFingerprint: artifactFp(artifact),
      snapshotSetFingerprint: snapshotSet,
      resolutionSetFingerprint: resolutionSet,
      contestResults: positioned,
      boards: boardFps,
    });
    const latest = await db.waiverGradeRun.aggregate({ where: { weekId }, _max: { runNumber: true } });
    const initiatedByUserId = input.initiatedByUserId === undefined ? base.adminUserId : input.initiatedByUserId;
    const contestId = (p: WaiverPosition) => (p === emptyPosition ? null : resultIds[p]);
    const emptyId = (p: WaiverPosition) => (p === emptyPosition ? resultIds[p] : null);
    return {
      run: {
        weekId,
        runNumber: (latest._max.runNumber ?? 0) + 1,
        artifactRowId: artifact.id,
        artifactContentChecksum: artifact.contentChecksum,
        qbContestResultId: contestId("QB"),
        rbContestResultId: contestId("RB"),
        wrContestResultId: contestId("WR"),
        teContestResultId: contestId("TE"),
        defContestResultId: contestId("DEF"),
        qbEmptyPositionResultId: emptyId("QB"),
        rbEmptyPositionResultId: emptyId("RB"),
        wrEmptyPositionResultId: emptyId("WR"),
        teEmptyPositionResultId: emptyId("TE"),
        defEmptyPositionResultId: emptyId("DEF"),
        snapshotSetFingerprint: snapshotSet,
        resolutionSetFingerprint: resolutionSet,
        gradingRulesetVersion: WAIVER_GRADING_RULESET_VERSION,
        scoringVersion: WAIVER_EYEQ_V1.slug,
        inputFingerprint,
        outputFingerprint: fingerprints.weekGradeOutputFingerprint({ gradeRunInputFingerprint: inputFingerprint, contestResults: positioned, boards: boardFps }),
        boardGradeCount: boards.length,
        initiator: initiatedByUserId ? "OPERATOR" : "SYSTEM",
        initiatedByUserId,
      },
      boards,
    };
  }

  async function writeGradeRun(built: BuiltGradeRun, db?: Prisma.TransactionClient) {
    return inTx(db, async (tx) => {
      const run = await tx.waiverGradeRun.create({ data: built.run });
      for (const { board, calls } of built.boards) {
        const grade = await tx.waiverBoardGrade.create({ data: { ...board, gradeRunId: run.id } });
        if (calls.length) await tx.waiverCallGrade.createMany({ data: calls.map((call) => ({ ...call, boardGradeId: grade.id })) });
      }
      return run;
    });
  }

  // -------------------------------------------------------------------------
  // Approval and authority
  // -------------------------------------------------------------------------
  async function approvalData(gradeRunId: string, input: { approvedByUserId?: string; policy?: WaiverGradeApprovalPolicy } = {}, db: WaiverDb = prisma) {
    const run = await db.waiverGradeRun.findUniqueOrThrow({ where: { id: gradeRunId } });
    const artifact = await loadArtifact(run.artifactRowId, db);
    return {
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
      approvalPolicy: input.policy ?? ("SINGLE_ADMIN_EXPLICIT" as const),
      approvedByUserId: input.approvedByUserId ?? base.adminUserId,
      artifactImportedByUserId: artifact.importedByUserId,
      gradeRunInitiatedByUserId: run.initiatedByUserId,
      attestationVersion: WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION,
      attestationText: WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT,
      reason: "fixture grading approval",
    };
  }

  async function approve(gradeRunId: string, input: { approvedByUserId?: string; policy?: WaiverGradeApprovalPolicy } = {}, db: WaiverDb = prisma) {
    return db.waiverGradeApproval.create({ data: await approvalData(gradeRunId, input, db) });
  }

  /** One transaction: append the authority change, then move the week, contest and board pointers. */
  async function applyAuthority(
    gradeRunId: string,
    approvalId: string,
    options: { skipContest?: WaiverPosition; skipBoards?: number; failAfterPointers?: boolean; reason?: string } = {},
    db?: Prisma.TransactionClient,
  ) {
    return inTx(db, async (tx) => {
      const run = await tx.waiverGradeRun.findUniqueOrThrow({ where: { id: gradeRunId }, include: { boardGrades: { orderBy: { submissionId: "asc" } } } });
      const approval = await tx.waiverGradeApproval.findUniqueOrThrow({ where: { id: approvalId } });
      const last = await tx.waiverGradeAuthorityChange.findFirst({ where: { weekId }, orderBy: { sequence: "desc" } });
      const change = await tx.waiverGradeAuthorityChange.create({
        data: {
          weekId,
          sequence: (last?.sequence ?? 0) + 1,
          changeType: last ? "REGRADE" : "INITIAL_GRADE",
          priorChangeId: last?.id ?? null,
          priorGradeRunId: last?.newGradeRunId ?? null,
          newGradeRunId: run.id,
          approvalId,
          approvedByUserId: approval.approvedByUserId,
          reason: options.reason ?? (last ? "fixture regrade" : "fixture initial grade"),
          inputFingerprint: run.inputFingerprint,
          outputFingerprint: run.outputFingerprint,
        },
      });
      const pointer = { gradeRunId: run.id, changeId: change.id };
      await tx.waiverWeekGradeAuthority.upsert({
        where: { weekId },
        create: { weekId, ...pointer, outputFingerprint: run.outputFingerprint },
        update: { ...pointer, outputFingerprint: run.outputFingerprint },
      });
      const resultIds: Record<WaiverPosition, string | null> = {
        QB: run.qbContestResultId,
        RB: run.rbContestResultId,
        WR: run.wrContestResultId,
        TE: run.teContestResultId,
        DEF: run.defContestResultId,
      };
      for (const position of WAIVER_POSITIONS) {
        const contestResultId = resultIds[position];
        if (options.skipContest === position || !contestResultId) continue;
        const data = { weekId, contestResultId, artifactRowId: run.artifactRowId, ...pointer };
        await tx.waiverContestResultAuthority.upsert({ where: { contestId: contests[position] }, create: { contestId: contests[position], ...data }, update: data });
      }
      for (const board of run.boardGrades.slice(options.skipBoards ?? 0)) {
        const data = { weekId, contestId: board.contestId, boardGradeId: board.id, ...pointer };
        await tx.waiverBoardGradeAuthority.upsert({ where: { submissionId: board.submissionId }, create: { submissionId: board.submissionId, ...data }, update: data });
      }
      if (options.failAfterPointers) throw new Error("fixture: simulated failure after pointer writes");
      return change;
    });
  }

  /** Imports, resolves, stores results, grades, approves and applies: the complete happy path. */
  async function gradeWeek(artifact?: ArtifactRef) {
    const a = artifact ?? (await importArtifact(1));
    const resultIds = await writeAllResults(a);
    const run = await writeGradeRun(await buildGradeRun(resultIds));
    const approval = await approve(run.id);
    const change = await applyAuthority(run.id, approval.id);
    return { artifact: a, resultIds, run, approval, change };
  }

  async function cleanup() {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(MAINTENANCE_SQL);
      await tx.waiverBoardGradeAuthority.deleteMany({ where: { weekId } });
      await tx.waiverContestResultAuthority.deleteMany({ where: { weekId } });
      await tx.waiverWeekGradeAuthority.deleteMany({ where: { weekId } });
      for (const change of await tx.waiverGradeAuthorityChange.findMany({ where: { weekId }, orderBy: { sequence: "desc" }, select: { id: true } })) {
        await tx.waiverGradeAuthorityChange.delete({ where: { id: change.id } });
      }
      await tx.waiverGradeApproval.deleteMany({ where: { weekId } });
      await tx.waiverCallGrade.deleteMany({ where: { boardGrade: { gradeRun: { weekId } } } });
      await tx.waiverBoardGrade.deleteMany({ where: { gradeRun: { weekId } } });
      await tx.waiverGradeRun.deleteMany({ where: { weekId } });
      await tx.waiverEmptyPositionResult.deleteMany({ where: { weekId } });
      await tx.waiverPoolResult.deleteMany({ where: { contestResult: { weekId } } });
      await tx.waiverContestResult.deleteMany({ where: { weekId } });
      const resolutions = await tx.waiverConflictResolution.findMany({
        where: { weekId },
        orderBy: [{ artifactRevision: "desc" }, { sequence: "desc" }],
        select: { id: true },
      });
      for (const r of resolutions) await tx.waiverConflictResolution.delete({ where: { id: r.id } });
      const artifacts = await tx.waiverCanonicalArtifact.findMany({ where: { weekId }, orderBy: { revision: "desc" }, select: { id: true } });
      const ids = artifacts.map((a) => a.id);
      await tx.waiverCanonicalArtifactEvent.deleteMany({ where: { OR: [{ artifactRowId: { in: ids } }, { successorArtifactRowId: { in: ids } }] } });
      await tx.waiverCanonicalArtifactContent.deleteMany({ where: { artifactRowId: { in: ids } } });
      for (const id of ids) await tx.waiverCanonicalArtifact.delete({ where: { id } });
    });
    await base.cleanup();
    await prisma.user.deleteMany({ where: { id: { in: [secondAdmin.id, member.id] } } });
  }

  return {
    base,
    year,
    weekId,
    contests,
    players,
    alpha,
    bravo,
    charlie,
    ai,
    lateAi,
    contestPositions,
    adminUserId: base.adminUserId,
    secondAdminUserId: secondAdmin.id,
    memberUserId: member.id,
    snapshots: { v1: v1.id, v2: v2.id },
    importArtifact,
    importArtifactInTransaction,
    loadArtifact,
    pinnedEntry,
    resolve,
    buildContestResult,
    writeContestResult,
    buildEmptyPositionResult,
    writeAllResults,
    buildGradeRun,
    writeGradeRun,
    approvalData,
    approve,
    applyAuthority,
    gradeWeek,
    cleanup,
  };
}

export type ResultsFixture = Awaited<ReturnType<typeof createResultsFixture>>;

/** Expects a rejection whose message matches (CHECK names, unique violations, guard codes). */
export async function expectRejected(promise: Promise<unknown>, pattern: RegExp) {
  let error: unknown = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  if (!error) throw new Error(`Expected rejection matching ${pattern}, but the write succeeded`);
  const message = error instanceof Error ? error.message : String(error);
  if (!pattern.test(message)) throw new Error(`Expected ${pattern}, got: ${message.slice(-400)}`);
}
