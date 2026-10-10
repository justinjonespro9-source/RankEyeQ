import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, expectDbGuard, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadRevealableWaiverBoards } from "@/lib/waivers/access-queries";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { recordWaiverAiEvidence, reviewWaiverAiEvidence } from "@/lib/waivers/ai/evidence";
import { approveWaiverAiLateEntry, verifyWaiverAiLateEntry, type WaiverAiLateEntryVerifyInput } from "@/lib/waivers/ai/late-entry";
import { inspectProviderArtifact } from "@/lib/waivers/ai/provider-artifact";
import { loadWaiverAiBoardView, loadWaiverAiWeekView } from "@/lib/waivers/ai/queries";
import { importAiWaiverBoard, parseAgainstContext, previewWaiverAiResponse, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { sha256Utf8 } from "@/lib/waivers/ai/text";
import { filterWaiverBoardsByCategory } from "@/lib/waivers/competitor-category";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { loadFinalWaiverBoards } from "@/lib/waivers/corrections";
import { waiverBoardFingerprint } from "@/lib/waivers/fingerprint";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Stage 4B.3B: controlled administrative late entry. One week with an RB and
 * a WR contest, human boards, an on-time AI board and several AI profiles
 * whose pre-lock predictions are evidenced in different ways. Synthetic local
 * fixtures only.
 */

let f: WaiverFixture;
let weekId: string;
let rbContest: string;
let wrContest: string;
let openContest: string;
let rb: FixturePlayer[];
let wr: FixturePlayer[];
let frozenAt: Date;
let lockAt: Date;
let human: { userId: string; profileId: string };
let human2: { userId: string; profileId: string };
const ai: Record<string, string> = {};
const evidence: Record<string, { id: string; text: string }> = {};
let humanBoardsBefore: string;
let contestsBefore: string;

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

async function record(key: string, contestId: string, profileId: string, text: string, source = "CHAT_EXPORT") {
  const result = await recordWaiverAiEvidence({
    adminUserId: f.adminUserId,
    contestId,
    universalProfileId: profileId,
    responseText: text,
    expectedResponseSha256: sha256Utf8(text),
    modelLabel: `Model ${key}`,
    statedSourceAt: null,
    evidenceSource: source,
    evidenceReference: `${key}-export.json`,
    note: null,
  });
  evidence[key] = { id: result.evidenceId, text };
  return result;
}

async function review(key: string, status: "TEXT_CONFIRMED" | "NEEDS_FOLLOW_UP" | "REJECTED" = "TEXT_CONFIRMED") {
  const latest = await prisma.waiverAiHistoricalEvidenceReview.count({ where: { evidenceId: evidence[key].id } });
  return reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: evidence[key].id, expectedSequence: latest, status, note: `review ${status}` });
}

async function picksOf(key: string) {
  const row = await prisma.waiverAiHistoricalEvidence.findUniqueOrThrow({ where: { id: evidence[key].id } });
  const context = await loadWaiverAiContestContext(prisma, row.contestId);
  const parse = parseAgainstContext(context!, row.responseText);
  return { context: context!, pickIds: parse.picks.map((pick) => pick.rankableEntryId) };
}

async function verify(key: string, overrides: Partial<WaiverAiLateEntryVerifyInput> = {}) {
  const { context, pickIds } = await picksOf(key);
  const latest = await prisma.waiverAiLateEntryVerification.count({ where: { evidenceId: evidence[key].id } });
  return verifyWaiverAiLateEntry({
    adminUserId: f.adminUserId,
    evidenceId: evidence[key].id,
    expectedSequence: latest,
    basis: "DATABASE_RECORDED_PRE_LOCK",
    originalPredictionAt: null,
    sourceReference: `${key}-export.json`,
    artifact: null,
    expectedPromptSha256: context.prompt.sha256,
    originalPrompt: UNKNOWN_PROMPT,
    confirmedRankableEntryIds: pickIds,
    attestation: "Reviewed against the preserved export",
    ...overrides,
  });
}

const UNKNOWN_PROMPT = { version: null, reference: null, text: null };

async function approve(key: string, verificationId: string, overrides: Partial<Parameters<typeof approveWaiverAiLateEntry>[0]> = {}) {
  const { pickIds } = await picksOf(key);
  return approveWaiverAiLateEntry({
    adminUserId: f.adminUserId,
    verificationId,
    confirmation: sha256Utf8(evidence[key].text).slice(0, 12),
    confirmedRankableEntryIds: pickIds,
    note: null,
    ...overrides,
  });
}

/** ChatGPT-style export: a user prompt and the assistant message holding `text`. */
function chatExport(text: string, at: Date, role = "assistant"): { name: string; bytes: Uint8Array; expectedSha256: string } {
  const json = JSON.stringify({
    title: "WaiverEyeQ",
    mapping: {
      p: { id: "p", message: { author: { role: "user" }, create_time: at.getTime() / 1000 - 30, content: { content_type: "text", parts: ["frozen-pool prompt"] } } },
      r: { id: "r", parent: "p", message: { author: { role }, create_time: at.getTime() / 1000, content: { content_type: "text", parts: [text] } } },
    },
  });
  const bytes = new TextEncoder().encode(json);
  return { name: "conversation.json", bytes, expectedSha256: sha256Utf8(json) };
}

function plainFile(content: string) {
  return { name: "notes.txt", bytes: new TextEncoder().encode(content), expectedSha256: sha256Utf8(content) };
}

async function humanBoardsJson() {
  const rows = await prisma.waiverSubmission.findMany({
    where: { contest: { weekId }, authority: "OWNER_AUTHORED" },
    orderBy: { id: "asc" },
    include: { revisions: { orderBy: { revisionNumber: "asc" }, include: { calls: { orderBy: { slot: "asc" } } } } },
  });
  return JSON.stringify(rows);
}

async function boardRows(profileId: string) {
  const [submissions, revisions, calls, responses, approvals] = await Promise.all([
    prisma.waiverSubmission.count({ where: { universalProfileId: profileId } }),
    prisma.waiverSubmissionRevision.count({ where: { submission: { universalProfileId: profileId } } }),
    prisma.waiverCall.count({ where: { revision: { submission: { universalProfileId: profileId } } } }),
    prisma.waiverAiResponse.count({ where: { universalProfileId: profileId } }),
    prisma.waiverAiLateEntryApproval.count({ where: { universalProfileId: profileId } }),
  ]);
  return { submissions, revisions, calls, responses, approvals };
}

const NONE = { submissions: 0, revisions: 0, calls: 0, responses: 0, approvals: 0 };

beforeAll(async () => {
  f = await createWaiverFixture("late");
  rb = await f.addPlayers("RB", 4);
  wr = await f.addPlayers("WR", 3);
  const week = await f.addWeek();
  weekId = week.weekId;
  const snapshot = await f.freezeSnapshot({ weekId, rows: [...rb, ...wr].map((player) => ({ player })) });
  frozenAt = snapshot.frozenAt;
  rbContest = (await f.createContest({ weekId, snapshotId: snapshot.id, position: "RB" })).id;
  wrContest = (await f.createContest({ weekId, snapshotId: snapshot.id, position: "WR" })).id;
  const openWeek = await f.addWeek();
  const openSnapshot = await f.freezeSnapshot({ weekId: openWeek.weekId, rows: rb.map((player) => ({ player })) });
  openContest = (await f.createContest({ weekId: openWeek.weekId, snapshotId: openSnapshot.id, position: "RB" })).id;

  for (const key of ["db", "artifact", "post", "amb", "attest", "ontime", "wrong", "replay", "rollback", "dbWr", "invalid"]) {
    ai[key] = (await f.addAiCompetitor(`late${key}`)).profileId;
  }
  human = await f.addParticipant("latehuman");
  human2 = await f.addParticipant("latehuman2");

  // Before the lock: human boards, an on-time AI board and evidence recorded in RankEyeQ.
  await submitWaiverBoard({ contestId: rbContest, universalProfileId: human.profileId, userId: human.userId, playerIds: [rb[0].id, rb[1].id] });
  await submitWaiverBoard({ contestId: rbContest, universalProfileId: human2.profileId, userId: human2.userId, playerIds: [rb[3].id] });
  await submitWaiverBoard({ contestId: wrContest, universalProfileId: human.profileId, userId: human.userId, playerIds: [wr[0].id] });
  const onTimeText = `1. ${rb[1].name}\n`;
  const preview = await previewWaiverAiResponse({ adminUserId: f.adminUserId, contestId: rbContest, responseText: onTimeText });
  await importAiWaiverBoard({
    adminUserId: f.adminUserId,
    contestId: rbContest,
    universalProfileId: ai.ontime,
    responseText: onTimeText,
    expectedResponseSha256: sha256Utf8(onTimeText),
    expectedPromptSha256: preview.promptSha256,
    confirmedRankableEntryIds: [rb[1].id],
    modelLabel: "On-time model",
    statedGeneratedAt: null,
    sourceReference: null,
    sourceNote: null,
  });
  await record("db", rbContest, ai.db, `1. ${rb[2].name}\n2. ${rb[0].name}\n`);
  await record("amb1", rbContest, ai.amb, `1. ${rb[1].name}\n`);
  await record("amb2", rbContest, ai.amb, `1. ${rb[3].name}\n`);
  await record("dbWr", wrContest, ai.dbWr, `1. ${wr[2].name}\n`);
  await record("rollback", rbContest, ai.rollback, `1. ${rb[3].name}\n2. ${rb[2].name}\n`);

  // Strictly after the pre-lock evidence: timestamps are millisecond-precision.
  lockAt = new Date(Date.now() + 5);
  await f.passLock(rbContest, lockAt);
  await f.passLock(wrContest, lockAt);
  await ensureWaiverContestLocked(rbContest);
  await ensureWaiverContestLocked(wrContest);
  humanBoardsBefore = await humanBoardsJson();
  contestsBefore = JSON.stringify(await prisma.waiverContest.findMany({ where: { weekId }, orderBy: { id: "asc" } }));

  // After the lock: evidence whose pre-lock existence rests on a provider file (or nothing).
  await record("artifact", rbContest, ai.artifact, `1. ${rb[0].name}\n2. ${rb[3].name}\n3. ${rb[1].name}\n`);
  await record("post", rbContest, ai.post, `1. ${rb[2].name}\n`);
  await record("attest", rbContest, ai.attest, `1. ${rb[1].name}\n`, "COPIED_TEXT");
  await record("wrong", rbContest, ai.wrong, `1. ${rb[0].name}\n`);
  await record("replay", rbContest, ai.replay, `1. ${rb[3].name}\n`);
  await record("invalid", rbContest, ai.invalid, "1. Nobody Atall\n");
}, 180_000);

afterAll(async () => {
  await f?.cleanup();
});

/** Midpoint between the pinned snapshot's freeze and the lock (a valid pre-lock provider time). */
const preLockProviderTime = () => new Date(Math.floor((frozenAt.getTime() + lockAt.getTime()) / 2));

describe("late entry: valid pre-lock evidence, post-lock import", () => {
  it("database-recorded pre-lock evidence becomes a LOCKED late board with real timestamps", async () => {
    await review("db");
    const { context } = await picksOf("db");
    const verified = await verify("db", { originalPrompt: { version: null, reference: "prompt archive", text: context.prompt.text } });
    expect(verified).toMatchObject({ eligible: true, ineligibleReason: null, timestampMethod: "DATABASE_CLOCK", sequence: 1, promptEquivalence: "VERIFIED" });
    const stored = await prisma.waiverAiHistoricalEvidence.findUniqueOrThrow({ where: { id: evidence.db.id } });
    expect(verified.originalPredictionAt?.getTime()).toBe(stored.recordedAt.getTime());
    expect(stored.recordedAt.getTime()).toBeLessThan(lockAt.getTime());
    expect(await boardRows(ai.db)).toEqual(NONE);

    const approved = await approve("db", verified.verificationId, { note: "delayed recording" });
    expect(approved.approvedAt.getTime()).toBeGreaterThan(lockAt.getTime());

    const board = await prisma.waiverSubmission.findUniqueOrThrow({
      where: { id: approved.submissionId },
      include: { revisions: { include: { calls: { orderBy: { slot: "asc" }, include: { snapshotEntry: true } }, aiResponse: true } } },
    });
    expect(board).toMatchObject({
      authority: "SYSTEM_OPERATED",
      status: "LOCKED",
      currentRevisionId: approved.revisionId,
      lockedRevisionId: approved.revisionId,
      createdByUserId: f.adminUserId,
    });
    expect(board.submittedAt?.getTime()).toBe(approved.approvedAt.getTime());
    expect(board.lockedAt?.getTime()).toBe(approved.approvedAt.getTime());
    expect(board.revisions).toHaveLength(1);
    const [revision] = board.revisions;
    expect(revision.revisionNumber).toBe(1);
    expect(revision.createdAt.getTime()).toBe(approved.approvedAt.getTime());
    expect(revision.calls.map((call) => call.snapshotEntry.rankableEntryId)).toEqual([rb[2].id, rb[0].id]);
    expect(revision.aiResponse).toMatchObject({ responseText: evidence.db.text, responseSha256: sha256Utf8(evidence.db.text), modelLabel: "Model db" });
    // The preserved original prompt is byte-identical to the canonical prompt, so the board names it.
    expect(revision.aiResponse).toMatchObject({ promptVersion: context.prompt.version, promptSha256: context.prompt.sha256 });
    const storedVerification = await prisma.waiverAiLateEntryVerification.findUniqueOrThrow({ where: { id: verified.verificationId } });
    expect(storedVerification).toMatchObject({
      originalPromptVersion: context.prompt.version,
      originalPromptReference: "prompt archive",
      originalPromptSha256: context.prompt.sha256,
      canonicalPromptSha256: context.prompt.sha256,
      promptEquivalence: "VERIFIED",
    });
    // One administrator may verify and approve, as two separate recorded actions.
    const approvalRow = await prisma.waiverAiLateEntryApproval.findUniqueOrThrow({ where: { id: approved.approvalId } });
    expect(approvalRow.approvedByUserId).toBe(storedVerification.verifiedByUserId);
    expect(approvalRow.approvedAt.getTime()).toBeGreaterThan(storedVerification.verifiedAt.getTime());
    expect(revision.fingerprint).toBe(waiverBoardFingerprint({ contestId: rbContest, snapshotId: revision.snapshotId, rankableEntryIds: [rb[2].id, rb[0].id] }));

    expect(JSON.stringify(await prisma.waiverContest.findMany({ where: { weekId }, orderBy: { id: "asc" } }))).toBe(contestsBefore);
    expect(await prisma.adminAuditLog.count({ where: { action: "waivers.ai_late_entry_verified", entityId: evidence.db.id } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { action: "waivers.ai_late_entry_approved", entityId: approved.submissionId } })).toBe(1);

    const view = await loadWaiverAiBoardView(ai.db, rbContest);
    expect(view!.board!.lateEntry).toMatchObject({ basis: "DATABASE_RECORDED_PRE_LOCK", note: "delayed recording" });
    expect(view!.board!.lateEntry!.originalPredictionAt.getTime()).toBe(stored.recordedAt.getTime());
    expect(view!.board!.lateEntry!.importedAt.getTime()).toBe(approved.approvedAt.getTime());
    const week = await loadWaiverAiWeekView(weekId);
    expect(week!.cells[ai.db]?.RB).toMatchObject({ status: "LOCKED", lateEntered: true });
    expect(week!.cells[ai.ontime]?.RB).toMatchObject({ status: "LOCKED", lateEntered: false });
  });

  it("a provider message timestamp on the message holding the exact response supports a late entry", async () => {
    await review("artifact");
    const at = preLockProviderTime();
    const file = chatExport(evidence.artifact.text, at);
    const legacyPrompt = "Pick up to 3 RB waiver adds for week 5 from this list: …";
    const verified = await verify("artifact", {
      basis: "PROVIDER_ARTIFACT",
      artifact: file,
      originalPrompt: { version: "Legacy weekly waiver prompt", reference: "chat export, first user message", text: legacyPrompt },
    });
    expect(verified).toMatchObject({ eligible: true, timestampMethod: "PROVIDER_MESSAGE", artifactContainsResponse: true, promptEquivalence: "DIFFERENT" });
    expect(verified.originalPredictionAt?.getTime()).toBe(at.getTime());
    const stored = await prisma.waiverAiLateEntryVerification.findUniqueOrThrow({ where: { id: verified.verificationId } });
    expect(stored.artifactContainsResponse).toBe(true);
    // The original file bytes and fingerprint are preserved exactly.
    expect(Buffer.compare(Buffer.from(stored.sourceArtifact!), Buffer.from(file.bytes))).toBe(0);
    expect(stored.sourceArtifactSha256).toBe(file.expectedSha256);
    expect(stored).toMatchObject({
      originalPromptVersion: "Legacy weekly waiver prompt",
      originalPromptText: legacyPrompt,
      originalPromptSha256: sha256Utf8(legacyPrompt),
      promptEquivalence: "DIFFERENT",
    });
    const approved = await approve("artifact", verified.verificationId);
    expect(approved.callCount).toBe(3);
    const revision = await prisma.waiverSubmissionRevision.findUniqueOrThrow({
      where: { id: approved.revisionId },
      include: { calls: { orderBy: { slot: "asc" }, include: { snapshotEntry: true } }, aiResponse: true },
    });
    expect(revision.calls.map((call) => call.snapshotEntry.rankableEntryId)).toEqual([rb[0].id, rb[3].id, rb[1].id]);
    // A different original prompt is never presented as the canonical prompt; the response itself is verbatim.
    expect(revision.aiResponse).toMatchObject({ promptVersion: null, promptSha256: null, responseText: evidence.artifact.text });
    const view = await loadWaiverAiBoardView(ai.artifact, rbContest);
    expect(view!.board!.lateEntry!.prompt).toMatchObject({ equivalence: "DIFFERENT", originalVersion: "Legacy weekly waiver prompt", canonicalSha256: stored.canonicalPromptSha256 });
  });
});

describe("late entry: insufficient evidence stays record-only", () => {
  it("refuses a prediction made at or after the lock", async () => {
    await review("post");
    const late = await verify("post", { basis: "PROVIDER_ARTIFACT", artifact: chatExport(evidence.post.text, new Date(lockAt.getTime())) });
    expect(late).toMatchObject({ eligible: false, ineligibleReason: "NOT_BEFORE_LOCK" });
    await expectAiError(approve("post", late.verificationId), "INVALID_INPUT", /not eligible/);
    const dbAfterLock = await verify("post", { basis: "DATABASE_RECORDED_PRE_LOCK" });
    expect(dbAfterLock).toMatchObject({ eligible: false, ineligibleReason: "NOT_BEFORE_LOCK" });
    expect(await boardRows(ai.post)).toEqual(NONE);
  });

  it("refuses missing, unverifiable, unconfirmed, ambiguous and pre-freeze evidence", async () => {
    await expectAiError(verify("post", { basis: "PROVIDER_ARTIFACT", artifact: null }), "INVALID_INPUT", /provider file/);
    await expectAiError(verify("post", { basis: "MEMORY" }), "INVALID_INPUT");
    const noTime = await verify("post", { basis: "PROVIDER_ARTIFACT", artifact: plainFile("nothing relevant") });
    expect(noTime).toMatchObject({ eligible: false, ineligibleReason: "ARTIFACT_MISSING_RESPONSE", timestampMethod: "ADMIN_READ_FROM_ARTIFACT", originalPredictionAt: null });
    const missing = await verify("post", { basis: "PROVIDER_ARTIFACT", artifact: plainFile("nothing relevant"), originalPredictionAt: preLockProviderTime() });
    expect(missing).toMatchObject({ eligible: false, ineligibleReason: "ARTIFACT_MISSING_RESPONSE", timestampMethod: "ADMIN_READ_FROM_ARTIFACT" });
    // A timestamp counts only on an assistant-attributed message; a user message's time is never borrowed.
    const userOnly = await verify("post", { basis: "PROVIDER_ARTIFACT", artifact: chatExport(evidence.post.text, preLockProviderTime(), "user") });
    expect(userOnly).toMatchObject({ eligible: false, ineligibleReason: "NO_PROVIDER_MESSAGE_TIME", timestampMethod: "ADMIN_READ_FROM_ARTIFACT" });
    const beforeFreeze = await verify("post", { basis: "PROVIDER_ARTIFACT", artifact: chatExport(evidence.post.text, new Date(frozenAt.getTime() - 60_000)) });
    expect(beforeFreeze).toMatchObject({ eligible: false, ineligibleReason: "BEFORE_SNAPSHOT_FROZEN" });

    const attested = await verify("attest", { basis: "OPERATOR_ATTESTED", originalPredictionAt: preLockProviderTime() });
    expect(attested).toMatchObject({ eligible: false, ineligibleReason: "OPERATOR_ATTESTED_ONLY", timestampMethod: "ADMIN_STATED" });

    const unconfirmed = await verify("wrong", { basis: "PROVIDER_ARTIFACT", artifact: chatExport(evidence.wrong.text, preLockProviderTime()) });
    expect(unconfirmed).toMatchObject({ eligible: false, ineligibleReason: "TEXT_NOT_CONFIRMED" });

    await review("amb1");
    const ambiguous = await verify("amb1");
    expect(ambiguous).toMatchObject({ eligible: false, ineligibleReason: "AMBIGUOUS_RESPONSES" });
    await review("amb2", "REJECTED");
    const resolved = await verify("amb1");
    expect(resolved).toMatchObject({ eligible: true, sequence: 2 });
    // The stale (ineligible) verification can never be approved, and approval requires the latest one.
    await expectAiError(approve("amb1", ambiguous.verificationId), "INVALID_INPUT", /not eligible/);

    await expectAiError(verify("invalid", { confirmedRankableEntryIds: [] }), "INVALID_RESPONSE");
    expect(await prisma.waiverAiLateEntryVerification.count({ where: { evidenceId: evidence.invalid.id } })).toBe(0);
    for (const key of ["post", "attest", "wrong"]) expect(await boardRows(ai[key])).toEqual(NONE);
  });

  it("an admin-typed time conflicting with the provider message timestamp is refused, by the service and the database", async () => {
    const at = preLockProviderTime();
    const file = chatExport(evidence.wrong.text, at);
    await expectAiError(
      verify("wrong", { basis: "PROVIDER_ARTIFACT", artifact: file, originalPredictionAt: new Date(at.getTime() - 3_600_000) }),
      "INVALID_INPUT",
      /conflicts/,
    );
    const template = await prisma.waiverAiLateEntryVerification.findFirstOrThrow({ where: { evidenceId: evidence.post.id }, orderBy: { sequence: "desc" } });
    const { id: _id, verifiedAt: _at, ...copy } = template;
    void _id;
    void _at;
    await expectDbGuard(
      prisma.waiverAiLateEntryVerification.create({
        data: {
          ...copy,
          sequence: template.sequence + 1,
          sourceArtifact: Buffer.from(chatExport(evidence.post.text, at).bytes),
          sourceArtifactSha256: chatExport(evidence.post.text, at).expectedSha256,
          sourceArtifactByteLength: chatExport(evidence.post.text, at).bytes.byteLength,
          sourceArtifactName: "conversation.json",
          originalPredictionAt: new Date(at.getTime() + 3_600_000),
        },
      }),
      "WAIVER_INVALID",
    );
  });

  it("an admin-read time is never competitive, even when the file holds the exact response", async () => {
    const at = preLockProviderTime();
    // Plain-text export: the response is present verbatim, but no message carries a provider timestamp.
    const plain = plainFile(`Conversation exported ${at.toISOString()}\n\nAssistant:\n${evidence.post.text}`);
    const adminRead = await verify("post", { basis: "PROVIDER_ARTIFACT", artifact: plain, originalPredictionAt: at });
    expect(adminRead).toMatchObject({
      eligible: false,
      ineligibleReason: "NO_PROVIDER_MESSAGE_TIME",
      timestampMethod: "ADMIN_READ_FROM_ARTIFACT",
      artifactContainsResponse: true,
    });
    expect(adminRead.originalPredictionAt?.getTime()).toBe(at.getTime());
    // JSON whose only timestamp belongs to the conversation, not the assistant message.
    const conversationTime = JSON.stringify({ create_time: at.getTime() / 1000, messages: [{ role: "assistant", content: evidence.post.text }] });
    const borrowed = await verify("post", {
      basis: "PROVIDER_ARTIFACT",
      artifact: { name: "c.json", bytes: new TextEncoder().encode(conversationTime), expectedSha256: sha256Utf8(conversationTime) },
      originalPredictionAt: at,
    });
    expect(borrowed).toMatchObject({ eligible: false, ineligibleReason: "NO_PROVIDER_MESSAGE_TIME" });
    expect(await boardRows(ai.post)).toEqual(NONE);
  });

  it("the database derives containment, time and method from the stored bytes, not from what the application reports", async () => {
    const template = await prisma.waiverAiLateEntryVerification.findFirstOrThrow({ where: { evidenceId: evidence.post.id }, orderBy: { sequence: "desc" } });
    const { id: _id, verifiedAt: _at, ...copy } = template;
    void _id;
    void _at;
    const plain = plainFile(`Assistant:\n${evidence.post.text}`);
    const spoofed = await prisma.waiverAiLateEntryVerification.create({
      data: {
        ...copy,
        sequence: template.sequence + 1,
        sourceArtifact: Buffer.from(plain.bytes),
        sourceArtifactName: plain.name,
        sourceArtifactSha256: plain.expectedSha256,
        sourceArtifactByteLength: plain.bytes.byteLength,
        timestampMethod: "PROVIDER_MESSAGE",
        originalPredictionAt: preLockProviderTime(),
        artifactContainsResponse: false,
        eligible: true,
        ineligibleReason: null,
      },
    });
    expect(spoofed).toMatchObject({ timestampMethod: "ADMIN_READ_FROM_ARTIFACT", artifactContainsResponse: true, eligible: false, ineligibleReason: "NO_PROVIDER_MESSAGE_TIME" });
    const unrelated = plainFile("unrelated");
    const claimed = await prisma.waiverAiLateEntryVerification.create({
      data: {
        ...copy,
        sequence: template.sequence + 2,
        sourceArtifact: Buffer.from(unrelated.bytes),
        sourceArtifactName: unrelated.name,
        sourceArtifactSha256: unrelated.expectedSha256,
        sourceArtifactByteLength: unrelated.bytes.byteLength,
        artifactContainsResponse: true,
      },
    });
    expect(claimed).toMatchObject({ artifactContainsResponse: false, eligible: false, ineligibleReason: "ARTIFACT_MISSING_RESPONSE" });
  });

  it("refuses future-dated and post-recording provider timestamps", async () => {
    const stored = await prisma.waiverAiHistoricalEvidence.findUniqueOrThrow({ where: { id: evidence.post.id } });
    await expectAiError(
      verify("post", { basis: "PROVIDER_ARTIFACT", artifact: chatExport(evidence.post.text, new Date(Date.now() + 86_400_000)) }),
      "CONFLICT",
      /cannot be in the future/,
    );
    await expectAiError(
      verify("post", { basis: "PROVIDER_ARTIFACT", artifact: chatExport(evidence.post.text, new Date(stored.recordedAt.getTime() + 1)) }),
      "CONFLICT",
      /after the evidence was recorded/,
    );
    await expectAiError(verify("attest", { basis: "OPERATOR_ATTESTED", originalPredictionAt: new Date(Date.now() + 86_400_000) }), "INVALID_INPUT", /future/);
  });

  it("evidence pinned to a superseded snapshot is not eligible", async () => {
    const week = await f.addWeek();
    const v1 = await f.freezeSnapshot({ weekId: week.weekId, rows: rb.map((player) => ({ player })) });
    const contest = (await f.createContest({ weekId: week.weekId, snapshotId: v1.id, position: "RB" })).id;
    const profile = (await f.addAiCompetitor("laterepin")).profileId;
    const key = "repin";
    await record(key, contest, profile, `1. ${rb[0].name}\n`);
    const v2 = await f.freezeSnapshot({ weekId: week.weekId, rows: rb.map((player) => ({ player })), supersedesId: v1.id });
    await prisma.waiverContest.update({ where: { id: contest }, data: { snapshotId: v2.id } });
    await f.passLock(contest);
    await review(key);
    const verified = await verify(key);
    expect(verified).toMatchObject({ eligible: false, ineligibleReason: "SNAPSHOT_MISMATCH" });
  });
});

describe("late entry: bindings, replay and authority", () => {
  it("refuses wrong profile, contest, position, snapshot and hash at the database", async () => {
    await review("wrong");
    const ok = await verify("wrong", { basis: "PROVIDER_ARTIFACT", artifact: chatExport(evidence.wrong.text, preLockProviderTime()) });
    expect(ok.eligible).toBe(true);
    const v = await prisma.waiverAiLateEntryVerification.findUniqueOrThrow({ where: { id: ok.verificationId } });
    const { id: _id, verifiedAt: _at, ...copy } = v;
    void _id;
    void _at;
    const otherSnapshot = (await prisma.waiverContest.findUniqueOrThrow({ where: { id: openContest } })).snapshotId;
    await expectDbGuard(prisma.waiverAiLateEntryVerification.create({ data: { ...copy, sequence: v.sequence + 1, contestId: wrContest, position: "WR" } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverAiLateEntryVerification.create({ data: { ...copy, sequence: v.sequence + 1, universalProfileId: ai.db } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverAiLateEntryVerification.create({ data: { ...copy, sequence: v.sequence + 1, responseSha256: "a".repeat(64) } }), "WAIVER_INVALID");

    const approval = {
      verificationId: v.id,
      evidenceId: v.evidenceId,
      contestId: v.contestId,
      universalProfileId: v.universalProfileId,
      snapshotId: v.snapshotId,
      responseSha256: v.responseSha256,
      boardFingerprint: v.boardFingerprint,
      callCount: v.callCount,
      submissionId: "late-forged-submission",
      revisionId: "late-forged-revision",
      confirmation: v.responseSha256.slice(0, 12),
      approvedByUserId: f.adminUserId,
    };
    await expectDbGuard(prisma.waiverAiLateEntryApproval.create({ data: { ...approval, contestId: wrContest } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverAiLateEntryApproval.create({ data: { ...approval, universalProfileId: ai.db } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverAiLateEntryApproval.create({ data: { ...approval, snapshotId: otherSnapshot } }), "WAIVER_INVALID");
    const otherSha = sha256Utf8(evidence.replay.text);
    await expectDbGuard(prisma.waiverAiLateEntryApproval.create({ data: { ...approval, responseSha256: otherSha, confirmation: otherSha.slice(0, 12) } }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverAiLateEntryApproval.create({ data: { ...approval, boardFingerprint: "b".repeat(64) } }), "WAIVER_INVALID");
    await expect(prisma.waiverAiLateEntryApproval.create({ data: { ...approval, confirmation: "000000000000" } })).rejects.toThrow(/WaiverAiLateEntryApproval_shape_check|check constraint/);

    await expectAiError(approve("wrong", ok.verificationId, { confirmation: "abcdefabcdef" }), "INVALID_INPUT", /12 characters/);
    const { pickIds } = await picksOf("artifact");
    await expectAiError(approve("wrong", ok.verificationId, { confirmedRankableEntryIds: pickIds }), "PREVIEW_MISMATCH");
    await expectAiError(verify("wrong", { expectedPromptSha256: "c".repeat(64) }), "PROMPT_CHANGED");
    expect(await boardRows(ai.wrong)).toEqual(NONE);
  });

  it("evidence for one contest cannot enter another contest or position", async () => {
    await review("dbWr");
    const verified = await verify("dbWr");
    expect(verified.eligible).toBe(true);
    const v = await prisma.waiverAiLateEntryVerification.findUniqueOrThrow({ where: { id: verified.verificationId } });
    await expectDbGuard(
      prisma.waiverAiLateEntryApproval.create({
        data: {
          verificationId: v.id,
          evidenceId: v.evidenceId,
          contestId: rbContest,
          universalProfileId: v.universalProfileId,
          snapshotId: v.snapshotId,
          responseSha256: v.responseSha256,
          boardFingerprint: v.boardFingerprint,
          callCount: v.callCount,
          submissionId: "late-cross-submission",
          revisionId: "late-cross-revision",
          confirmation: v.responseSha256.slice(0, 12),
          approvedByUserId: f.adminUserId,
        },
      }),
      "WAIVER_INVALID",
    );
    const approved = await approve("dbWr", verified.verificationId);
    const board = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: approved.submissionId } });
    expect(board.contestId).toBe(wrContest);
  });

  it("verification and approval cannot share a transaction", async () => {
    await review("replay");
    const { context, pickIds } = await picksOf("replay");
    const fingerprint = waiverBoardFingerprint({ contestId: rbContest, snapshotId: context.contest.snapshotId, rankableEntryIds: pickIds });
    const sha = sha256Utf8(evidence.replay.text);
    const file = chatExport(evidence.replay.text, preLockProviderTime());
    await expect(
      prisma.$transaction(async (tx) => {
        const v = await tx.waiverAiLateEntryVerification.create({
          data: {
            evidenceId: evidence.replay.id,
            sequence: 1,
            contestId: rbContest,
            position: "RB",
            snapshotId: context.contest.snapshotId,
            universalProfileId: ai.replay,
            responseSha256: sha,
            basis: "PROVIDER_ARTIFACT",
            timestampMethod: "PROVIDER_MESSAGE",
            originalPredictionAt: null,
            sourceReference: "x",
            sourceArtifact: Buffer.from(file.bytes),
            sourceArtifactName: file.name,
            sourceArtifactSha256: file.expectedSha256,
            sourceArtifactByteLength: file.bytes.byteLength,
            artifactContainsResponse: true,
            canonicalPromptVersion: context.prompt.version,
            canonicalPromptSha256: context.prompt.sha256,
            promptEquivalence: "UNKNOWN",
            parserVersion: "WAIVEREYEQ_AI_PARSER_V1",
            callCount: 1,
            boardFingerprint: fingerprint,
            attestation: "same transaction",
            eligible: true,
            verifiedByUserId: f.adminUserId,
          },
        });
        expect(v.eligible).toBe(true);
        await tx.waiverAiLateEntryApproval.create({
          data: {
            verificationId: v.id,
            evidenceId: evidence.replay.id,
            contestId: rbContest,
            universalProfileId: ai.replay,
            snapshotId: context.contest.snapshotId,
            responseSha256: sha,
            boardFingerprint: fingerprint,
            callCount: 1,
            submissionId: "late-same-tx-submission",
            revisionId: "late-same-tx-revision",
            confirmation: sha.slice(0, 12),
            approvedByUserId: f.adminUserId,
          },
        });
      }),
    ).rejects.toThrow(/WAIVER_INVALID: a late entry is approved in a separate action/);
    expect(await prisma.waiverAiLateEntryVerification.count({ where: { evidenceId: evidence.replay.id } })).toBe(0);
  });

  it("refuses duplicate and replayed approvals", async () => {
    const dbBoard = await prisma.waiverAiLateEntryApproval.findUniqueOrThrow({ where: { contestId_universalProfileId: { contestId: rbContest, universalProfileId: ai.db } } });
    await expectAiError(approve("db", dbBoard.verificationId), "CONFLICT");
    // A fresh verification of the same evidence cannot approve a second board.
    const again = await verify("db");
    expect(again.eligible).toBe(true);
    await expectAiError(approve("db", again.verificationId), "CONFLICT", /already has a board/);

    // A committed approval authorizes nothing in a later transaction.
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({
        data: {
          submissionId: dbBoard.submissionId,
          revisionNumber: 2,
          kind: "SUBMISSION",
          snapshotId: dbBoard.snapshotId,
          callCount: 0,
          fingerprint: "d".repeat(64),
          authorUserId: f.adminUserId,
          createdAt: new Date(),
        },
      }),
      "WAIVER_LOCKED",
    );
    const entry = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId: dbBoard.snapshotId, rankableEntryId: rb[1].id } });
    await expectDbGuard(prisma.waiverCall.create({ data: { revisionId: dbBoard.revisionId, slot: 3, snapshotEntryId: entry.id } }), "WAIVER_LOCKED");
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: dbBoard.submissionId }, data: { lockedAt: new Date(), submittedAt: new Date() } }),
      "WAIVER_LOCKED",
    );
    expect(await boardRows(ai.replay)).toEqual(NONE);
  });

  it("refuses unauthorized admins and ordinary users", async () => {
    const demoted = await f.addAdmin("latedemoted");
    await prisma.user.update({ where: { id: demoted.userId }, data: { role: "USER" } });
    for (const userId of [human.userId, demoted.userId]) {
      await expectAiError(verify("replay", { adminUserId: userId }), "FORBIDDEN");
    }
    const latest = await prisma.waiverAiLateEntryVerification.findFirstOrThrow({ where: { evidenceId: evidence.amb1.id }, orderBy: { sequence: "desc" } });
    for (const userId of [human.userId, demoted.userId]) {
      await expectAiError(approve("amb1", latest.id, { adminUserId: userId }), "FORBIDDEN");
    }
    const v = await prisma.waiverAiLateEntryVerification.findUniqueOrThrow({ where: { id: latest.id } });
    const { id: _id, verifiedAt: _at, ...copy } = v;
    void _id;
    void _at;
    await expectDbGuard(prisma.waiverAiLateEntryVerification.create({ data: { ...copy, sequence: v.sequence + 1, verifiedByUserId: human.userId } }), "WAIVER_INVALID");
    await expectDbGuard(
      prisma.waiverAiLateEntryApproval.create({
        data: {
          verificationId: v.id,
          evidenceId: v.evidenceId,
          contestId: v.contestId,
          universalProfileId: v.universalProfileId,
          snapshotId: v.snapshotId,
          responseSha256: v.responseSha256,
          boardFingerprint: v.boardFingerprint,
          callCount: v.callCount,
          submissionId: "late-user-submission",
          revisionId: "late-user-revision",
          confirmation: v.responseSha256.slice(0, 12),
          approvedByUserId: human.userId,
        },
      }),
      "WAIVER_INVALID",
    );
    expect(await boardRows(ai.amb)).toEqual(NONE);
  });

  it("keeps ordinary post-lock write paths blocked", async () => {
    const text = `1. ${rb[0].name}\n`;
    const context = await loadWaiverAiContestContext(prisma, rbContest);
    await expectAiError(
      importAiWaiverBoard({
        adminUserId: f.adminUserId,
        contestId: rbContest,
        universalProfileId: ai.replay,
        responseText: text,
        expectedResponseSha256: sha256Utf8(text),
        expectedPromptSha256: context!.prompt.sha256,
        confirmedRankableEntryIds: [rb[0].id],
        modelLabel: "x",
        statedGeneratedAt: null,
        sourceReference: null,
        sourceNote: null,
      }),
      "LOCKED",
    );
    await expect(
      submitWaiverBoard({ contestId: rbContest, universalProfileId: human.profileId, userId: human.userId, playerIds: [rb[3].id] }),
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
          snapshotId: (await prisma.waiverContest.findUniqueOrThrow({ where: { id: rbContest } })).snapshotId,
          callCount: 0,
          fingerprint: "e".repeat(64),
          authorUserId: human.userId,
          createdAt: new Date(lockAt.getTime() - 1000),
        },
      }),
      "WAIVER_LOCKED",
    );
    // Before the lock there is no late entry: the ordinary import is the only path.
    await record("open", openContest, ai.replay, `1. ${rb[0].name}\n`);
    await review("open");
    const early = await verify("open");
    expect(early.eligible).toBe(true);
    await expectAiError(approve("open", early.verificationId), "INVALID_INPUT", /still open/);
  });
});

describe("late entry: the admin preview reads provider files exactly as the database does", () => {
  it("agrees on containment and the provider message time across export shapes", async () => {
    const response = `1. ${rb[0].name}\n2. ${rb[1].name}\n`;
    const at = new Date("2026-10-06T22:15:30.123Z");
    const files = [
      chatExport(response, at).bytes,
      chatExport(response, at, "user").bytes,
      new TextEncoder().encode(JSON.stringify({ chat_messages: [{ sender: "assistant", created_at: "2026-10-06T17:15:30-05:00", text: `Picks:\n${response}` }] })),
      new TextEncoder().encode(JSON.stringify({ create_time: at.getTime() / 1000, messages: [{ role: "assistant", content: response }] })),
      new TextEncoder().encode(JSON.stringify({ role: "assistant", timestamp: at.getTime(), content: response })),
      new TextEncoder().encode(`\uFEFF${JSON.stringify({ messages: [{ role: "assistant", createdAt: at.toISOString(), content: response }] })}`),
      new TextEncoder().encode(JSON.stringify({ messages: [{ role: "assistant", created_at: "2026-10-06T22:15:30", content: response }] })),
      new TextEncoder().encode(`Assistant (${at.toISOString()}):\n${response}`),
      new Uint8Array([0xff, 0xfe, 0x41]),
    ];
    for (const [i, bytes] of files.entries()) {
      const preview = inspectProviderArtifact(bytes, response);
      // The function returns a UTC timestamp without zone; compare as epoch milliseconds.
      const [db] = await prisma.$queryRaw<Array<{ contains: boolean; ms: number | null }>>`
        SELECT "waiver_ai_artifact_contains"(${Buffer.from(bytes)}, ${response}) AS contains,
               round(extract(epoch FROM "waiver_ai_artifact_message_time"(${Buffer.from(bytes)}, ${response})::timestamp(3)) * 1000)::float8 AS ms`;
      expect(db.contains, `file ${i}`).toBe(preview.containsResponse);
      expect(db.ms, `file ${i}`).toBe(preview.extractedAt?.getTime() ?? null);
    }
  });
});

describe("late entry: historical prompt provenance", () => {
  it("never accepts a canonical prompt label without the byte-identical preserved prompt", async () => {
    const { context } = await picksOf("attest");
    const before = await prisma.waiverAiLateEntryVerification.count({ where: { evidenceId: evidence.attest.id } });
    for (const version of ["WAIVEREYEQ_AI_V1", " waiverEyeQ_ai_v1 ", "WAIVEREYEQ_AI_V2"]) {
      await expectAiError(verify("attest", { basis: "OPERATOR_ATTESTED", originalPrompt: { version, reference: null, text: null } }), "INVALID_INPUT", /byte-identical/);
      await expectAiError(
        verify("attest", { basis: "OPERATOR_ATTESTED", originalPrompt: { version, reference: null, text: `${context.prompt.text}\n` } }),
        "INVALID_INPUT",
        /byte-identical/,
      );
    }
    expect(await prisma.waiverAiLateEntryVerification.count({ where: { evidenceId: evidence.attest.id } })).toBe(before);

    // The database refuses the same claims and re-derives equivalence whatever the application reports.
    const template = await prisma.waiverAiLateEntryVerification.findFirstOrThrow({ where: { evidenceId: evidence.attest.id }, orderBy: { sequence: "desc" } });
    const { id: _id, verifiedAt: _at, ...copy } = template;
    void _id;
    void _at;
    await expectDbGuard(
      prisma.waiverAiLateEntryVerification.create({ data: { ...copy, sequence: template.sequence + 1, originalPromptVersion: "WAIVEREYEQ_AI_V1", promptEquivalence: "VERIFIED" } }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverAiLateEntryVerification.create({
        data: { ...copy, sequence: template.sequence + 1, originalPromptText: context.prompt.text, originalPromptVersion: "WAIVEREYEQ_AI_V2" },
      }),
      "WAIVER_INVALID",
    );
    const forged = await prisma.waiverAiLateEntryVerification.create({
      data: {
        ...copy,
        sequence: template.sequence + 1,
        originalPromptText: "another prompt",
        originalPromptSha256: context.prompt.sha256,
        promptEquivalence: "VERIFIED",
      },
    });
    expect(forged).toMatchObject({ promptEquivalence: "DIFFERENT", originalPromptSha256: sha256Utf8("another prompt") });
  });

  it("records unknown, different and verified original prompts accurately", async () => {
    const { context } = await picksOf("attest");
    const unknown = await verify("attest", { basis: "OPERATOR_ATTESTED" });
    expect(unknown.promptEquivalence).toBe("UNKNOWN");
    const named = await verify("attest", { basis: "OPERATOR_ATTESTED", originalPrompt: { version: "Week 5 legacy prompt", reference: "operator notes", text: null } });
    expect(named.promptEquivalence).toBe("DIFFERENT");
    const verified = await verify("attest", { basis: "OPERATOR_ATTESTED", originalPrompt: { version: null, reference: null, text: context.prompt.text } });
    expect(verified.promptEquivalence).toBe("VERIFIED");
    const rows = await prisma.waiverAiLateEntryVerification.findMany({ where: { id: { in: [unknown.verificationId, named.verificationId, verified.verificationId] } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(unknown.verificationId)).toMatchObject({ originalPromptVersion: null, originalPromptReference: null, originalPromptText: null, originalPromptSha256: null });
    expect(byId.get(named.verificationId)).toMatchObject({ originalPromptVersion: "Week 5 legacy prompt", originalPromptReference: "operator notes", originalPromptSha256: null });
    expect(byId.get(verified.verificationId)).toMatchObject({ originalPromptVersion: context.prompt.version, originalPromptSha256: context.prompt.sha256 });
    for (const row of rows) expect(row).toMatchObject({ canonicalPromptVersion: context.prompt.version, canonicalPromptSha256: context.prompt.sha256 });
  });

  it("only an approved late entry may store a response without its prompt", async () => {
    const text = `1. ${rb[0].name}\n`;
    const profile = (await f.addAiCompetitor("lateprompt")).profileId;
    const snapshotId = (await prisma.waiverContest.findUniqueOrThrow({ where: { id: openContest } })).snapshotId;
    const entry = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId, rankableEntryId: rb[0].id } });
    await expect(
      prisma.$transaction(async (tx) => {
        const submission = await tx.waiverSubmission.create({
          data: { contestId: openContest, universalProfileId: profile, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" },
        });
        const revision = await tx.waiverSubmissionRevision.create({
          data: {
            submissionId: submission.id,
            revisionNumber: 1,
            kind: "SUBMISSION",
            snapshotId,
            callCount: 1,
            fingerprint: waiverBoardFingerprint({ contestId: openContest, snapshotId, rankableEntryIds: [rb[0].id] }),
            authorUserId: f.adminUserId,
            createdAt: new Date(),
          },
        });
        await tx.waiverCall.create({ data: { revisionId: revision.id, slot: 1, snapshotEntryId: entry.id } });
        await tx.waiverAiResponse.create({
          data: {
            revisionId: revision.id,
            contestId: openContest,
            position: "RB",
            snapshotId,
            universalProfileId: profile,
            modelLabel: "No prompt",
            promptVersion: null,
            promptSha256: null,
            parserVersion: "WAIVEREYEQ_AI_PARSER_V1",
            responseText: text,
            responseSha256: sha256Utf8(text),
            responseByteLength: Buffer.byteLength(text),
            noCalls: false,
            importedByUserId: f.adminUserId,
          },
        });
      }),
    ).rejects.toThrow(/WAIVER_INVALID: an AI Waiver response records the prompt it answered/);
    expect(await boardRows(profile)).toEqual(NONE);
  });
});

describe("late entry: immutability, atomicity and competitive integrity", () => {
  it("approval and verification history is immutable and untruncatable", async () => {
    const approval = await prisma.waiverAiLateEntryApproval.findFirstOrThrow({ where: { contestId: rbContest } });
    const verification = await prisma.waiverAiLateEntryVerification.findFirstOrThrow({ where: { contestId: rbContest } });
    await expectDbGuard(prisma.waiverAiLateEntryApproval.update({ where: { id: approval.id }, data: { note: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverAiLateEntryApproval.delete({ where: { id: approval.id } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverAiLateEntryVerification.update({ where: { id: verification.id }, data: { attestation: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverAiLateEntryVerification.delete({ where: { id: verification.id } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.$executeRawUnsafe('TRUNCATE "WaiverAiLateEntryApproval"'), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.$executeRawUnsafe('TRUNCATE "WaiverAiLateEntryVerification" CASCADE'), "WAIVER_IMMUTABLE");
    const response = await prisma.waiverAiResponse.findUniqueOrThrow({ where: { revisionId: approval.revisionId } });
    await expectDbGuard(prisma.waiverAiResponse.update({ where: { id: response.id }, data: { sourceNote: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverSubmissionRevision.delete({ where: { id: approval.revisionId } }), "WAIVER_IMMUTABLE");
  });

  it("a failed import rolls back atomically, including the approval", async () => {
    await review("rollback");
    const verified = await verify("rollback");
    expect(verified.eligible).toBe(true);
    const v = await prisma.waiverAiLateEntryVerification.findUniqueOrThrow({ where: { id: verified.verificationId } });
    const { pickIds } = await picksOf("rollback");
    const entries = await prisma.waiverSnapshotEntry.findMany({ where: { snapshotId: v.snapshotId, rankableEntryId: { in: pickIds } } });
    const entryFor = (id: string) => entries.find((entry) => entry.rankableEntryId === id)!.id;
    const attempt = (reorder: boolean, withResponse: boolean, claimCanonicalPrompt = false) =>
      prisma.$transaction(async (tx) => {
        const approval = await tx.waiverAiLateEntryApproval.create({
          data: {
            verificationId: v.id,
            evidenceId: v.evidenceId,
            contestId: v.contestId,
            universalProfileId: v.universalProfileId,
            snapshotId: v.snapshotId,
            responseSha256: v.responseSha256,
            boardFingerprint: v.boardFingerprint,
            callCount: v.callCount,
            submissionId: `late-rb-sub-${reorder}-${withResponse}-${claimCanonicalPrompt}`,
            revisionId: `late-rb-rev-${reorder}-${withResponse}-${claimCanonicalPrompt}`,
            confirmation: v.responseSha256.slice(0, 12),
            approvedByUserId: f.adminUserId,
          },
        });
        await tx.waiverSubmission.create({
          data: { id: approval.submissionId, contestId: v.contestId, universalProfileId: v.universalProfileId, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" },
        });
        await tx.waiverSubmissionRevision.create({
          data: {
            id: approval.revisionId,
            submissionId: approval.submissionId,
            revisionNumber: 1,
            kind: "SUBMISSION",
            snapshotId: v.snapshotId,
            callCount: v.callCount,
            fingerprint: v.boardFingerprint,
            authorUserId: f.adminUserId,
            createdAt: approval.approvedAt,
          },
        });
        const order = reorder ? [...pickIds].reverse() : pickIds;
        await tx.waiverCall.createMany({ data: order.map((id, i) => ({ revisionId: approval.revisionId, slot: i + 1, snapshotEntryId: entryFor(id) })) });
        if (withResponse) {
          await tx.waiverAiResponse.create({
            data: {
              revisionId: approval.revisionId,
              contestId: v.contestId,
              position: "RB",
              snapshotId: v.snapshotId,
              universalProfileId: v.universalProfileId,
              modelLabel: "Model rollback",
              promptVersion: claimCanonicalPrompt ? v.canonicalPromptVersion : null,
              promptSha256: claimCanonicalPrompt ? v.canonicalPromptSha256 : null,
              parserVersion: v.parserVersion,
              responseText: evidence.rollback.text,
              responseSha256: v.responseSha256,
              responseByteLength: Buffer.byteLength(evidence.rollback.text),
              noCalls: false,
              importedByUserId: f.adminUserId,
            },
          });
        }
        await tx.waiverSubmission.update({
          where: { id: approval.submissionId },
          data: { status: "LOCKED", currentRevisionId: approval.revisionId, lockedRevisionId: approval.revisionId, submittedAt: approval.approvedAt, lockedAt: approval.approvedAt },
        });
      });
    await expectDbGuard(attempt(true, true), "WAIVER_INVALID");
    expect(await boardRows(ai.rollback)).toEqual(NONE);
    await expectDbGuard(attempt(false, false), "WAIVER_INVALID");
    expect(await boardRows(ai.rollback)).toEqual(NONE);
    // The original prompt is unknown: a response claiming the canonical prompt is refused at COMMIT.
    expect(v.promptEquivalence).toBe("UNKNOWN");
    await expectDbGuard(attempt(false, true, true), "WAIVER_INVALID");
    expect(await boardRows(ai.rollback)).toEqual(NONE);
    expect(await prisma.waiverAiLateEntryVerification.count({ where: { evidenceId: evidence.rollback.id } })).toBe(1);
    // The same verification still approves cleanly through the service.
    const approved = await approve("rollback", verified.verificationId);
    expect(await boardRows(ai.rollback)).toEqual({ submissions: 1, revisions: 1, calls: 2, responses: 1, approvals: 1 });
    expect(approved.callCount).toBe(2);
  });

  it("existing locked human boards and the contests are unchanged", async () => {
    expect(await humanBoardsJson()).toBe(humanBoardsBefore);
    expect(JSON.stringify(await prisma.waiverContest.findMany({ where: { weekId }, orderBy: { id: "asc" } }))).toBe(contestsBefore);
  });

  it("selects the late board at lock and grade time without restamping, and keeps consensus human-only", async () => {
    await ensureWaiverContestLocked(rbContest);
    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: rbContest } });
    const late = await prisma.waiverAiLateEntryApproval.findUniqueOrThrow({ where: { contestId_universalProfileId: { contestId: rbContest, universalProfileId: ai.db } } });
    const lateBoard = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: late.submissionId } });
    expect(lateBoard.lockedRevisionId).toBe(late.revisionId);
    expect(lateBoard.lockedAt?.getTime()).toBe(late.approvedAt.getTime());
    const onTime = await prisma.waiverSubmission.findUniqueOrThrow({ where: { contestId_universalProfileId: { contestId: rbContest, universalProfileId: ai.ontime } } });
    expect(onTime.lockedAt?.getTime()).toBe(contest.locksAt.getTime());

    const revealed = await loadRevealableWaiverBoards(rbContest);
    expect(revealed.revealed).toBe(true);
    const boards = revealed.boards;
    const lateRevealed = boards.find((board) => board.submissionId === late.submissionId)!;
    expect(lateRevealed).toMatchObject({ lockedRevisionId: late.revisionId, authority: "SYSTEM_OPERATED" });
    expect(lateRevealed.lateEntry?.importedAt.getTime()).toBe(late.approvedAt.getTime());
    expect(boards.find((board) => board.universalProfileId === ai.ontime)!.lateEntry).toBeNull();
    const humans = filterWaiverBoardsByCategory(boards, "HUMANS");
    expect(humans.every((board) => board.authority === "OWNER_AUTHORED" && board.lateEntry === null)).toBe(true);
    expect(filterWaiverBoardsByCategory(boards, "AI").some((board) => board.submissionId === late.submissionId)).toBe(true);
    expect(filterWaiverBoardsByCategory(boards, "ALL").some((board) => board.submissionId === late.submissionId)).toBe(true);

    const finals = await loadFinalWaiverBoards(prisma, { contestId: rbContest, locksAt: contest.locksAt });
    expect(finals.find((board) => board.submissionId === late.submissionId)?.revisionId).toBe(late.revisionId);
  });

  it("creates no grade, consensus or board from evidence alone", async () => {
    expect(await prisma.waiverGradeRun.count({ where: { weekId } })).toBe(0);
    expect(await prisma.waiverBoardGrade.count({ where: { submission: { contest: { weekId } } } })).toBe(0);
    for (const key of ["post", "attest", "wrong", "replay", "amb"]) expect(await boardRows(ai[key])).toEqual(NONE);
  });
});
