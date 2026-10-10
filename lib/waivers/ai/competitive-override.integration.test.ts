import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, expectDbGuard, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadRevealableWaiverBoards } from "@/lib/waivers/access-queries";
import { overrideWaiverAiBoard, type WaiverAiCompetitiveOverrideInput } from "@/lib/waivers/ai/competitive-override";
import { WAIVER_AI_LATE_SUBMISSION_REASON } from "@/lib/waivers/ai/constants";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { recordWaiverAiEvidence, reviewWaiverAiEvidence } from "@/lib/waivers/ai/evidence";
import { approveWaiverAiLateEntry, verifyWaiverAiLateEntry } from "@/lib/waivers/ai/late-entry";
import { loadWaiverAiBoardView, loadWaiverAiWeekView } from "@/lib/waivers/ai/queries";
import { importAiWaiverBoard, parseAgainstContext, previewWaiverAiResponse, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { sha256Utf8 } from "@/lib/waivers/ai/text";
import { filterWaiverBoardsByCategory } from "@/lib/waivers/competitor-category";
import { buildWaiverConsensus } from "@/lib/waivers/consensus-model";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { loadFinalWaiverBoards } from "@/lib/waivers/corrections";
import { waiverBoardFingerprint } from "@/lib/waivers/fingerprint";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Stage 4B.3C: admin competitive override. One week with an RB contest
 * (human boards, an on-time AI board, a verified late entry) and an open
 * contest in another week. Synthetic local fixtures only.
 */

let f: WaiverFixture;
let weekId: string;
let rbContest: string;
let openContest: string;
let snapshotId: string;
let rb: FixturePlayer[];
let wr: FixturePlayer[];
let lockAt: Date;
let human: { userId: string; profileId: string };
let human2: { userId: string; profileId: string };
let creator: { userId: string; profileId: string };
const ai: Record<string, string> = {};
let humanBoardsBefore: string;
let contestsBefore: string;
let humanConsensusBefore: string;
let lateEvidence: { id: string; text: string };

async function expectAiError(promise: Promise<unknown>, code: string, message?: RegExp) {
  let error: unknown = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, `expected ${code}`).toBeInstanceOf(WaiverAiError);
  expect((error as WaiverAiError).code).toBe(code);
  if (message) expect((error as WaiverAiError).message).toMatch(message);
}

async function pickIdsFor(contestId: string, text: string) {
  const context = await loadWaiverAiContestContext(prisma, contestId);
  return parseAgainstContext(context!, text).picks.map((pick) => pick.rankableEntryId);
}

async function override(profileId: string, text: string, overrides: Partial<WaiverAiCompetitiveOverrideInput> = {}) {
  const contestId = overrides.contestId ?? rbContest;
  return overrideWaiverAiBoard({
    adminUserId: f.adminUserId,
    contestId,
    universalProfileId: profileId,
    responseText: text,
    expectedResponseSha256: sha256Utf8(text),
    confirmedRankableEntryIds: await pickIdsFor(contestId, text),
    modelLabel: "Override model v1",
    sourceReference: null,
    allowLateSubmission: true,
    ...overrides,
  });
}

async function boardRows(profileId: string) {
  const [submissions, revisions, calls, responses, overrides] = await Promise.all([
    prisma.waiverSubmission.count({ where: { universalProfileId: profileId } }),
    prisma.waiverSubmissionRevision.count({ where: { submission: { universalProfileId: profileId } } }),
    prisma.waiverCall.count({ where: { revision: { submission: { universalProfileId: profileId } } } }),
    prisma.waiverAiResponse.count({ where: { universalProfileId: profileId } }),
    prisma.waiverAiCompetitiveOverride.count({ where: { universalProfileId: profileId } }),
  ]);
  return { submissions, revisions, calls, responses, overrides };
}

const NONE = { submissions: 0, revisions: 0, calls: 0, responses: 0, overrides: 0 };

async function humanBoardsJson() {
  const rows = await prisma.waiverSubmission.findMany({
    where: { contest: { weekId }, authority: "OWNER_AUTHORED" },
    orderBy: { id: "asc" },
    include: { revisions: { orderBy: { revisionNumber: "asc" }, include: { calls: { orderBy: { slot: "asc" } } } } },
  });
  return JSON.stringify(rows);
}

async function humanConsensusJson() {
  const revealed = await loadRevealableWaiverBoards(rbContest);
  if (!revealed.revealed) throw new Error("expected a revealed contest");
  const poolOrder = (await prisma.waiverSnapshotEntry.findMany({ where: { snapshotId, position: "RB" }, orderBy: { id: "asc" } })).map((row) => row.rankableEntryId);
  return JSON.stringify(buildWaiverConsensus({ boards: filterWaiverBoardsByCategory(revealed.boards, "HUMANS"), poolOrder }));
}

async function boardJson(profileId: string) {
  return JSON.stringify(
    await prisma.waiverSubmission.findMany({
      where: { universalProfileId: profileId },
      include: { revisions: { include: { calls: { orderBy: { slot: "asc" } }, aiResponse: true } }, competitiveOverride: true, lateEntry: true },
    }),
  );
}

/** A raw post-lock transaction writing the override and board directly, bypassing the service. */
function rawOverrideTransaction(input: {
  profileId: string;
  text: string;
  pickIds: string[];
  key: string;
  boardProfileId?: string;
  reorder?: boolean;
  withResponse?: boolean;
  promptClaim?: boolean;
  modelLabel?: string;
  authorizedByUserId?: string;
}) {
  const sha = sha256Utf8(input.text);
  const fingerprint = waiverBoardFingerprint({ contestId: rbContest, snapshotId, rankableEntryIds: input.pickIds });
  return prisma.$transaction(async (tx) => {
    const context = await loadWaiverAiContestContext(tx, rbContest);
    const entries = await tx.waiverSnapshotEntry.findMany({ where: { snapshotId, rankableEntryId: { in: input.pickIds } } });
    const row = await tx.waiverAiCompetitiveOverride.create({
      data: {
        contestId: rbContest,
        position: "RB",
        snapshotId,
        universalProfileId: input.profileId,
        responseSha256: sha,
        boardFingerprint: fingerprint,
        callCount: input.pickIds.length,
        parserVersion: "WAIVEREYEQ_AI_PARSER_V1",
        modelLabel: "Raw model",
        reason: "raw transaction",
        submissionId: `ovr-${input.key}-sub`,
        revisionId: `ovr-${input.key}-rev`,
        confirmation: sha.slice(0, 12),
        authorizedByUserId: input.authorizedByUserId ?? f.adminUserId,
      },
    });
    await tx.waiverSubmission.create({
      data: {
        id: row.submissionId,
        contestId: rbContest,
        universalProfileId: input.boardProfileId ?? input.profileId,
        createdByUserId: f.adminUserId,
        authority: "SYSTEM_OPERATED",
      },
    });
    await tx.waiverSubmissionRevision.create({
      data: {
        id: row.revisionId,
        submissionId: row.submissionId,
        revisionNumber: 1,
        kind: "SUBMISSION",
        snapshotId,
        callCount: input.pickIds.length,
        fingerprint,
        authorUserId: f.adminUserId,
        createdAt: row.authorizedAt,
      },
    });
    const order = input.reorder ? [...input.pickIds].reverse() : input.pickIds;
    if (order.length > 0) {
      await tx.waiverCall.createMany({
        data: order.map((id, i) => ({ revisionId: row.revisionId, slot: i + 1, snapshotEntryId: entries.find((entry) => entry.rankableEntryId === id)!.id })),
      });
    }
    if (input.withResponse ?? true) {
      await tx.waiverAiResponse.create({
        data: {
          revisionId: row.revisionId,
          contestId: rbContest,
          position: "RB",
          snapshotId,
          universalProfileId: input.profileId,
          modelLabel: input.modelLabel ?? "Raw model",
          promptVersion: input.promptClaim ? context!.prompt.version : null,
          promptSha256: input.promptClaim ? context!.prompt.sha256 : null,
          parserVersion: "WAIVEREYEQ_AI_PARSER_V1",
          responseText: input.text,
          responseSha256: sha,
          responseByteLength: Buffer.byteLength(input.text),
          noCalls: input.pickIds.length === 0,
          importedByUserId: f.adminUserId,
        },
      });
    }
    await tx.waiverSubmission.update({
      where: { id: row.submissionId },
      data: { status: "LOCKED", currentRevisionId: row.revisionId, lockedRevisionId: row.revisionId, submittedAt: row.authorizedAt, lockedAt: row.authorizedAt },
    });
    return row;
  });
}

beforeAll(async () => {
  f = await createWaiverFixture("ovr");
  rb = await f.addPlayers("RB", 5);
  // Same display name as rb[0] ("RB Player 1"): that name is ambiguous in the pool.
  const dupe = await f.addPlayers("RB", 1);
  wr = await f.addPlayers("WR", 2);
  const week = await f.addWeek();
  weekId = week.weekId;
  const snapshot = await f.freezeSnapshot({ weekId, rows: [...rb, ...dupe, ...wr].map((player) => ({ player })) });
  snapshotId = snapshot.id;
  rbContest = (await f.createContest({ weekId, snapshotId, position: "RB" })).id;
  const openWeek = await f.addWeek();
  const openSnapshot = await f.freezeSnapshot({ weekId: openWeek.weekId, rows: rb.slice(1).map((player) => ({ player })) });
  openContest = (await f.createContest({ weekId: openWeek.weekId, snapshotId: openSnapshot.id, position: "RB" })).id;

  for (const key of ["ok", "nocalls", "invalid", "ontime", "late", "replay", "rollback", "evid", "open", "unauth", "label"]) {
    ai[key] = (await f.addAiCompetitor(`ovr${key}`)).profileId;
  }
  ai.inactive = (await f.addAiCompetitor("ovrinactive", { competitorActive: false })).profileId;
  human = await f.addParticipant("ovrhuman");
  human2 = await f.addParticipant("ovrhuman2");
  creator = await f.addParticipant("ovrcreator", "CREATOR");

  await submitWaiverBoard({ contestId: rbContest, universalProfileId: human.profileId, userId: human.userId, playerIds: [rb[1].id, rb[2].id] });
  await submitWaiverBoard({ contestId: rbContest, universalProfileId: human2.profileId, userId: human2.userId, playerIds: [rb[3].id] });
  const onTimeText = `1. ${rb[2].name}\n`;
  const preview = await previewWaiverAiResponse({ adminUserId: f.adminUserId, contestId: rbContest, responseText: onTimeText });
  await importAiWaiverBoard({
    adminUserId: f.adminUserId,
    contestId: rbContest,
    universalProfileId: ai.ontime,
    responseText: onTimeText,
    expectedResponseSha256: sha256Utf8(onTimeText),
    expectedPromptSha256: preview.promptSha256,
    confirmedRankableEntryIds: [rb[2].id],
    modelLabel: "On-time model",
    statedGeneratedAt: null,
    sourceReference: null,
    sourceNote: null,
  });
  const lateText = `1. ${rb[4].name}\n`;
  const recorded = await recordWaiverAiEvidence({
    adminUserId: f.adminUserId,
    contestId: rbContest,
    universalProfileId: ai.late,
    responseText: lateText,
    expectedResponseSha256: sha256Utf8(lateText),
    modelLabel: "Late model",
    statedSourceAt: null,
    evidenceSource: "CHAT_EXPORT",
    evidenceReference: "late-export.json",
    note: null,
  });
  lateEvidence = { id: recorded.evidenceId, text: lateText };

  // Strictly after the pre-lock evidence: timestamps are millisecond-precision.
  lockAt = new Date(Date.now() + 5);
  await f.passLock(rbContest, lockAt);
  await ensureWaiverContestLocked(rbContest);
  humanBoardsBefore = await humanBoardsJson();
  contestsBefore = JSON.stringify(await prisma.waiverContest.findMany({ where: { weekId }, orderBy: { id: "asc" } }));
  humanConsensusBefore = await humanConsensusJson();
}, 180_000);

afterAll(async () => {
  await f?.cleanup();
});

describe("admin competitive override: post-lock entry", () => {
  it("enters the exact response as a LOCKED board at the actual database time, without any original timestamp", async () => {
    const text = `1. ${rb[3].name}\n2. ${rb[1].name}\n`;
    const result = await override(ai.ok, text, { sourceReference: "operator archive" });
    expect(result).toMatchObject({ callCount: 2, noCalls: false, responseSha256: sha256Utf8(text) });
    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: rbContest } });
    expect(result.importedAt.getTime()).toBeGreaterThanOrEqual(contest.locksAt.getTime());

    const row = await prisma.waiverAiCompetitiveOverride.findUniqueOrThrow({ where: { id: result.overrideId } });
    expect(row).toMatchObject({
      contestId: rbContest,
      position: "RB",
      snapshotId,
      universalProfileId: ai.ok,
      evidenceId: null,
      responseSha256: sha256Utf8(text),
      callCount: 2,
      modelLabel: "Override model v1",
      reason: WAIVER_AI_LATE_SUBMISSION_REASON,
      sourceReference: "operator archive",
      submissionId: result.submissionId,
      revisionId: result.revisionId,
      confirmation: sha256Utf8(text).slice(0, 12),
      authorizedByUserId: f.adminUserId,
    });
    expect(row.authorizedAt.getTime()).toBe(result.importedAt.getTime());

    const board = await prisma.waiverSubmission.findUniqueOrThrow({
      where: { id: result.submissionId },
      include: { revisions: { include: { calls: { orderBy: { slot: "asc" }, include: { snapshotEntry: true } }, aiResponse: true } }, lateEntry: true },
    });
    expect(board).toMatchObject({
      authority: "SYSTEM_OPERATED",
      status: "LOCKED",
      createdByUserId: f.adminUserId,
      currentRevisionId: result.revisionId,
      lockedRevisionId: result.revisionId,
      lateEntry: null,
    });
    expect(board.submittedAt!.getTime()).toBe(row.authorizedAt.getTime());
    expect(board.lockedAt!.getTime()).toBe(row.authorizedAt.getTime());
    expect(board.revisions).toHaveLength(1);
    const [revision] = board.revisions;
    expect(revision).toMatchObject({ revisionNumber: 1, kind: "SUBMISSION", authorUserId: f.adminUserId, callCount: 2 });
    expect(revision.createdAt.getTime()).toBe(row.authorizedAt.getTime());
    expect(revision.calls.map((call) => call.snapshotEntry.rankableEntryId)).toEqual([rb[3].id, rb[1].id]);
    expect(revision.aiResponse).toMatchObject({
      responseText: text,
      responseSha256: sha256Utf8(text),
      promptVersion: null,
      promptSha256: null,
      statedGeneratedAt: null,
      modelLabel: "Override model v1",
      importedByUserId: f.adminUserId,
      sourceReference: `admin competitive override ${row.id}`,
    });
    // No verification, evidence or provider time exists for this board.
    expect(await prisma.waiverAiLateEntryVerification.count({ where: { universalProfileId: ai.ok } })).toBe(0);
    expect(await prisma.waiverAiHistoricalEvidence.count({ where: { universalProfileId: ai.ok } })).toBe(0);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "waivers.ai_competitive_override", entityId: result.submissionId } });
    expect(audit).toMatchObject({ adminUserId: f.adminUserId, entityType: "WaiverSubmission" });
    expect(audit.metadata).toMatchObject({ overrideId: row.id, reason: row.reason, responseSha256: row.responseSha256, importedAt: row.authorizedAt.toISOString() });

    const view = await loadWaiverAiBoardView(ai.ok, rbContest);
    expect(view!.board).toMatchObject({ entryBasis: "ADMIN_COMPETITIVE_OVERRIDE", lateEntry: null, lockedRevisionNumber: 1 });
    expect(view!.board!.competitiveOverride).toMatchObject({ overrideId: row.id, reason: row.reason, evidenceId: null, authorizedByLabel: expect.any(String) });
    expect(view!.board!.competitiveOverride!.importedAt.getTime()).toBe(row.authorizedAt.getTime());
    expect(view!.lateSubmission.blockers).toEqual([expect.stringMatching(/already has a board/)]);
    const week = await loadWaiverAiWeekView(weekId);
    expect(week!.cells[ai.ok]!.RB).toMatchObject({ status: "LOCKED", overridden: true, lateEntered: false });
    expect(week!.cells[ai.ontime]!.RB).toMatchObject({ overridden: false });
  });

  it("accepts a valid NO CALLS response and refuses invalid frozen-pool selections whole", async () => {
    const none = await override(ai.nocalls, "NO CALLS\n");
    expect(none).toMatchObject({ callCount: 0, noCalls: true });
    expect(await boardRows(ai.nocalls)).toEqual({ submissions: 1, revisions: 1, calls: 0, responses: 1, overrides: 1 });

    const invalid = [
      { text: "1. Nobody Atall\n", code: "UNKNOWN_PLAYER" },
      { text: `1. ${rb[1].name}\n2. ${rb[1].name}\n`, code: "DUPLICATE_PLAYER" },
      { text: `1. ${rb[0].name}\n`, code: "AMBIGUOUS_PLAYER" },
      { text: `1. ${wr[0].name}\n`, code: "WRONG_POSITION" },
      { text: `1. ${rb[1].name}\n2. ${rb[2].name}\n3. ${rb[3].name}\n4. ${rb[4].name}\n`, code: "TOO_MANY_CALLS" },
    ];
    for (const { text, code } of invalid) {
      let error: unknown = null;
      try {
        await override(ai.invalid, text, { confirmedRankableEntryIds: [] });
      } catch (caught) {
        error = caught;
      }
      expect(error, code).toBeInstanceOf(WaiverAiError);
      expect((error as WaiverAiError).code, code).toBe("INVALID_RESPONSE");
      expect((error as WaiverAiError).issues.map((issue) => issue.code), code).toContain(code);
    }
    expect(await boardRows(ai.invalid)).toEqual(NONE);
  });

  it("requires “Allow late AI submission” and a matching preview, and refuses an oversized model label", async () => {
    const text = `1. ${rb[1].name}\n`;
    await expectAiError(override(ai.unauth, text, { allowLateSubmission: false }), "INVALID_INPUT", /Allow late AI submission/);
    await expectAiError(override(ai.unauth, text, { modelLabel: "m".repeat(121) }), "INVALID_INPUT", /model label/);
    await expectAiError(override(ai.unauth, text, { expectedResponseSha256: sha256Utf8(`${text} `) }), "RESPONSE_HASH_MISMATCH");
    await expectAiError(override(ai.unauth, text, { confirmedRankableEntryIds: [rb[2].id] }), "PREVIEW_MISMATCH");
    expect(await boardRows(ai.unauth)).toEqual(NONE);
  });

  it("needs no typed hash or reason: records the fixed reason, the server-derived confirmation and the profile name when the label is blank", async () => {
    const text = `1. ${rb[2].name}\n2. ${rb[4].name}\n`;
    const result = await override(ai.label, text, { modelLabel: "   " });
    const row = await prisma.waiverAiCompetitiveOverride.findUniqueOrThrow({ where: { id: result.overrideId } });
    expect(row).toMatchObject({ reason: WAIVER_AI_LATE_SUBMISSION_REASON, confirmation: sha256Utf8(text).slice(0, 12), modelLabel: "AI ovrlabel" });
    const response = await prisma.waiverAiResponse.findUniqueOrThrow({ where: { revisionId: result.revisionId } });
    expect(response).toMatchObject({ modelLabel: "AI ovrlabel", responseText: text, responseSha256: sha256Utf8(text) });
    // The original response is immutable once submitted.
    await expectDbGuard(prisma.waiverAiResponse.update({ where: { revisionId: result.revisionId }, data: { responseText: `${text}3. x\n` } }), "WAIVER_IMMUTABLE");
    expect((await loadWaiverAiBoardView(ai.label, rbContest))!.board!.entryBasis).toBe("ADMIN_COMPETITIVE_OVERRIDE");
  });
});

describe("admin competitive override: authorization and eligibility", () => {
  it("refuses ordinary users and demoted admins, in the service and at the database", async () => {
    const text = `1. ${rb[2].name}\n`;
    const demoted = await f.addAdmin("ovrdemoted");
    await prisma.user.update({ where: { id: demoted.userId }, data: { role: "USER" } });
    for (const userId of [human.userId, demoted.userId]) {
      await expectAiError(override(ai.unauth, text, { adminUserId: userId }), "FORBIDDEN");
    }
    await expectDbGuard(rawOverrideTransaction({ profileId: ai.unauth, text, pickIds: [rb[2].id], key: "user", authorizedByUserId: human.userId }), "WAIVER_INVALID");
    expect(await boardRows(ai.unauth)).toEqual(NONE);
  });

  it("refuses HUMAN and CREATOR profiles and inactive AI competitors", async () => {
    const text = `1. ${rb[2].name}\n`;
    await expectAiError(override(creator.profileId, text), "NOT_AI_COMPETITOR");
    await expectAiError(override(ai.inactive, text), "NOT_AI_COMPETITOR");
    for (const [profileId, key] of [
      [creator.profileId, "creator"],
      [ai.inactive, "inactive"],
    ] as const) {
      await expectDbGuard(rawOverrideTransaction({ profileId, text, pickIds: [rb[2].id], key }), "WAIVER_INVALID");
      expect(await boardRows(profileId)).toEqual(NONE);
    }
    // A human with an owner-authored board is refused before anything is written.
    await expectAiError(override(human.profileId, text), "NOT_AI_COMPETITOR");
    expect(await humanBoardsJson()).toBe(humanBoardsBefore);
  });

  it("is refused before the lock: the ordinary import is the only path", async () => {
    const text = `1. ${rb[1].name}\n`;
    await expectAiError(override(ai.open, text, { contestId: openContest }), "INVALID_INPUT", /still open/);
    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: openContest } });
    const sha = sha256Utf8(text);
    await expectDbGuard(
      prisma.waiverAiCompetitiveOverride.create({
        data: {
          contestId: openContest,
          position: "RB",
          snapshotId: contest.snapshotId,
          universalProfileId: ai.open,
          responseSha256: sha,
          boardFingerprint: "a".repeat(64),
          callCount: 1,
          parserVersion: "WAIVEREYEQ_AI_PARSER_V1",
          modelLabel: "x",
          reason: "early",
          submissionId: "ovr-open-sub",
          revisionId: "ovr-open-rev",
          confirmation: sha.slice(0, 12),
          authorizedByUserId: f.adminUserId,
        },
      }),
      "WAIVER_INVALID",
    );
    expect(await boardRows(ai.open)).toEqual(NONE);
  });

  it("binds the optional evidence to the same contest, AI, snapshot and response, and refuses rejected evidence", async () => {
    const text = `1. ${rb[4].name}\n2. ${rb[2].name}\n`;
    const other = `1. ${rb[3].name}\n`;
    const record = (responseText: string, reference: string) =>
      recordWaiverAiEvidence({
        adminUserId: f.adminUserId,
        contestId: rbContest,
        universalProfileId: ai.evid,
        responseText,
        expectedResponseSha256: sha256Utf8(responseText),
        modelLabel: "Evidence model",
        statedSourceAt: null,
        evidenceSource: "COPIED_TEXT",
        evidenceReference: reference,
        note: null,
      });
    const same = await record(text, "same.txt");
    const different = await record(other, "other.txt");
    await expectAiError(override(ai.evid, text, { evidenceId: different.evidenceId }), "CONFLICT", /same response/);
    await expectAiError(override(ai.evid, text, { evidenceId: lateEvidence.id }), "CONFLICT", /same response/);
    await reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: same.evidenceId, expectedSequence: 0, status: "REJECTED", note: "wrong chat" });
    await expectAiError(override(ai.evid, text, { evidenceId: same.evidenceId }), "CONFLICT", /rejected evidence/);
    expect(await boardRows(ai.evid)).toEqual(NONE);
    await reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: same.evidenceId, expectedSequence: 1, status: "TEXT_CONFIRMED", note: "re-checked" });
    const result = await override(ai.evid, text, { evidenceId: same.evidenceId });
    expect(await prisma.waiverAiCompetitiveOverride.findUniqueOrThrow({ where: { id: result.overrideId } })).toMatchObject({ evidenceId: same.evidenceId });
    // Evidence attachment never turns an override into a verified late entry.
    expect(await prisma.waiverAiLateEntryApproval.count({ where: { universalProfileId: ai.evid } })).toBe(0);
    expect((await loadWaiverAiBoardView(ai.evid, rbContest))!.board!.entryBasis).toBe("ADMIN_COMPETITIVE_OVERRIDE");
  });
});

describe("admin competitive override: replacement, duplicates and replay", () => {
  it("never replaces an existing on-time, overridden or late-entered board", async () => {
    // Verified late entry through the unchanged 4B.3B path.
    const context = await loadWaiverAiContestContext(prisma, rbContest);
    await reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: lateEvidence.id, expectedSequence: 0, status: "TEXT_CONFIRMED", note: "matches export" });
    const verified = await verifyWaiverAiLateEntry({
      adminUserId: f.adminUserId,
      evidenceId: lateEvidence.id,
      expectedSequence: 0,
      basis: "DATABASE_RECORDED_PRE_LOCK",
      originalPredictionAt: null,
      sourceReference: "late-export.json",
      artifact: null,
      expectedPromptSha256: context!.prompt.sha256,
      originalPrompt: { version: null, reference: null, text: null },
      confirmedRankableEntryIds: [rb[4].id],
      attestation: "export reviewed",
    });
    expect(verified.eligible).toBe(true);
    await approveWaiverAiLateEntry({
      adminUserId: f.adminUserId,
      verificationId: verified.verificationId,
      confirmation: sha256Utf8(lateEvidence.text).slice(0, 12),
      confirmedRankableEntryIds: [rb[4].id],
      note: null,
    });
    expect((await loadWaiverAiBoardView(ai.late, rbContest))!.board!.entryBasis).toBe("VERIFIED_LATE_ENTRY");

    const text = `1. ${rb[1].name}\n`;
    for (const key of ["ontime", "ok", "late"]) {
      const before = await boardJson(ai[key]);
      await expectAiError(override(ai[key], text), "CONFLICT", /already has a board/);
      expect(await boardJson(ai[key])).toBe(before);
    }
    // At the database: a second authorization for the same AI and contest, or for an AI with a board.
    for (const key of ["ok", "ontime", "late"]) {
      await expectDbGuard(rawOverrideTransaction({ profileId: ai[key], text, pickIds: [rb[1].id], key: `dup-${key}` }), "WAIVER_INVALID");
    }
    expect(await prisma.waiverAiCompetitiveOverride.count({ where: { universalProfileId: { in: [ai.ok, ai.ontime, ai.late] } } })).toBe(1);
  });

  it("a committed override authorizes nothing later, and an authorization cannot create another AI's board", async () => {
    const row = await prisma.waiverAiCompetitiveOverride.findUniqueOrThrow({ where: { contestId_universalProfileId: { contestId: rbContest, universalProfileId: ai.ok } } });
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({
        data: {
          submissionId: row.submissionId,
          revisionNumber: 2,
          kind: "SUBMISSION",
          snapshotId,
          callCount: 0,
          fingerprint: "d".repeat(64),
          authorUserId: f.adminUserId,
          createdAt: new Date(),
        },
      }),
      "WAIVER_LOCKED",
    );
    const entry = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId, rankableEntryId: rb[4].id } });
    await expectDbGuard(prisma.waiverCall.create({ data: { revisionId: row.revisionId, slot: 3, snapshotEntryId: entry.id } }), "WAIVER_LOCKED");
    await expectDbGuard(prisma.waiverSubmission.update({ where: { id: row.submissionId }, data: { lockedAt: new Date(), submittedAt: new Date() } }), "WAIVER_LOCKED");
    await expectDbGuard(prisma.waiverAiResponse.update({ where: { revisionId: row.revisionId }, data: { modelLabel: "edited" } }), "WAIVER_IMMUTABLE");

    // An override for one AI never admits a board for a different AI.
    await expectDbGuard(
      rawOverrideTransaction({ profileId: ai.replay, boardProfileId: ai.unauth, text: `1. ${rb[1].name}\n`, pickIds: [rb[1].id], key: "swap" }),
      "WAIVER_LOCKED",
    );
    expect(await boardRows(ai.replay)).toEqual(NONE);
    expect(await boardRows(ai.unauth)).toEqual(NONE);
  });
});

describe("admin competitive override: atomicity, immutability and ordinary paths", () => {
  it("a mismatched or partial board rolls back the whole transaction, including the authorization", async () => {
    const text = `1. ${rb[3].name}\n2. ${rb[4].name}\n`;
    const pickIds = [rb[3].id, rb[4].id];
    await expectDbGuard(rawOverrideTransaction({ profileId: ai.rollback, text, pickIds, key: "reorder", reorder: true }), "WAIVER_INVALID");
    await expectDbGuard(rawOverrideTransaction({ profileId: ai.rollback, text, pickIds, key: "noresp", withResponse: false }), "WAIVER_INVALID");
    await expectDbGuard(rawOverrideTransaction({ profileId: ai.rollback, text, pickIds, key: "prompt", promptClaim: true }), "WAIVER_INVALID");
    await expectDbGuard(rawOverrideTransaction({ profileId: ai.rollback, text, pickIds, key: "label", modelLabel: "Other model" }), "WAIVER_INVALID");
    expect(await boardRows(ai.rollback)).toEqual(NONE);
    // A raw transaction that matches its authorization exactly commits; the database is the authority, not the service.
    await rawOverrideTransaction({ profileId: ai.rollback, text, pickIds, key: "exact" });
    expect(await boardRows(ai.rollback)).toEqual({ submissions: 1, revisions: 1, calls: 2, responses: 1, overrides: 1 });
  });

  it("override, response and revision records are immutable and untruncatable", async () => {
    const row = await prisma.waiverAiCompetitiveOverride.findUniqueOrThrow({ where: { contestId_universalProfileId: { contestId: rbContest, universalProfileId: ai.ok } } });
    await expectDbGuard(prisma.waiverAiCompetitiveOverride.update({ where: { id: row.id }, data: { reason: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverAiCompetitiveOverride.delete({ where: { id: row.id } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.$executeRawUnsafe('TRUNCATE "WaiverAiCompetitiveOverride"'), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverAiResponse.delete({ where: { revisionId: row.revisionId } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverSubmissionRevision.delete({ where: { id: row.revisionId } }), "WAIVER_IMMUTABLE");
    expect(await prisma.waiverAiCompetitiveOverride.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it("keeps ordinary post-lock write paths blocked", async () => {
    const text = `1. ${rb[1].name}\n`;
    const context = await loadWaiverAiContestContext(prisma, rbContest);
    await expectAiError(
      importAiWaiverBoard({
        adminUserId: f.adminUserId,
        contestId: rbContest,
        universalProfileId: ai.replay,
        responseText: text,
        expectedResponseSha256: sha256Utf8(text),
        expectedPromptSha256: context!.prompt.sha256,
        confirmedRankableEntryIds: [rb[1].id],
        modelLabel: "x",
        statedGeneratedAt: null,
        sourceReference: null,
        sourceNote: null,
      }),
      "LOCKED",
    );
    await expect(
      submitWaiverBoard({ contestId: rbContest, universalProfileId: human.profileId, userId: human.userId, playerIds: [rb[4].id] }),
    ).rejects.toThrow();
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId: rbContest, universalProfileId: ai.replay, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } }),
      "WAIVER_LOCKED",
    );
    const humanBoard = await prisma.waiverSubmission.findFirstOrThrow({ where: { contestId: rbContest, universalProfileId: human.profileId } });
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({
        data: {
          submissionId: humanBoard.id,
          revisionNumber: 3,
          kind: "SUBMISSION",
          snapshotId,
          callCount: 0,
          fingerprint: "e".repeat(64),
          authorUserId: human.userId,
          createdAt: new Date(lockAt.getTime() - 1000),
        },
      }),
      "WAIVER_LOCKED",
    );
    expect(await boardRows(ai.replay)).toEqual(NONE);
  });
});

describe("admin competitive override: competition", () => {
  it("is selected at its locked revision for lock and grade time, revealed with its designation, and never enters human consensus", async () => {
    await ensureWaiverContestLocked(rbContest);
    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: rbContest } });
    const row = await prisma.waiverAiCompetitiveOverride.findUniqueOrThrow({ where: { contestId_universalProfileId: { contestId: rbContest, universalProfileId: ai.ok } } });
    const board = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: row.submissionId } });
    expect(board.lockedRevisionId).toBe(row.revisionId);
    expect(board.lockedAt!.getTime()).toBe(row.authorizedAt.getTime());

    const finals = await loadFinalWaiverBoards(prisma, { contestId: rbContest, locksAt: contest.locksAt });
    expect(finals.find((final) => final.submissionId === row.submissionId)?.revisionId).toBe(row.revisionId);

    const revealed = await loadRevealableWaiverBoards(rbContest);
    expect(revealed.revealed).toBe(true);
    const boards = revealed.boards;
    const shown = boards.find((b) => b.submissionId === row.submissionId)!;
    expect(shown).toMatchObject({ entryBasis: "ADMIN_COMPETITIVE_OVERRIDE", lateEntry: null, lockedRevisionId: row.revisionId, authority: "SYSTEM_OPERATED" });
    expect(shown.competitiveOverride!.importedAt.getTime()).toBe(row.authorizedAt.getTime());
    expect(boards.find((b) => b.universalProfileId === ai.ontime)).toMatchObject({ entryBasis: "ON_TIME", competitiveOverride: null });
    expect(boards.find((b) => b.universalProfileId === ai.late)).toMatchObject({ entryBasis: "VERIFIED_LATE_ENTRY", competitiveOverride: null });

    const humans = filterWaiverBoardsByCategory(boards, "HUMANS");
    expect(humans.length).toBe(2);
    expect(humans.every((b) => b.authority === "OWNER_AUTHORED" && b.entryBasis === "ON_TIME")).toBe(true);
    const aiBoards = filterWaiverBoardsByCategory(boards, "AI");
    const allBoards = filterWaiverBoardsByCategory(boards, "ALL");
    expect(aiBoards.some((b) => b.submissionId === row.submissionId)).toBe(true);
    expect(allBoards.some((b) => b.submissionId === row.submissionId)).toBe(true);
    expect(allBoards).toHaveLength(humans.length + aiBoards.length);

    expect(await humanConsensusJson()).toBe(humanConsensusBefore);
    expect(await humanBoardsJson()).toBe(humanBoardsBefore);
    expect(JSON.stringify(await prisma.waiverContest.findMany({ where: { weekId }, orderBy: { id: "asc" } }))).toBe(contestsBefore);
    expect(await prisma.waiverGradeRun.count({ where: { weekId } })).toBe(0);
  });
});
