import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWaiverFixture, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { getWaiverContestSubmissionCounts, loadRevealableWaiverBoards } from "@/lib/waivers/access-queries";
import { getOwnWaiverBoard, saveWaiverDraft, submitWaiverBoard } from "@/lib/waivers/submissions";

let f: WaiverFixture;
let wr: FixturePlayer[];

beforeAll(async () => {
  f = await createWaiverFixture("acc");
  wr = await f.addPlayers("WR", 5);
});

afterAll(async () => {
  await f?.cleanup();
});

describe("Waiver board visibility", () => {
  it("before lock: owners see only their own board, counts are aggregate, nothing is revealable", async () => {
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: wr.map((player) => ({ player })) });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "WR" });
    const a = await f.addParticipant("v_a");
    const b = await f.addParticipant("v_b");
    const d = await f.addParticipant("v_d");
    const outsider = await f.addParticipant("v_out");
    const aFirst = await submitWaiverBoard({ contestId: contest.id, universalProfileId: a.profileId, userId: a.userId, playerIds: [wr[0].id] });
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: a.profileId, userId: a.userId, playerIds: [wr[1].id, wr[0].id] });
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: b.profileId, userId: b.userId, playerIds: [] });
    await saveWaiverDraft({ contestId: contest.id, universalProfileId: d.profileId, userId: d.userId, playerIds: [wr[2].id] });

    expect(await loadRevealableWaiverBoards(contest.id)).toEqual({ revealed: false, boards: [] });
    const counts = await getWaiverContestSubmissionCounts(contest.id);
    expect(counts).toEqual({ submitted: 2, drafts: 1 });
    expect(Object.keys(counts).sort()).toEqual(["drafts", "submitted"]);

    const aOwn = await getOwnWaiverBoard({ contestId: contest.id, universalProfileId: a.profileId });
    expect(aOwn?.board?.calls.map((c) => c.rankableEntryId)).toEqual([wr[1].id, wr[0].id]);
    expect(JSON.stringify(aOwn)).not.toContain(b.profileId);
    expect((await getOwnWaiverBoard({ contestId: contest.id, universalProfileId: outsider.profileId }))?.board).toBeNull();

    await f.passLock(contest.id);
    const revealed = await loadRevealableWaiverBoards(contest.id);
    expect(revealed.revealed).toBe(true);
    const boards = revealed.boards;
    expect(boards.map((board) => board.universalProfileId).sort()).toEqual([a.profileId, b.profileId].sort());
    expect(boards.some((board) => board.universalProfileId === d.profileId)).toBe(false);
    const aBoard = boards.find((board) => board.universalProfileId === a.profileId)!;
    expect(aBoard.calls).toEqual([
      { slot: 1, rankableEntryId: wr[1].id },
      { slot: 2, rankableEntryId: wr[0].id },
    ]);
    expect(aBoard.submissionId).toBe(aFirst.submissionId);
    expect(aBoard.abstention).toBe(false);
    expect(boards.find((board) => board.universalProfileId === b.profileId)?.abstention).toBe(true);

    expect(await getWaiverContestSubmissionCounts(contest.id)).toEqual({ submitted: 2, drafts: 1 });
  });

  it("an unknown contest reveals nothing", async () => {
    expect(await loadRevealableWaiverBoards("missing-contest")).toEqual({ revealed: false, boards: [] });
  });
});
