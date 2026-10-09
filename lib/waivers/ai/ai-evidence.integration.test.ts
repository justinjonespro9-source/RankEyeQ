import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, expectDbGuard, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { previewWaiverAiEvidence, recordWaiverAiEvidence, reviewWaiverAiEvidence, type WaiverAiEvidenceRecordInput } from "@/lib/waivers/ai/evidence";
import { loadWaiverAiBoardView, loadWaiverAiWeekView } from "@/lib/waivers/ai/queries";
import { WaiverAiError } from "@/lib/waivers/ai/submissions";
import { sha256Utf8 } from "@/lib/waivers/ai/text";

let f: WaiverFixture;
let weekId: string;
let rb: FixturePlayer[];
let lockedContestId: string;
let openContestId: string;
let ai: string;
let aiInactive: string;
let human: { userId: string; profileId: string };

async function expectAiError(promise: Promise<unknown>, code: string) {
  let error: unknown = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, `expected ${code}`).toBeInstanceOf(WaiverAiError);
  expect((error as WaiverAiError).code).toBe(code);
}

function record(overrides: Partial<WaiverAiEvidenceRecordInput> & { responseText: string }) {
  return recordWaiverAiEvidence({
    adminUserId: f.adminUserId,
    contestId: lockedContestId,
    universalProfileId: ai,
    expectedResponseSha256: sha256Utf8(overrides.responseText),
    modelLabel: "Fixture model",
    statedSourceAt: null,
    evidenceSource: "CHAT_EXPORT",
    evidenceReference: "export-file.json",
    note: null,
    ...overrides,
  });
}

async function competitiveRows(profileId: string) {
  const [submissions, revisions, responses] = await Promise.all([
    prisma.waiverSubmission.count({ where: { universalProfileId: profileId } }),
    prisma.waiverSubmissionRevision.count({ where: { submission: { universalProfileId: profileId } } }),
    prisma.waiverAiResponse.count({ where: { universalProfileId: profileId } }),
  ]);
  return { submissions, revisions, responses };
}

beforeAll(async () => {
  f = await createWaiverFixture("aievid");
  rb = await f.addPlayers("RB", 4);
  const week = await f.addWeek();
  weekId = week.weekId;
  const snapshot = await f.freezeSnapshot({ weekId, rows: rb.map((player) => ({ player })) });
  lockedContestId = (await f.createContest({ weekId, snapshotId: snapshot.id, position: "RB" })).id;
  const otherWeek = await f.addWeek();
  const otherSnapshot = await f.freezeSnapshot({ weekId: otherWeek.weekId, rows: rb.map((player) => ({ player })) });
  openContestId = (await f.createContest({ weekId: otherWeek.weekId, snapshotId: otherSnapshot.id, position: "RB" })).id;
  ai = (await f.addAiCompetitor("hist")).profileId;
  aiInactive = (await f.addAiCompetitor("histoff", { competitorActive: false })).profileId;
  human = await f.addParticipant("histhuman");
  await f.passLock(lockedContestId);
}, 120_000);

afterAll(async () => {
  await f?.cleanup();
});

describe("historical AI evidence (record only)", () => {
  it("records byte-exact text after lock as RECORDED AFTER LOCK and creates no competitive rows", async () => {
    const text = `\uFEFF1. ${rb[2].name}\r\n2. ${rb[0].name}\r\n\r\n`;
    const stated = new Date(Date.now() - 86_400_000);
    const preview = await previewWaiverAiEvidence({ adminUserId: f.adminUserId, contestId: lockedContestId, responseText: text });
    expect(preview).toMatchObject({ afterLock: true, responseSha256: sha256Utf8(text) });
    const result = await record({ responseText: text, statedSourceAt: stated, note: "original export" });
    expect(result).toMatchObject({ recordedAfterLock: true, responseSha256: sha256Utf8(text) });

    const stored = await prisma.waiverAiHistoricalEvidence.findUniqueOrThrow({ where: { id: result.evidenceId } });
    expect(stored).toMatchObject({
      responseText: text,
      responseSha256: sha256Utf8(text),
      responseByteLength: Buffer.byteLength(text, "utf8"),
      statedSourceAt: stated,
      evidenceSource: "CHAT_EXPORT",
      evidenceReference: "export-file.json",
      note: "original export",
      recordedAfterLock: true,
      recordedByUserId: f.adminUserId,
      position: "RB",
    });
    expect(stored.recordedAt.getTime()).toBeGreaterThan(stored.statedSourceAt!.getTime());
    expect(await competitiveRows(ai)).toEqual({ submissions: 0, revisions: 0, responses: 0 });
    expect(await prisma.adminAuditLog.count({ where: { action: "waivers.ai_evidence_recorded", entityId: result.evidenceId } })).toBe(1);
  });

  it("the database derives recordedAfterLock and recordedAt from its own clock", async () => {
    const text = `1. ${rb[3].name}`;
    const forged = await prisma.waiverAiHistoricalEvidence.create({
      data: {
        contestId: lockedContestId,
        position: "RB",
        snapshotId: (await prisma.waiverContest.findUniqueOrThrow({ where: { id: lockedContestId } })).snapshotId,
        universalProfileId: ai,
        modelLabel: "m",
        responseText: text,
        responseSha256: sha256Utf8(text),
        responseByteLength: Buffer.byteLength(text),
        evidenceSource: "COPIED_TEXT",
        evidenceReference: "r",
        recordedAfterLock: false,
        recordedAt: new Date("2020-01-01T00:00:00Z"),
        recordedByUserId: f.adminUserId,
      },
    });
    expect(forged.recordedAfterLock).toBe(true);
    expect(forged.recordedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("evidence recorded before the lock is still record-only", async () => {
    const result = await record({ contestId: openContestId, responseText: "NO CALLS" });
    expect(result.recordedAfterLock).toBe(false);
    expect(await competitiveRows(ai)).toEqual({ submissions: 0, revisions: 0, responses: 0 });
    const view = await loadWaiverAiWeekView(weekId);
    expect(view!.cells[ai]?.RB).toMatchObject({ status: "EVIDENCE_ONLY", revisionNumber: null });
  });

  it("refuses duplicates, bad input, non-AI profiles, non-admins and future stated times", async () => {
    const text = `\uFEFF1. ${rb[2].name}\r\n2. ${rb[0].name}\r\n\r\n`;
    await expectAiError(record({ responseText: text }), "CONFLICT");
    await expectAiError(record({ responseText: "x", expectedResponseSha256: sha256Utf8("y") }), "RESPONSE_HASH_MISMATCH");
    await expectAiError(record({ responseText: "x", evidenceSource: "MEMORY" }), "INVALID_INPUT");
    await expectAiError(record({ responseText: "x", evidenceReference: " " }), "INVALID_INPUT");
    await expectAiError(record({ responseText: "" }), "INVALID_INPUT");
    await expectAiError(record({ responseText: "x", statedSourceAt: new Date(Date.now() + 3_600_000) }), "INVALID_INPUT");
    await expectAiError(record({ responseText: "x", universalProfileId: human.profileId }), "NOT_AI_COMPETITOR");
    await expectAiError(record({ responseText: "x", adminUserId: human.userId }), "FORBIDDEN");
    const inactive = await record({ responseText: "x", universalProfileId: aiInactive });
    expect(inactive.recordedAfterLock).toBe(true);
  });

  it("is append-only and untruncatable", async () => {
    const evidence = await prisma.waiverAiHistoricalEvidence.findFirstOrThrow({ where: { contestId: lockedContestId, universalProfileId: ai } });
    await expectDbGuard(prisma.waiverAiHistoricalEvidence.update({ where: { id: evidence.id }, data: { note: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverAiHistoricalEvidence.delete({ where: { id: evidence.id } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.$executeRawUnsafe('TRUNCATE "WaiverAiHistoricalEvidence" CASCADE'), "WAIVER_IMMUTABLE");
    await expect(
      prisma.waiverAiHistoricalEvidence.create({
        data: { ...evidence, id: undefined, responseSha256: "0".repeat(64), recordedAt: undefined },
      }),
    ).rejects.toThrow(/WaiverAiHistoricalEvidence_text_check|check constraint/);
  });

  it("reviews are sequential, optimistic, append-only and never make evidence competitive", async () => {
    const evidence = await prisma.waiverAiHistoricalEvidence.findFirstOrThrow({ where: { contestId: lockedContestId, universalProfileId: ai } });
    const first = await reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: evidence.id, expectedSequence: 0, status: "NEEDS_FOLLOW_UP", note: "check export" });
    expect(first.sequence).toBe(1);
    await expectAiError(
      reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: evidence.id, expectedSequence: 0, status: "TEXT_CONFIRMED", note: "stale" }),
      "CONFLICT",
    );
    const second = await reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: evidence.id, expectedSequence: 1, status: "TEXT_CONFIRMED", note: "matches export" });
    expect(second.sequence).toBe(2);
    await expectAiError(reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: evidence.id, expectedSequence: 2, status: "APPROVED", note: "x" }), "INVALID_INPUT");
    await expectAiError(reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: evidence.id, expectedSequence: 2, status: "REJECTED", note: " " }), "INVALID_INPUT");
    await expectAiError(reviewWaiverAiEvidence({ adminUserId: human.userId, evidenceId: evidence.id, expectedSequence: 2, status: "REJECTED", note: "x" }), "FORBIDDEN");

    const review = await prisma.waiverAiHistoricalEvidenceReview.findFirstOrThrow({ where: { evidenceId: evidence.id, sequence: 1 } });
    await expectDbGuard(prisma.waiverAiHistoricalEvidenceReview.update({ where: { id: review.id }, data: { note: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverAiHistoricalEvidenceReview.delete({ where: { id: review.id } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(
      prisma.waiverAiHistoricalEvidenceReview.create({
        data: { evidenceId: evidence.id, sequence: 7, status: "REJECTED", note: "skip", reviewerUserId: f.adminUserId },
      }),
      "WAIVER_INVALID",
    );

    expect(await competitiveRows(ai)).toEqual({ submissions: 0, revisions: 0, responses: 0 });
    const view = await loadWaiverAiBoardView(ai, lockedContestId);
    expect(view!.board).toBeNull();
    const shown = view!.evidence.find((row) => row.id === evidence.id)!;
    expect(shown).toMatchObject({ recordedAfterLock: true });
    expect(shown.reviews.map((r) => [r.sequence, r.status])).toEqual([
      [1, "NEEDS_FOLLOW_UP"],
      [2, "TEXT_CONFIRMED"],
    ]);
    expect(shown.parse.ok).toBe(true);
    expect(shown.parse.picks.map((pick) => pick.rankableEntryId)).toEqual([rb[2].id, rb[0].id]);
  });
});
