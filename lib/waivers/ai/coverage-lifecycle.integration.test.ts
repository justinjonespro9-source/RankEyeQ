import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAiDirectoryActive } from "@/lib/ai-identity";
import { prisma } from "@/lib/db";
import { createWaiverFixture, expectDbGuard, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadRevealableWaiverBoards } from "@/lib/waivers/access-queries";
import { overrideWaiverAiBoard } from "@/lib/waivers/ai/competitive-override";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { loadWaiverAiBoardView, loadWaiverAiWeekView, type WaiverAiWeekView } from "@/lib/waivers/ai/queries";
import { importAiWaiverBoard, parseAgainstContext, previewWaiverAiResponse, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { sha256Utf8 } from "@/lib/waivers/ai/text";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Retiring an AI from the roster (Admin → AI competitor directory, which sets
 * competitorActive=false) takes it out of active coverage and refuses new
 * boards for it, while every board already recorded stays as it was.
 */

let f: WaiverFixture;
let weekId: string;
let qb: FixturePlayer[];
let wr: FixturePlayer[];
let qbContest: string;
let wrContest: string;
const ai: Record<"keep" | "retired" | "unused" | "late", string> = { keep: "", retired: "", unused: "", late: "" };
let human: { userId: string; profileId: string };
let before: WaiverAiWeekView;
let boardsBefore: string;
let humanBefore: string;

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

async function importBoard(profileId: string, contestId: string, responseText: string) {
  const preview = await previewWaiverAiResponse({ adminUserId: f.adminUserId, contestId, responseText });
  return importAiWaiverBoard({
    adminUserId: f.adminUserId,
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

async function lateSubmit(profileId: string, contestId: string, responseText: string) {
  const context = await loadWaiverAiContestContext(prisma, contestId);
  return overrideWaiverAiBoard({
    adminUserId: f.adminUserId,
    contestId,
    universalProfileId: profileId,
    responseText,
    expectedResponseSha256: sha256Utf8(responseText),
    confirmedRankableEntryIds: parseAgainstContext(context!, responseText).picks.map((pick) => pick.rankableEntryId),
    modelLabel: "",
    sourceReference: null,
    allowLateSubmission: true,
  });
}

async function boardsJson(where: object) {
  return JSON.stringify(
    await prisma.waiverSubmission.findMany({
      where: { contest: { weekId }, ...where },
      orderBy: { id: "asc" },
      include: {
        revisions: { orderBy: { revisionNumber: "asc" }, include: { calls: { orderBy: { slot: "asc" } }, aiResponse: true } },
        competitiveOverride: true,
        lateEntry: true,
      },
    }),
  );
}

const activeAiCount = () => prisma.universalProfile.count({ where: { profileType: "AI", status: "ACTIVE", competitorActive: true } });

beforeAll(async () => {
  f = await createWaiverFixture("aicov");
  qb = await f.addPlayers("QB", 4);
  wr = await f.addPlayers("WR", 4);
  weekId = (await f.addWeek()).weekId;
  const snapshot = await f.freezeSnapshot({ weekId, rows: [...qb, ...wr].map((player) => ({ player })) });
  qbContest = (await f.createContest({ weekId, snapshotId: snapshot.id, position: "QB" })).id;
  wrContest = (await f.createContest({ weekId, snapshotId: snapshot.id, position: "WR" })).id;
  for (const key of Object.keys(ai) as Array<keyof typeof ai>) ai[key] = (await f.addAiCompetitor(`cov${key}`)).profileId;
  human = await f.addParticipant("covhuman");

  await submitWaiverBoard({ contestId: qbContest, universalProfileId: human.profileId, userId: human.userId, playerIds: [qb[0].id, qb[1].id] });
  await importBoard(ai.keep, qbContest, `1. ${qb[2].name}`);
  await importBoard(ai.retired, qbContest, `1. ${qb[1].name}\n2. ${qb[3].name}`);
  await f.passLock(qbContest, new Date(Date.now() + 5));
  await ensureWaiverContestLocked(qbContest);

  before = (await loadWaiverAiWeekView(weekId))!;
  boardsBefore = await boardsJson({});
  humanBefore = await boardsJson({ authority: "OWNER_AUTHORED" });
  await setAiDirectoryActive({ universalProfileId: ai.retired, active: false });
  await setAiDirectoryActive({ universalProfileId: ai.unused, active: false });
}, 180_000);

afterAll(async () => {
  await f?.cleanup();
});

describe("retiring an AI from WaiverEyeQ coverage", () => {
  it("drops inactive AIs from the active count; one with a board stays listed as inactive", async () => {
    const view = (await loadWaiverAiWeekView(weekId))!;
    const competitor = (id: string) => view.competitors.find((row) => row.id === id);
    expect(competitor(ai.keep)).toMatchObject({ active: true });
    expect(competitor(ai.late)).toMatchObject({ active: true });
    expect(competitor(ai.retired)).toMatchObject({ active: false });
    expect(competitor(ai.unused)).toBeUndefined();
    expect(view.totals.expected).toBe((await activeAiCount()) * view.contests.length);
    expect(view.totals.expected).toBe(before.totals.expected - 2 * view.contests.length);
    expect(view.totals.locked).toBe(before.totals.locked - 1);
    expect(view.cells[ai.retired]).toMatchObject({ QB: { status: "LOCKED", revisionNumber: 1, callCount: 2 }, WR: { status: "MISSING" } });
    expect(view.cells[ai.keep]?.QB).toMatchObject({ status: "LOCKED", callCount: 1 });
    expect(view.gradingStarted).toBe(false);
  });

  it("keeps the inactive AI's board, history and entry basis readable and revealable", async () => {
    const board = (await loadWaiverAiBoardView(ai.retired, qbContest))!;
    expect(board.profile.canSubmit).toBe(false);
    expect(board.board).toMatchObject({ status: "LOCKED", entryBasis: "ON_TIME", lockedRevisionNumber: 1 });
    expect(board.board!.revisions.map((revision) => [revision.revisionNumber, revision.calls.map((call) => call.displayName)])).toEqual([
      [1, [qb[1].name, qb[3].name]],
    ]);
    expect(board.lateSubmission.blockers).toContain("This AI profile is not an active competitor.");
    const revealed = await loadRevealableWaiverBoards(qbContest);
    expect(revealed.revealed).toBe(true);
    const retired = revealed.boards.find((row) => row.universalProfileId === ai.retired);
    expect(retired).toMatchObject({ entryBasis: "ON_TIME" });
  });

  it("refuses new boards for inactive AIs, on time and late, in the app and in the database", async () => {
    const counts = async () => [await prisma.waiverSubmission.count({ where: { contest: { weekId } } }), await prisma.waiverAiResponse.count({ where: { contest: { weekId } } })];
    const start = await counts();
    await expectAiError(importBoard(ai.retired, wrContest, `1. ${wr[0].name}`), "NOT_AI_COMPETITOR");
    await expectAiError(importBoard(ai.unused, wrContest, `1. ${wr[0].name}`), "NOT_AI_COMPETITOR");
    await expectAiError(lateSubmit(ai.unused, qbContest, `1. ${qb[0].name}`), "NOT_AI_COMPETITOR");
    await expectAiError(lateSubmit(ai.retired, qbContest, `1. ${qb[0].name}`), "NOT_AI_COMPETITOR");
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId: wrContest, universalProfileId: ai.unused, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } }),
      "WAIVER_INVALID",
    );
    expect((await loadWaiverAiBoardView(ai.unused, qbContest))!.lateSubmission.blockers).toContain("This AI profile is not an active competitor.");
    expect(await counts()).toEqual(start);
  });

  it("leaves every existing board unchanged and active AIs still submit, on time and late", async () => {
    expect(await boardsJson({})).toBe(boardsBefore);
    expect(await boardsJson({ authority: "OWNER_AUTHORED" })).toBe(humanBefore);

    await importBoard(ai.keep, wrContest, `1. ${wr[1].name}`);
    const late = await lateSubmit(ai.late, qbContest, `1. ${qb[0].name}`);
    expect(late.callCount).toBe(1);
    const board = (await loadWaiverAiBoardView(ai.late, qbContest))!;
    expect(board.board).toMatchObject({ status: "LOCKED", entryBasis: "ADMIN_COMPETITIVE_OVERRIDE" });
    const view = (await loadWaiverAiWeekView(weekId))!;
    expect(view.cells[ai.late]?.QB).toMatchObject({ status: "LOCKED", overridden: true });
    expect(view.cells[ai.keep]?.WR).toMatchObject({ status: "SUBMITTED", callCount: 1 });
    expect(await boardsJson({ authority: "OWNER_AUTHORED" })).toBe(humanBefore);
  });

  it("keeps the frozen prompt on every AI board page; the coverage page offers it only while open", async () => {
    const context = (await loadWaiverAiContestContext(prisma, qbContest))!;
    for (const id of [ai.keep, ai.retired, ai.unused]) {
      const board = (await loadWaiverAiBoardView(id, qbContest))!;
      expect(board.prompt).toMatchObject({ text: context.prompt.text, sha256: context.prompt.sha256, version: context.prompt.version });
    }
    const view = (await loadWaiverAiWeekView(weekId))!;
    expect(view.contests.find((contest) => contest.contestId === qbContest)!.promptText).toBeNull();
    expect(view.contests.find((contest) => contest.contestId === wrContest)!.promptText).not.toBeNull();
  });
});
