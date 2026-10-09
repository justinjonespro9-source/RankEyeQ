import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, expectDbGuard, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadRevealableWaiverBoards } from "@/lib/waivers/access-queries";
import { recordWaiverAiEvidence, reviewWaiverAiEvidence } from "@/lib/waivers/ai/evidence";
import { loadWaiverAiWeekView } from "@/lib/waivers/ai/queries";
import { importAiWaiverBoard, previewWaiverAiResponse, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { sha256Utf8 } from "@/lib/waivers/ai/text";
import { filterWaiverBoardsByCategory, waiverBoardCategory } from "@/lib/waivers/competitor-category";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { loadFinalWaiverBoards } from "@/lib/waivers/corrections";
import { waiverBoardFingerprint } from "@/lib/waivers/fingerprint";
import { loadWaiverPlayWeekView } from "@/lib/waivers/play-queries";
import { loadWaiverWeekOps } from "@/lib/waivers/snapshot/queries";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Stage 4B.3A final hardening: AI revision history and lock stamping,
 * historical-evidence isolation, and human-only public consensus, on one
 * contest that carries human boards, AI boards and evidence.
 */

let f: WaiverFixture;
let weekId: string;
let snapshotId: string;
let contestId: string;
let wr: FixturePlayer[];
let admin2: string;
let aiA: string;
let aiB: string;
let aiD: string;
const humans: Array<{ userId: string; profileId: string }> = [];
let aiARevision1Response: unknown;

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

async function importBoard(profileId: string, responseText: string, adminUserId = f.adminUserId) {
  const preview = await previewWaiverAiResponse({ adminUserId, contestId, responseText });
  return importAiWaiverBoard({
    adminUserId,
    contestId,
    universalProfileId: profileId,
    responseText,
    expectedResponseSha256: sha256Utf8(responseText),
    expectedPromptSha256: preview.promptSha256,
    confirmedRankableEntryIds: preview.parse.picks.map((pick) => pick.rankableEntryId),
    modelLabel: "Fixture model",
    statedGeneratedAt: null,
    sourceReference: null,
    sourceNote: null,
  });
}

async function competitiveState() {
  const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: contestId } });
  return {
    contest,
    week: await prisma.week.findUniqueOrThrow({ where: { id: weekId } }),
    snapshot: await prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: snapshotId } }),
    entries: await prisma.waiverSnapshotEntry.findMany({ where: { snapshotId }, orderBy: { id: "asc" } }),
    submissions: await prisma.waiverSubmission.findMany({
      where: { contestId },
      orderBy: { id: "asc" },
      include: { revisions: { orderBy: { revisionNumber: "asc" }, include: { calls: { orderBy: { slot: "asc" } }, aiResponse: true } } },
    }),
    finalBoards: await loadFinalWaiverBoards(prisma, { contestId, locksAt: contest.locksAt }),
  };
}

beforeAll(async () => {
  f = await createWaiverFixture("aisep");
  wr = await f.addPlayers("WR", 6);
  const week = await f.addWeek();
  weekId = week.weekId;
  snapshotId = (await f.freezeSnapshot({ weekId, rows: wr.map((player) => ({ player })) })).id;
  contestId = (await f.createContest({ weekId, snapshotId, position: "WR" })).id;
  admin2 = (await f.addAdmin("second")).userId;
  aiA = (await f.addAiCompetitor("a")).profileId;
  aiB = (await f.addAiCompetitor("b")).profileId;
  aiD = (await f.addAiCompetitor("d")).profileId;
  const picks = [[wr[0].id, wr[1].id], [wr[0].id], [wr[2].id]];
  for (const [index, playerIds] of picks.entries()) {
    const human = await f.addParticipant(`h${index}`);
    humans.push(human);
    await submitWaiverBoard({ contestId, universalProfileId: human.profileId, userId: human.userId, playerIds });
  }
}, 120_000);

afterAll(async () => {
  await f?.cleanup();
});

describe("AI revision history and lock stamping", () => {
  it("on-time edits append revisions and responses; earlier responses are never overwritten", async () => {
    const first = await importBoard(aiA, `1. ${wr[5].name}`);
    aiARevision1Response = await prisma.waiverAiResponse.findFirstOrThrow({ where: { contestId, universalProfileId: aiA } });
    const second = await importBoard(aiA, `1. ${wr[4].name}\n2. ${wr[5].name}`, admin2);
    expect(second).toMatchObject({ submissionId: first.submissionId, revisionNumber: 2, changed: true });
    await importBoard(aiB, "NO CALLS");

    const board = await prisma.waiverSubmission.findUniqueOrThrow({
      where: { id: first.submissionId },
      include: { revisions: { orderBy: { revisionNumber: "asc" }, include: { aiResponse: true } } },
    });
    expect(board.createdByUserId).toBe(f.adminUserId);
    expect(board.revisions.map((r) => [r.revisionNumber, r.kind, r.authorUserId, r.aiResponse?.importedByUserId])).toEqual([
      [1, "SUBMISSION", f.adminUserId, f.adminUserId],
      [2, "SUBMISSION", admin2, admin2],
    ]);
    expect(board.revisions[0].aiResponse).toEqual(aiARevision1Response);
  });

  it("holds one board per AI profile per contest, and no revision without its response", async () => {
    await expect(
      prisma.waiverSubmission.create({ data: { contestId, universalProfileId: aiA, createdByUserId: admin2, authority: "SYSTEM_OPERATED" } }),
    ).rejects.toThrow(/Unique constraint|P2002|contestId.*universalProfileId/);
    const board = await prisma.waiverSubmission.findFirstOrThrow({ where: { contestId, universalProfileId: aiA } });
    await expect(
      prisma.$transaction(async (tx) => {
        const at = new Date();
        const revision = await tx.waiverSubmissionRevision.create({
          data: {
            submissionId: board.id,
            revisionNumber: 3,
            kind: "SUBMISSION",
            snapshotId,
            callCount: 0,
            fingerprint: waiverBoardFingerprint({ contestId, snapshotId, rankableEntryIds: [] }),
            authorUserId: f.adminUserId,
            createdAt: at,
          },
        });
        await tx.waiverSubmission.update({ where: { id: board.id }, data: { currentRevisionId: revision.id, submittedAt: at } });
      }),
    ).rejects.toThrow(/requires its verbatim AI response/);
    expect(await prisma.waiverSubmissionRevision.count({ where: { submissionId: board.id } })).toBe(2);
  });

  it("the lock stamp selects the last pre-lock SUBMISSION revision; post-lock AI edits are refused", async () => {
    await f.passLock(contestId);
    const stamp = await ensureWaiverContestLocked(contestId);
    expect(stamp).toMatchObject({ locked: true, stampedSubmissions: 5 });
    const a = await prisma.waiverSubmission.findFirstOrThrow({ where: { contestId, universalProfileId: aiA }, include: { lockedRevision: true } });
    expect(a).toMatchObject({ status: "LOCKED" });
    expect(a.lockedRevision).toMatchObject({ revisionNumber: 2, kind: "SUBMISSION" });
    const b = await prisma.waiverSubmission.findFirstOrThrow({ where: { contestId, universalProfileId: aiB }, include: { lockedRevision: true } });
    expect(b.lockedRevision).toMatchObject({ revisionNumber: 1, callCount: 0 });

    const before = await competitiveState();
    await expectAiError(importBoard(aiA, `1. ${wr[3].name}`), "LOCKED");
    await expectAiError(importBoard(aiD, "NO CALLS"), "LOCKED");
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({
        data: {
          submissionId: a.id,
          revisionNumber: 3,
          kind: "SUBMISSION",
          snapshotId,
          callCount: 0,
          fingerprint: waiverBoardFingerprint({ contestId, snapshotId, rankableEntryIds: [] }),
          authorUserId: f.adminUserId,
          createdAt: new Date(),
        },
      }),
      "WAIVER_LOCKED",
    );
    expect(await competitiveState()).toEqual(before);

    const [coverage] = await prisma.$queryRaw<Array<{ revisions: bigint; responses: bigint; missing: bigint }>>`
      SELECT count(r.id) AS revisions, count(a.id) AS responses, count(*) FILTER (WHERE a.id IS NULL) AS missing
      FROM "WaiverSubmissionRevision" r
      JOIN "WaiverSubmission" s ON s.id = r."submissionId"
      LEFT JOIN "WaiverAiResponse" a ON a."revisionId" = r.id
      WHERE s."contestId" = ${contestId} AND s.authority = 'SYSTEM_OPERATED'`;
    expect([Number(coverage.revisions), Number(coverage.responses), Number(coverage.missing)]).toEqual([3, 3, 0]);
  });
});

describe("historical evidence isolation", () => {
  it("recording and reviewing evidence changes no competitive record and confers no eligibility", async () => {
    const before = await competitiveState();
    const opsBefore = await loadWaiverWeekOps(weekId);

    const late = `1. ${wr[3].name}\n2. ${wr[2].name}`;
    const records = [];
    for (const profileId of [aiD, aiA]) {
      records.push(
        await recordWaiverAiEvidence({
          adminUserId: f.adminUserId,
          contestId,
          universalProfileId: profileId,
          responseText: late,
          expectedResponseSha256: sha256Utf8(late),
          modelLabel: "Fixture model",
          statedSourceAt: new Date(before.contest.locksAt.getTime() - 3_600_000),
          evidenceSource: "CHAT_EXPORT",
          evidenceReference: "export.json",
          note: null,
        }),
      );
    }
    for (const record of records) {
      expect(record.recordedAfterLock).toBe(true);
      await reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId: record.evidenceId, expectedSequence: 0, status: "TEXT_CONFIRMED", note: "matches export" });
    }

    expect(await competitiveState()).toEqual(before);
    await expectAiError(importBoard(aiD, late), "LOCKED");
    expect(await prisma.waiverSubmission.count({ where: { universalProfileId: aiD } })).toBe(0);

    const ops = await loadWaiverWeekOps(weekId);
    const opsContest = ops!.contests.find((contest) => contest.id === contestId)!;
    expect(opsContest).toMatchObject({ submitted: 5, aiSubmitted: 2, drafts: 0 });
    expect(opsContest).toEqual(opsBefore!.contests.find((contest) => contest.id === contestId));

    const coverage = await loadWaiverAiWeekView(weekId);
    expect(coverage!.cells[aiD]?.WR).toMatchObject({ status: "EVIDENCE_ONLY", evidenceCount: 1 });
    expect(coverage!.cells[aiA]?.WR).toMatchObject({ status: "LOCKED", revisionNumber: 2, evidenceCount: 1 });
    expect(coverage!.totals).toMatchObject({ locked: 2, evidenceOnly: 1 });
  });
});

describe("public consensus separation", () => {
  it("the public consensus counts human boards only; the all-boards read identifies AI boards", async () => {
    const view = await loadWaiverPlayWeekView({ weekId, position: "WR", viewerProfileId: null });
    const consensus = view.selected.consensus;
    expect(consensus).toMatchObject({ status: "PUBLISHED", boardCount: 3, callingBoardCount: 3, abstentionCount: 0 });
    if (consensus?.status !== "PUBLISHED") return;
    expect(consensus.rows.map((row) => row.rankableEntryId).sort()).toEqual([wr[0].id, wr[1].id, wr[2].id].sort());
    expect(JSON.stringify(consensus)).not.toMatch(new RegExp([wr[4].id, wr[5].id].join("|")));
    expect(JSON.stringify(view)).not.toMatch(new RegExp([aiA, aiB, aiD].join("|")));

    const revealed = await loadRevealableWaiverBoards(contestId);
    if (!revealed.revealed) throw new Error("expected revealed boards");
    expect(revealed.boards).toHaveLength(5);
    expect(revealed.boards.map((board) => waiverBoardCategory(board)).sort()).toEqual(["AI", "AI", "HUMANS", "HUMANS", "HUMANS"]);
    expect(filterWaiverBoardsByCategory(revealed.boards, "HUMANS")).toHaveLength(3);
    expect(revealed.boards.some((board) => board.universalProfileId === aiD)).toBe(false);
  });
});
