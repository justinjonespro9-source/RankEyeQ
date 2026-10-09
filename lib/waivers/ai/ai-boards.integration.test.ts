import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, expectDbGuard, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadRevealableWaiverBoards } from "@/lib/waivers/access-queries";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { loadWaiverAiBoardView, loadWaiverAiWeekView } from "@/lib/waivers/ai/queries";
import { importAiWaiverBoard, previewWaiverAiResponse, WaiverAiError, type WaiverAiBoardImportInput } from "@/lib/waivers/ai/submissions";
import { sha256Utf8, utf8ByteLength } from "@/lib/waivers/ai/text";
import { filterWaiverBoardsByCategory } from "@/lib/waivers/competitor-category";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { waiverBoardFingerprint } from "@/lib/waivers/fingerprint";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

let f: WaiverFixture;
let weekId: string;
let snapshotId: string;
let wr: FixturePlayer[];
let qb: FixturePlayer[];
let te: FixturePlayer[];
let wrContestId: string;
let qbContestId: string;
let teContestId: string;
let aiOne: string;
let aiTwo: string;
let aiInactive: string;
let aiSpare: string;
let human: { userId: string; profileId: string };
let ownerAdmin: { userId: string; profileId: string };

async function expectAiError(promise: Promise<unknown>, code: string) {
  let error: unknown = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, `expected ${code}`).toBeInstanceOf(WaiverAiError);
  expect((error as WaiverAiError).code).toBe(code);
  return error as WaiverAiError;
}

/** What the admin page does: preview, then confirm exactly the previewed picks. */
async function importBoard(profileId: string, contestId: string, responseText: string, overrides: Partial<WaiverAiBoardImportInput> = {}) {
  const adminUserId = overrides.adminUserId ?? f.adminUserId;
  const preview = await previewWaiverAiResponse({ adminUserId, contestId, responseText });
  return importAiWaiverBoard({
    adminUserId,
    contestId,
    universalProfileId: profileId,
    responseText,
    expectedResponseSha256: sha256Utf8(responseText),
    expectedPromptSha256: preview.promptSha256,
    confirmedRankableEntryIds: preview.parse.picks.map((pick) => pick.rankableEntryId),
    modelLabel: "Fixture model 1.0",
    statedGeneratedAt: null,
    sourceReference: null,
    sourceNote: null,
    ...overrides,
  });
}

async function rowCounts(contestId: string) {
  const [submissions, revisions, calls, responses] = await Promise.all([
    prisma.waiverSubmission.count({ where: { contestId } }),
    prisma.waiverSubmissionRevision.count({ where: { submission: { contestId } } }),
    prisma.waiverCall.count({ where: { revision: { submission: { contestId } } } }),
    prisma.waiverAiResponse.count({ where: { contestId } }),
  ]);
  return { submissions, revisions, calls, responses };
}

beforeAll(async () => {
  f = await createWaiverFixture("aiboard");
  wr = await f.addPlayers("WR", 6);
  qb = await f.addPlayers("QB", 3);
  te = await f.addPlayers("TE", 3);
  const week = await f.addWeek();
  weekId = week.weekId;
  const snapshot = await f.freezeSnapshot({ weekId, rows: [...wr, ...qb, ...te].map((player) => ({ player })) });
  snapshotId = snapshot.id;
  wrContestId = (await f.createContest({ weekId, snapshotId, position: "WR" })).id;
  qbContestId = (await f.createContest({ weekId, snapshotId, position: "QB" })).id;
  teContestId = (await f.createContest({ weekId, snapshotId, position: "TE" })).id;
  aiOne = (await f.addAiCompetitor("one")).profileId;
  aiTwo = (await f.addAiCompetitor("two")).profileId;
  aiSpare = (await f.addAiCompetitor("spare")).profileId;
  aiInactive = (await f.addAiCompetitor("off", { competitorActive: false })).profileId;
  human = await f.addParticipant("human");
  ownerAdmin = await f.addParticipant("owneradmin");
  await prisma.user.update({ where: { id: ownerAdmin.userId }, data: { role: "ADMIN" } });
}, 120_000);

afterAll(async () => {
  await f?.cleanup();
});

describe("AI board import (system-operated)", () => {
  it("writes the submission, revision, calls and verbatim response in one transaction", async () => {
    const text = `1. ${wr[1].name}\r\n2. ${wr[0].name}\r\n`;
    const stated = new Date(Date.now() - 60_000);
    const result = await importBoard(aiOne, wrContestId, text, { statedGeneratedAt: stated, sourceReference: "chat link", sourceNote: "  note  " });
    expect(result).toMatchObject({ revisionNumber: 1, callCount: 2, noCalls: false, changed: true, responseSha256: sha256Utf8(text) });

    const submission = await prisma.waiverSubmission.findUniqueOrThrow({
      where: { id: result.submissionId },
      include: { currentRevision: { include: { calls: { orderBy: { slot: "asc" }, include: { snapshotEntry: true } }, aiResponse: true } } },
    });
    expect(submission).toMatchObject({ authority: "SYSTEM_OPERATED", createdByUserId: f.adminUserId, universalProfileId: aiOne, status: "SUBMITTED" });
    const revision = submission.currentRevision!;
    expect(revision).toMatchObject({ kind: "SUBMISSION", authorUserId: f.adminUserId, callCount: 2, snapshotId });
    expect(revision.calls.map((call) => [call.slot, call.snapshotEntry.rankableEntryId])).toEqual([
      [1, wr[1].id],
      [2, wr[0].id],
    ]);
    const context = await loadWaiverAiContestContext(prisma, wrContestId);
    expect(revision.aiResponse).toMatchObject({
      responseText: text,
      responseSha256: sha256Utf8(text),
      responseByteLength: utf8ByteLength(text),
      promptVersion: "WAIVEREYEQ_AI_V1",
      promptSha256: context!.prompt.sha256,
      parserVersion: "WAIVEREYEQ_AI_PARSER_V1",
      modelLabel: "Fixture model 1.0",
      universalProfileId: aiOne,
      contestId: wrContestId,
      position: "WR",
      snapshotId,
      importedByUserId: f.adminUserId,
      noCalls: false,
      statedGeneratedAt: stated,
      sourceReference: "chat link",
      sourceNote: "note",
    });
    // importedAt is the database clock at the response insert, in the same transaction as the revision.
    const lag = revision.aiResponse!.importedAt.getTime() - revision.createdAt.getTime();
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThan(5_000);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "waivers.ai_board_submitted", entityId: result.submissionId } });
    expect(audit.adminUserId).toBe(f.adminUserId);
  });

  it("the same response is a no-op; a new one appends a revision and keeps the old one and its response", async () => {
    const first = `1. ${wr[1].name}\r\n2. ${wr[0].name}\r\n`;
    expect(await importBoard(aiOne, wrContestId, first)).toMatchObject({ changed: false, revisionNumber: 1 });
    const second = `1. ${wr[2].name}`;
    const result = await importBoard(aiOne, wrContestId, second);
    expect(result).toMatchObject({ changed: true, revisionNumber: 2, callCount: 1 });
    const revisions = await prisma.waiverSubmissionRevision.findMany({
      where: { submissionId: result.submissionId },
      orderBy: { revisionNumber: "asc" },
      include: { aiResponse: true, calls: true },
    });
    expect(revisions.map((revision) => [revision.revisionNumber, revision.aiResponse?.responseText, revision.calls.length])).toEqual([
      [1, first, 2],
      [2, second, 1],
    ]);
  });

  it("one admin submits boards for several AIs in the same contest, including NO CALLS", async () => {
    const result = await importBoard(aiTwo, wrContestId, "NO CALLS");
    expect(result).toMatchObject({ callCount: 0, noCalls: true });
    const boards = await prisma.waiverSubmission.findMany({ where: { contestId: wrContestId, createdByUserId: f.adminUserId } });
    expect(boards.map((board) => board.universalProfileId).sort()).toEqual([aiOne, aiTwo].sort());
    const response = await prisma.waiverAiResponse.findFirstOrThrow({ where: { contestId: wrContestId, universalProfileId: aiTwo } });
    expect(response).toMatchObject({ noCalls: true, responseText: "NO CALLS" });
  });

  it("an admin with their own human profile still submits their own owner board alongside AI boards", async () => {
    await importBoard(aiOne, qbContestId, `1. ${qb[0].name}`, { adminUserId: ownerAdmin.userId });
    const own = await submitWaiverBoard({ userId: ownerAdmin.userId, universalProfileId: ownerAdmin.profileId, contestId: qbContestId, playerIds: [qb[1].id] });
    expect(own.status).toBe("SUBMITTED");
    const rows = await prisma.waiverSubmission.findMany({ where: { contestId: qbContestId, createdByUserId: ownerAdmin.userId }, orderBy: { authority: "asc" } });
    expect(rows.map((row) => [row.authority, row.universalProfileId])).toEqual([
      ["OWNER_AUTHORED", ownerAdmin.profileId],
      ["SYSTEM_OPERATED", aiOne],
    ]);
    const [index] = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'WaiverSubmission_contestId_createdByUserId_owner_key'`;
    expect(index.indexdef).toMatch(/UNIQUE INDEX .* \("contestId", "createdByUserId"\) WHERE \(authority = 'OWNER_AUTHORED'::"SubmissionAuthority"\)/);
    const [old] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'WaiverSubmission_contestId_createdByUserId_key'`;
    expect(Number(old.n)).toBe(0);
  });

  it("rejections write nothing", async () => {
    const before = await rowCounts(teContestId);
    const unknown = await expectAiError(importBoard(aiSpare, teContestId, `1. ${te[0].name}\n2. Nobody Real`), "INVALID_RESPONSE");
    expect(unknown.issues.map((issue) => issue.code)).toEqual(["UNKNOWN_PLAYER"]);
    await expectAiError(importBoard(aiSpare, teContestId, `1. ${qb[0].name}`), "INVALID_RESPONSE");
    await expectAiError(importBoard(aiSpare, teContestId, `1. ${te[0].name}`, { expectedResponseSha256: sha256Utf8("other") }), "RESPONSE_HASH_MISMATCH");
    await expectAiError(importBoard(aiSpare, teContestId, `1. ${te[0].name}`, { expectedPromptSha256: "0".repeat(64) }), "PROMPT_CHANGED");
    await expectAiError(importBoard(aiSpare, teContestId, `1. ${te[0].name}`, { confirmedRankableEntryIds: [te[1].id] }), "PREVIEW_MISMATCH");
    await expectAiError(importBoard(aiSpare, teContestId, `1. ${te[0].name}`, { modelLabel: "  " }), "INVALID_INPUT");
    await expectAiError(importBoard(aiSpare, teContestId, `1. ${te[0].name}`, { statedGeneratedAt: new Date(Date.now() + 3_600_000) }), "INVALID_INPUT");
    await expectAiError(importBoard(aiInactive, teContestId, `1. ${te[0].name}`), "NOT_AI_COMPETITOR");
    await expectAiError(importBoard(human.profileId, teContestId, `1. ${te[0].name}`), "NOT_AI_COMPETITOR");
    await expectAiError(
      importAiWaiverBoard({
        adminUserId: human.userId,
        contestId: teContestId,
        universalProfileId: aiSpare,
        responseText: "NO CALLS",
        expectedResponseSha256: sha256Utf8("NO CALLS"),
        expectedPromptSha256: "0".repeat(64),
        confirmedRankableEntryIds: [],
        modelLabel: "x",
        statedGeneratedAt: null,
        sourceReference: null,
        sourceNote: null,
      }),
      "FORBIDDEN",
    );
    await expectAiError(previewWaiverAiResponse({ adminUserId: human.userId, contestId: teContestId, responseText: "NO CALLS" }), "FORBIDDEN");
    expect(await rowCounts(teContestId)).toEqual(before);
  });

  it("read models classify AI boards and keep them out of the human-only category", async () => {
    const week = await loadWaiverAiWeekView(weekId);
    expect(week!.cells[aiOne]?.WR).toMatchObject({ status: "SUBMITTED", revisionNumber: 2, callCount: 1 });
    expect(week!.cells[aiTwo]?.WR).toMatchObject({ status: "SUBMITTED", callCount: 0 });
    expect(week!.cells[aiSpare]?.TE).toMatchObject({ status: "MISSING" });
    expect(week!.competitors.find((c) => c.id === aiInactive)).toBeUndefined();
    expect(week!.contests.every((contest) => contest.promptText !== null && contest.snapshot.id === snapshotId)).toBe(true);
    const board = await loadWaiverAiBoardView(aiOne, wrContestId);
    expect(board!.board!.revisions.map((revision) => revision.revisionNumber)).toEqual([2, 1]);
    expect(await loadWaiverAiBoardView(human.profileId, wrContestId)).toBeNull();
  });
});

describe("the Waiver lock", () => {
  it("refuses AI boards at and after lock, stamps pre-lock AI boards like any other, and reveals them only by category", async () => {
    await importBoard(aiSpare, teContestId, `1. ${te[2].name}\n2. ${te[0].name}`);
    const human2 = await f.addParticipant("humanlock");
    await submitWaiverBoard({ userId: human2.userId, universalProfileId: human2.profileId, contestId: teContestId, playerIds: [te[1].id] });
    await f.passLock(teContestId);
    const before = await rowCounts(teContestId);
    await expectAiError(importBoard(aiSpare, teContestId, `1. ${te[1].name}`), "LOCKED");
    await expectAiError(importBoard(aiOne, teContestId, "NO CALLS"), "LOCKED");
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId: teContestId, universalProfileId: aiTwo, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } }),
      "WAIVER_LOCKED",
    );
    expect(await rowCounts(teContestId)).toEqual(before);

    const stamp = await ensureWaiverContestLocked(teContestId);
    expect(stamp).toMatchObject({ locked: true, stampedSubmissions: 2 });
    const aiBoard = await prisma.waiverSubmission.findFirstOrThrow({ where: { contestId: teContestId, universalProfileId: aiSpare } });
    expect(aiBoard.status).toBe("LOCKED");
    expect(aiBoard.lockedRevisionId).toBe(aiBoard.currentRevisionId);

    const revealed = await loadRevealableWaiverBoards(teContestId);
    expect(revealed.revealed).toBe(true);
    if (!revealed.revealed) return;
    expect(revealed.boards).toHaveLength(2);
    expect(filterWaiverBoardsByCategory(revealed.boards, "HUMANS").map((board) => board.profileType)).toEqual(["HUMAN"]);
    expect(filterWaiverBoardsByCategory(revealed.boards, "AI").map((board) => [board.profileType, board.authority])).toEqual([["AI", "SYSTEM_OPERATED"]]);
    expect(filterWaiverBoardsByCategory(revealed.boards, "ALL")).toHaveLength(2);

    const view = await loadWaiverAiBoardView(aiSpare, teContestId);
    expect(view).toMatchObject({ phase: "LOCKED", prompt: { text: null }, board: { status: "LOCKED", lockedRevisionNumber: 1 } });
  });
});

describe("database guards", () => {
  async function newContest(position: "RB" | "DEF") {
    const players = await f.addPlayers(position, 2);
    const week = await f.addWeek();
    const snap = await f.freezeSnapshot({ weekId: week.weekId, rows: players.map((player) => ({ player })) });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: snap.id, position });
    return { contestId: contest.id, snapshotId: snap.id, players };
  }

  it("authority must match the profile and creator", async () => {
    const { contestId } = await newContest("RB");
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId, universalProfileId: human.profileId, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId, universalProfileId: aiOne, createdByUserId: f.adminUserId, authority: "OWNER_AUTHORED" } }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId, universalProfileId: aiInactive, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId, universalProfileId: aiOne, createdByUserId: human.userId, authority: "SYSTEM_OPERATED" } }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId, universalProfileId: human.profileId, createdByUserId: ownerAdmin.userId, authority: "OWNER_AUTHORED" } }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId, universalProfileId: aiOne, createdByUserId: f.adminUserId, authority: "RANKEYEQ_CAPTURED" } }),
      "WAIVER_INVALID",
    );
  });

  it("a system-operated board cannot commit without its revision and verbatim response, or with a DRAFT revision", async () => {
    const { contestId, snapshotId: snap } = await newContest("RB");
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.waiverSubmission.create({ data: { contestId, universalProfileId: aiOne, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } });
      }),
    ).rejects.toThrow(/must be submitted with its first revision/);
    const fingerprint = waiverBoardFingerprint({ contestId, snapshotId: snap, rankableEntryIds: [] });
    await expect(
      prisma.$transaction(async (tx) => {
        const at = new Date();
        const s = await tx.waiverSubmission.create({ data: { contestId, universalProfileId: aiOne, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } });
        const r = await tx.waiverSubmissionRevision.create({
          data: { submissionId: s.id, revisionNumber: 1, kind: "SUBMISSION", snapshotId: snap, callCount: 0, fingerprint, authorUserId: f.adminUserId, createdAt: at },
        });
        await tx.waiverSubmission.update({ where: { id: s.id }, data: { status: "SUBMITTED", currentRevisionId: r.id, submittedAt: at } });
      }),
    ).rejects.toThrow(/requires its verbatim AI response/);
    await expect(
      prisma.$transaction(async (tx) => {
        const s = await tx.waiverSubmission.create({ data: { contestId, universalProfileId: aiOne, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } });
        await tx.waiverSubmissionRevision.create({
          data: { submissionId: s.id, revisionNumber: 1, kind: "DRAFT", snapshotId: snap, callCount: 0, fingerprint, authorUserId: f.adminUserId, createdAt: new Date() },
        });
      }),
    ).rejects.toThrow(/take SUBMISSION revisions only/);
    expect(await rowCounts(contestId)).toEqual({ submissions: 0, revisions: 0, calls: 0, responses: 0 });
  });

  it("responses are hash-checked, consistent with their revision, immutable and untruncatable", async () => {
    const { contestId, snapshotId: snap } = await newContest("DEF");
    const fingerprint = waiverBoardFingerprint({ contestId, snapshotId: snap, rankableEntryIds: [] });
    const attempt = (response: { responseSha256?: string; noCalls?: boolean; importedByUserId?: string }) =>
      prisma.$transaction(async (tx) => {
        const at = new Date();
        const s = await tx.waiverSubmission.create({ data: { contestId, universalProfileId: aiTwo, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } });
        const r = await tx.waiverSubmissionRevision.create({
          data: { submissionId: s.id, revisionNumber: 1, kind: "SUBMISSION", snapshotId: snap, callCount: 0, fingerprint, authorUserId: f.adminUserId, createdAt: at },
        });
        await tx.waiverAiResponse.create({
          data: {
            revisionId: r.id,
            contestId,
            position: "DEF",
            snapshotId: snap,
            universalProfileId: aiTwo,
            modelLabel: "m",
            promptVersion: "WAIVEREYEQ_AI_V1",
            promptSha256: "a".repeat(64),
            parserVersion: "WAIVEREYEQ_AI_PARSER_V1",
            responseText: "NO CALLS",
            responseSha256: response.responseSha256 ?? sha256Utf8("NO CALLS"),
            responseByteLength: 8,
            noCalls: response.noCalls ?? true,
            importedByUserId: response.importedByUserId ?? f.adminUserId,
          },
        });
        await tx.waiverSubmission.update({ where: { id: s.id }, data: { status: "SUBMITTED", currentRevisionId: r.id, submittedAt: at } });
      });
    await expect(attempt({ responseSha256: "b".repeat(64) })).rejects.toThrow(/WaiverAiResponse_text_check|check constraint/);
    await expectDbGuard(attempt({ noCalls: false }), "WAIVER_INVALID");
    await expectDbGuard(attempt({ importedByUserId: ownerAdmin.userId }), "WAIVER_INVALID");
    await attempt({});

    const stored = await prisma.waiverAiResponse.findFirstOrThrow({ where: { contestId } });
    await expectDbGuard(prisma.waiverAiResponse.update({ where: { id: stored.id }, data: { modelLabel: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverAiResponse.delete({ where: { id: stored.id } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.$executeRawUnsafe('TRUNCATE "WaiverAiResponse" CASCADE'), "WAIVER_IMMUTABLE");
    expect(await prisma.waiverAiResponse.findUniqueOrThrow({ where: { id: stored.id } })).toEqual(stored);
  });
});
