import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadWaiverPlayWeekView } from "@/lib/waivers/play-queries";
import { saveWaiverDraft, submitWaiverBoard, WaiverSubmissionError } from "@/lib/waivers/submissions";

let f: WaiverFixture;
let qb: FixturePlayer[];
let wr: FixturePlayer[];
let te: FixturePlayer[];

beforeAll(async () => {
  f = await createWaiverFixture("play");
  qb = await f.addPlayers("QB", 4);
  wr = await f.addPlayers("WR", 7);
  te = await f.addPlayers("TE", 2);
});

afterAll(async () => {
  await f?.cleanup();
});

const tabState = (view: Awaited<ReturnType<typeof loadWaiverPlayWeekView>>) =>
  Object.fromEntries(view.tabs.map((tab) => [tab.position, tab.state]));

describe("Waivers play surface — week and snapshot states", () => {
  it("no week → every position says Waivers aren't open", async () => {
    const view = await loadWaiverPlayWeekView({ weekId: null, position: "QB", viewerProfileId: null });
    expect(view.week).toBeNull();
    expect(view.selected.state).toBe("NO_WEEK");
    expect(new Set(view.tabs.map((tab) => tab.state))).toEqual(new Set(["NO_WEEK"]));
    const missing = await loadWaiverPlayWeekView({ weekId: "missing-week", position: "QB", viewerProfileId: null });
    expect(missing.selected.state).toBe("NO_WEEK");
  });

  it("week without a snapshot → pool being prepared; frozen but not opened → pool ready / no players", async () => {
    const week = await f.addWeek();
    const before = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "RB", viewerProfileId: null });
    expect(before.week?.id).toBe(week.weekId);
    expect(new Set(before.tabs.map((tab) => tab.state))).toEqual(new Set(["POOL_PREPARING"]));

    await f.freezeSnapshot({ weekId: week.weekId, rows: [...qb.map((player) => ({ player })), { player: te[0], eligibility: "EXCLUDED" }] });
    const after = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "QB", viewerProfileId: null });
    expect(tabState(after)).toEqual({ QB: "POOL_READY", RB: "NO_PLAYERS", WR: "NO_PLAYERS", TE: "NO_PLAYERS", DEF: "NO_PLAYERS" });
    expect(after.selected.pool).toEqual([]);
    expect(after.selected.contestId).toBeNull();
  });
});

describe("Waivers play surface — open contest", () => {
  it("serves only the frozen eligible pool with snapshot ownership, and never other boards before lock", async () => {
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({
      weekId: week.weekId,
      rows: [
        ...wr.slice(0, 5).map((player, i) => ({ player, rosteredBps: 1000 + i * 150 })),
        { player: wr[5], eligibility: "EXCLUDED" as const },
        { player: wr[6], evidenceRole: "FOLLOW_UP" as const, rosteredBps: 8000 },
        ...qb.map((player) => ({ player })),
      ],
    });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "WR", locksInMs: 60 * 60_000 });
    const a = await f.addParticipant("pl_a");
    const b = await f.addParticipant("pl_b");

    const publicView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: null });
    expect(publicView.selected.state).toBe("OPEN");
    expect(publicView.selected.availableSlots).toBe(5);
    expect(publicView.selected.pool.map((entry) => entry.rankableEntryId)).toEqual(wr.slice(0, 5).map((p) => p.id));
    expect(publicView.selected.pool.map((entry) => entry.rosteredBps)).toEqual([1000, 1150, 1300, 1450, 1600]);
    expect(publicView.selected.pool.every((entry) => entry.team === "SF")).toBe(true);
    expect(publicView.selected.board).toBeNull();
    expect(publicView.selected.consensus).toBeNull();
    expect(tabState(publicView).QB).toBe("POOL_READY");
    expect(publicView.tabs.every((tab) => tab.viewerStatus === null)).toBe(true);

    // Live roster data drifting after freeze never changes the official pool.
    await prisma.rankableEntry.update({ where: { id: wr[0].id }, data: { team: "NYJ", name: "Renamed Live" } });
    const drifted = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: null });
    expect(drifted.selected.pool[0]).toMatchObject({ team: "SF", displayName: wr[0].name });

    await saveWaiverDraft({ contestId: contest.id, universalProfileId: a.profileId, userId: a.userId, playerIds: [wr[1].id] });
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: b.profileId, userId: b.userId, playerIds: [wr[3].id, wr[4].id] });

    const aView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: a.profileId });
    expect(aView.selected.board?.status).toBe("DRAFT");
    expect(aView.selected.board?.calls.map((call) => call.rankableEntryId)).toEqual([wr[1].id]);
    expect(aView.tabs.find((tab) => tab.position === "WR")?.viewerStatus).toBe("DRAFT");
    expect(aView.selected.consensus).toBeNull();
    const serialized = JSON.stringify(aView);
    expect(serialized).not.toContain(b.profileId);
    expect(aView.selected.board?.calls.some((call) => call.rankableEntryId === wr[3].id)).toBe(false);
    expect(serialized).not.toMatch(/calledCount|winCount|abstentionCount/);

    await saveWaiverDraft({ contestId: contest.id, universalProfileId: a.profileId, userId: a.userId, playerIds: [] });
    const emptiedView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: a.profileId });
    expect(emptiedView.selected.board).toMatchObject({ status: "NONE", calls: [] });
    expect(emptiedView.tabs.find((tab) => tab.position === "WR")?.viewerStatus).toBe("NONE");
  });

  it("submit, revise, and zero-call abstention are distinct; the current revision is reported", async () => {
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: qb.map((player) => ({ player })) });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "QB", locksInMs: 60 * 60_000 });
    const p = await f.addParticipant("pl_rev");
    const z = await f.addParticipant("pl_zero");

    const first = await submitWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [qb[0].id] });
    let view = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "QB", viewerProfileId: p.profileId });
    expect(view.selected.board).toMatchObject({ status: "SUBMITTED", revisionNumber: first.revisionNumber });
    expect(view.selected.board?.calls.map((call) => call.label)).toEqual(["WIN"]);

    const revised = await submitWaiverBoard({
      contestId: contest.id,
      universalProfileId: p.profileId,
      userId: p.userId,
      playerIds: [qb[2].id, qb[0].id, qb[1].id],
    });
    expect(revised.revisionNumber).toBe(first.revisionNumber + 1);
    view = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "QB", viewerProfileId: p.profileId });
    expect(view.selected.board?.revisionNumber).toBe(revised.revisionNumber);
    expect(view.selected.board?.calls.map((call) => [call.label, call.rankableEntryId])).toEqual([
      ["WIN", qb[2].id],
      ["PLACE", qb[0].id],
      ["SHOW", qb[1].id],
    ]);

    await expect(
      submitWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [qb[0].id, null, qb[1].id] }),
    ).rejects.toMatchObject({ code: "INVALID_BOARD" });
    await expect(
      submitWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [qb[0].id, qb[0].id] }),
    ).rejects.toMatchObject({ code: "INVALID_BOARD" });
    await expect(
      submitWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [wr[0].id] }),
    ).rejects.toMatchObject({ code: "INVALID_BOARD" });
    await expect(
      submitWaiverBoard({
        contestId: contest.id,
        universalProfileId: p.profileId,
        userId: p.userId,
        playerIds: [qb[0].id, qb[1].id, qb[2].id, qb[3].id],
      }),
    ).rejects.toMatchObject({ code: "INVALID_BOARD" });

    await submitWaiverBoard({ contestId: contest.id, universalProfileId: z.profileId, userId: z.userId, playerIds: [] });
    const zView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "QB", viewerProfileId: z.profileId });
    expect(zView.selected.board).toMatchObject({ status: "ABSTAINED", calls: [] });
    expect(zView.tabs.find((tab) => tab.position === "QB")?.viewerStatus).toBe("ABSTAINED");
  });
});

describe("Waivers play surface — lock, reveal, consensus", () => {
  it("locks on the database clock, rejects late writes, and reveals own board plus consensus", async () => {
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: wr.slice(0, 5).map((player) => ({ player })) });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "WR", locksInMs: 60 * 60_000 });
    const caller = await f.addParticipant("lk_call");
    const second = await f.addParticipant("lk_two");
    const third = await f.addParticipant("lk_three");
    const abstainer = await f.addParticipant("lk_zero");
    const drafter = await f.addParticipant("lk_draft");
    const absent = await f.addParticipant("lk_none");

    await submitWaiverBoard({ contestId: contest.id, universalProfileId: caller.profileId, userId: caller.userId, playerIds: [wr[0].id, wr[1].id, wr[2].id, wr[3].id, wr[4].id] });
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: second.profileId, userId: second.userId, playerIds: [wr[1].id, wr[0].id] });
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: third.profileId, userId: third.userId, playerIds: [wr[2].id] });
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: abstainer.profileId, userId: abstainer.userId, playerIds: [] });
    await saveWaiverDraft({ contestId: contest.id, universalProfileId: drafter.profileId, userId: drafter.userId, playerIds: [wr[4].id, wr[3].id] });

    const preLock = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: null });
    expect(preLock.selected.state).toBe("OPEN");
    expect(preLock.selected.consensus).toBeNull();

    await f.passLock(contest.id);

    await expect(
      submitWaiverBoard({ contestId: contest.id, universalProfileId: drafter.profileId, userId: drafter.userId, playerIds: [wr[0].id] }),
    ).rejects.toBeInstanceOf(WaiverSubmissionError);
    await expect(
      saveWaiverDraft({ contestId: contest.id, universalProfileId: absent.profileId, userId: absent.userId, playerIds: [wr[0].id] }),
    ).rejects.toMatchObject({ code: "LOCKED" });

    const callerView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: caller.profileId });
    expect(callerView.selected.state).toBe("LOCKED");
    expect(callerView.selected.board?.status).toBe("LOCKED_IN");
    expect(callerView.selected.board?.calls.map((call) => call.label)).toEqual(["WIN", "PLACE", "SHOW", "#4", "#5"]);
    expect(callerView.tabs.find((tab) => tab.position === "WR")).toMatchObject({ state: "LOCKED", viewerStatus: "LOCKED_IN" });

    const abstainerView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: abstainer.profileId });
    expect(abstainerView.selected.board?.status).toBe("LOCKED_ABSTAINED");

    const drafterView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: drafter.profileId });
    expect(drafterView.selected.board?.status).toBe("MISSED");
    expect(drafterView.tabs.find((tab) => tab.position === "WR")?.viewerStatus).toBe("MISSED");

    const absentView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: absent.profileId });
    expect(absentView.selected.board).toBeNull();
    expect(absentView.tabs.find((tab) => tab.position === "WR")?.viewerStatus).toBe("MISSED");

    const publicView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "WR", viewerProfileId: null });
    const consensus = publicView.selected.consensus!;
    if (consensus.status !== "PUBLISHED") throw new Error("expected published consensus");
    expect(consensus.boardCount).toBe(4);
    expect(consensus.callingBoardCount).toBe(3);
    expect(consensus.abstentionCount).toBe(1);
    expect(consensus.rows.map((row) => [row.rankableEntryId, row.calledCount, row.winCount, row.top3Count])).toEqual([
      [wr[0].id, 2, 1, 2],
      [wr[1].id, 2, 1, 2],
      [wr[2].id, 2, 1, 2],
      [wr[3].id, 1, 0, 0],
      [wr[4].id, 1, 0, 0],
    ]);
    expect(consensus.rows[0].displayName).toBe(wr[0].name);
    expect(JSON.stringify(publicView)).not.toContain(caller.profileId);
    expect(publicView.selected.board).toBeNull();
  });

  it("withholds consensus below 3 boards with calls — drafts and zero-call boards never count", async () => {
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: qb.map((player) => ({ player })) });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "QB", locksInMs: 60 * 60_000 });
    const callers = [await f.addParticipant("th_c1"), await f.addParticipant("th_c2")];
    const zeros = [await f.addParticipant("th_z1"), await f.addParticipant("th_z2")];
    const drafters = [await f.addParticipant("th_d1"), await f.addParticipant("th_d2"), await f.addParticipant("th_d3")];

    for (const [i, p] of callers.entries()) {
      await submitWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [qb[i].id, qb[3].id] });
    }
    for (const p of zeros) {
      await submitWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [] });
    }
    for (const p of drafters) {
      await saveWaiverDraft({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [qb[2].id, qb[1].id] });
    }
    await f.passLock(contest.id);

    const view = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "QB", viewerProfileId: callers[0].profileId });
    expect(view.selected.state).toBe("LOCKED");
    expect(view.selected.consensus).toEqual({ status: "WITHHELD" });
    expect(view.selected.board?.status).toBe("LOCKED_IN");
    const publicView = await loadWaiverPlayWeekView({ weekId: week.weekId, position: "QB", viewerProfileId: null });
    expect(publicView.selected.consensus).toEqual({ status: "WITHHELD" });
    expect(JSON.stringify(publicView)).not.toMatch(/calledCount|winCount|top3Count|abstentionCount|boardCount/);
  });
});

describe("Waivers play surface — frozen matchup orientation", () => {
  it("shows home/away only when the pinned game matches the frozen team and opponent", async () => {
    const week = await f.addWeek({ games: [{ homeTeam: "DET", awayTeam: "GB" }] });
    const game = await prisma.nflGame.findFirstOrThrow({ where: { weekId: week.weekId }, select: { id: true } });
    const players = await f.addPlayers("TE", 4);
    const snapshot = await f.freezeSnapshot({
      weekId: week.weekId,
      rows: [
        { player: players[0], team: "GB", opponent: "DET", nflGameId: game.id },
        { player: players[1], team: "DET", opponent: "GB", nflGameId: game.id },
        { player: players[2], team: "GB", opponent: "DET" },
        { player: players[3], team: "CHI", opponent: "DET", nflGameId: game.id },
      ],
    });
    await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "TE", locksInMs: 60 * 60_000 });

    const sides = async () =>
      (await loadWaiverPlayWeekView({ weekId: week.weekId, position: "TE", viewerProfileId: null })).selected.pool.map((entry) => [
        entry.opponent,
        entry.matchupSide,
      ]);
    expect(await sides()).toEqual([
      ["DET", "AWAY"],
      ["GB", "HOME"],
      ["DET", null],
      ["DET", null],
    ]);

    // A later change to the game row that no longer matches the frozen facts degrades to neutral, never a flip.
    await prisma.nflGame.update({ where: { id: game.id }, data: { homeTeam: "MIN" } });
    expect(await sides()).toEqual([
      ["DET", null],
      ["GB", null],
      ["DET", null],
      ["DET", null],
    ]);
  });
});
