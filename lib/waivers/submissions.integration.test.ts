import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { getWaiverContestSubmissionCounts } from "@/lib/waivers/access-queries";
import {
  getOwnWaiverBoard,
  saveWaiverDraft,
  submitWaiverBoard,
  WaiverSubmissionError,
} from "@/lib/waivers/submissions";

let f: WaiverFixture;
let weekId: string;
let snapshotId: string;
let wr: FixturePlayer[];
let qb: FixturePlayer[];
let excludedWr: FixturePlayer;
let followUpWr: FixturePlayer;
let wrContestId: string;
let qbContestId: string;

async function expectSubmissionError(promise: Promise<unknown>, code: string) {
  let error: unknown = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(WaiverSubmissionError);
  expect((error as WaiverSubmissionError).code).toBe(code);
}

const ids = (players: FixturePlayer[]) => players.map((p) => p.id);

beforeAll(async () => {
  f = await createWaiverFixture("sub");
  wr = await f.addPlayers("WR", 7);
  qb = await f.addPlayers("QB", 2);
  [excludedWr, followUpWr] = await f.addPlayers("WR", 2);
  const week = await f.addWeek();
  weekId = week.weekId;
  const snapshot = await f.freezeSnapshot({
    weekId,
    rows: [
      ...wr.map((player) => ({ player })),
      ...qb.map((player) => ({ player })),
      { player: excludedWr, eligibility: "EXCLUDED" },
      { player: followUpWr, evidenceRole: "FOLLOW_UP" },
    ],
  });
  snapshotId = snapshot.id;
  wrContestId = (await f.createContest({ weekId, snapshotId, position: "WR" })).id;
  qbContestId = (await f.createContest({ weekId, snapshotId, position: "QB" })).id;
});

afterAll(async () => {
  await f?.cleanup();
});

describe("board shape at the service layer", () => {
  it.each([0, 1, 2, 3, 4, 5])("accepts a contiguous %i-call WR submission", async (count) => {
    const p = await f.addParticipant(`shape${count}`);
    const result = await submitWaiverBoard({
      contestId: wrContestId,
      universalProfileId: p.profileId,
      userId: p.userId,
      playerIds: ids(wr.slice(0, count)),
    });
    expect(result).toMatchObject({ status: "SUBMITTED", revisionNumber: 1, callCount: count, changed: true });
    const calls = await prisma.waiverCall.findMany({
      where: { revision: { submissionId: result.submissionId } },
      orderBy: { slot: "asc" },
      select: { slot: true, snapshotEntry: { select: { rankableEntryId: true, snapshotId: true } } },
    });
    expect(calls.map((c) => c.slot)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(calls.map((c) => c.snapshotEntry.rankableEntryId)).toEqual(ids(wr.slice(0, count)));
    expect(calls.every((c) => c.snapshotEntry.snapshotId === snapshotId)).toBe(true);
  });

  it.each([
    ["over max", () => ids(wr.slice(0, 6))],
    ["a gap", () => [wr[0].id, null, wr[2].id]],
    ["a duplicate", () => [wr[0].id, wr[0].id]],
    ["an excluded player", () => [excludedWr.id]],
    ["a follow-up (observation-only) player", () => [followUpWr.id]],
    ["a player from another position", () => [qb[0].id]],
    ["an unknown player", () => ["not-a-player"]],
  ])("rejects %s without writing anything", async (_label, board) => {
    const p = await f.addParticipant(`bad${Math.random().toString(36).slice(2, 7)}`);
    await expectSubmissionError(
      submitWaiverBoard({ contestId: wrContestId, universalProfileId: p.profileId, userId: p.userId, playerIds: board() }),
      "INVALID_BOARD",
    );
    expect(await prisma.waiverSubmission.count({ where: { contestId: wrContestId, universalProfileId: p.profileId } })).toBe(0);
  });

  it("caps a small pool at the effective maximum (QB pool of 2)", async () => {
    const p = await f.addParticipant("smallpool");
    await expectSubmissionError(
      submitWaiverBoard({ contestId: qbContestId, universalProfileId: p.profileId, userId: p.userId, playerIds: [qb[0].id, qb[1].id, wr[0].id] }),
      "INVALID_BOARD",
    );
    const ok = await submitWaiverBoard({ contestId: qbContestId, universalProfileId: p.profileId, userId: p.userId, playerIds: ids(qb) });
    expect(ok.callCount).toBe(2);
    const own = await getOwnWaiverBoard({ contestId: qbContestId, universalProfileId: p.profileId });
    expect(own?.contest.availableSlots).toBe(2);
  });
});

describe("participation states", () => {
  it("distinguishes no row, draft-only, and explicit zero-call abstention", async () => {
    const none = await f.addParticipant("none");
    const drafter = await f.addParticipant("drafter");
    const abstainer = await f.addParticipant("abstainer");

    expect((await getOwnWaiverBoard({ contestId: wrContestId, universalProfileId: none.profileId }))?.board).toBeNull();

    const draft = await saveWaiverDraft({
      contestId: wrContestId,
      universalProfileId: drafter.profileId,
      userId: drafter.userId,
      playerIds: [wr[0].id],
    });
    expect(draft).toMatchObject({ status: "DRAFT", submittedAt: null, revisionNumber: 1 });
    const draftBoard = (await getOwnWaiverBoard({ contestId: wrContestId, universalProfileId: drafter.profileId }))?.board;
    expect(draftBoard).toMatchObject({ status: "DRAFT", competitive: false, abstention: false });

    const abstention = await submitWaiverBoard({
      contestId: wrContestId,
      universalProfileId: abstainer.profileId,
      userId: abstainer.userId,
      playerIds: [null, null, null, null, null],
    });
    expect(abstention).toMatchObject({ status: "SUBMITTED", callCount: 0 });
    const abstainBoard = (await getOwnWaiverBoard({ contestId: wrContestId, universalProfileId: abstainer.profileId }))?.board;
    expect(abstainBoard).toMatchObject({ status: "SUBMITTED", competitive: true, abstention: true, calls: [] });
    const revision = await prisma.waiverSubmissionRevision.findFirstOrThrow({ where: { submissionId: abstention.submissionId } });
    expect(revision).toMatchObject({ kind: "SUBMISSION", callCount: 0 });

    const counts = await getWaiverContestSubmissionCounts(wrContestId);
    expect(counts.drafts).toBeGreaterThanOrEqual(1);
    expect(counts.submitted).toBeGreaterThanOrEqual(1);
  });

  it("a draft can be revised, then submitted; submitted boards never return to draft", async () => {
    const p = await f.addParticipant("lifecycle");
    const base = { contestId: wrContestId, universalProfileId: p.profileId, userId: p.userId };
    await saveWaiverDraft({ ...base, playerIds: [wr[0].id] });
    const draft2 = await saveWaiverDraft({ ...base, playerIds: [wr[1].id, wr[0].id] });
    expect(draft2).toMatchObject({ status: "DRAFT", revisionNumber: 2 });

    const submitted = await submitWaiverBoard({ ...base, playerIds: [wr[1].id, wr[0].id] });
    expect(submitted).toMatchObject({ status: "SUBMITTED", revisionNumber: 3, changed: true });

    await expectSubmissionError(saveWaiverDraft({ ...base, playerIds: [wr[2].id] }), "ALREADY_SUBMITTED");

    const same = await submitWaiverBoard({ ...base, playerIds: [wr[1].id, wr[0].id] });
    expect(same).toMatchObject({ changed: false, revisionNumber: 3 });
    expect(same.submittedAt?.toISOString()).toBe(submitted.submittedAt?.toISOString());

    const revised = await submitWaiverBoard({ ...base, playerIds: [wr[3].id] });
    expect(revised).toMatchObject({ status: "SUBMITTED", revisionNumber: 4, callCount: 1 });
    expect(revised.submittedAt!.getTime()).toBeGreaterThanOrEqual(submitted.submittedAt!.getTime());

    const withdrawnToZero = await submitWaiverBoard({ ...base, playerIds: [] });
    expect(withdrawnToZero).toMatchObject({ status: "SUBMITTED", revisionNumber: 5, callCount: 0 });

    const history = await prisma.waiverSubmissionRevision.findMany({
      where: { submissionId: submitted.submissionId },
      orderBy: { revisionNumber: "asc" },
      select: {
        revisionNumber: true,
        kind: true,
        callCount: true,
        calls: { orderBy: { slot: "asc" }, select: { snapshotEntry: { select: { rankableEntryId: true } } } },
      },
    });
    expect(history.map((r) => [r.revisionNumber, r.kind, r.callCount])).toEqual([
      [1, "DRAFT", 1],
      [2, "DRAFT", 2],
      [3, "SUBMISSION", 2],
      [4, "SUBMISSION", 1],
      [5, "SUBMISSION", 0],
    ]);
    expect(history[2].calls.map((c) => c.snapshotEntry.rankableEntryId)).toEqual([wr[1].id, wr[0].id]);
    const row = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: submitted.submissionId } });
    expect(row.status).toBe("SUBMITTED");
  });

  it("validates against the frozen snapshot, not mutable live player state", async () => {
    const p = await f.addParticipant("frozen");
    const base = { contestId: wrContestId, universalProfileId: p.profileId, userId: p.userId };
    await submitWaiverBoard({ ...base, playerIds: [wr[4].id] });

    await prisma.playerWeekAvailability.create({ data: { weekId, rankableEntryId: wr[4].id, designation: "OUT" } });
    await prisma.rankableEntry.update({
      where: { id: wr[4].id },
      data: { team: "NYJ", active: false, availability: "OUT", name: "Renamed Player" },
    });

    const again = await submitWaiverBoard({ ...base, playerIds: [wr[4].id, wr[5].id] });
    expect(again).toMatchObject({ status: "SUBMITTED", callCount: 2 });
    const own = await getOwnWaiverBoard({ contestId: wrContestId, universalProfileId: p.profileId });
    expect(own?.board?.calls[0]).toMatchObject({ rankableEntryId: wr[4].id, displayName: wr[4].name, team: "SF" });
    expect(own?.board?.needsReview).toBe(false);
  });
});

describe("participant identity and authority", () => {
  it("stays attached to its profile; one board per login per contest", async () => {
    const p = await f.addParticipant("ident");
    const first = await submitWaiverBoard({ contestId: wrContestId, universalProfileId: p.profileId, userId: p.userId, playerIds: [wr[0].id] });
    const row = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: first.submissionId } });
    expect(row).toMatchObject({ universalProfileId: p.profileId, createdByUserId: p.userId, authority: "OWNER_AUTHORED" });

    const second = await f.addParticipant("ident2");
    await prisma.user.update({ where: { id: second.userId }, data: { universalProfileId: null } });
    await prisma.user.update({ where: { id: p.userId }, data: { universalProfileId: second.profileId } });
    await expectSubmissionError(
      submitWaiverBoard({ contestId: wrContestId, universalProfileId: second.profileId, userId: p.userId, playerIds: [wr[1].id] }),
      "DUPLICATE_ENTRY",
    );
    await expectSubmissionError(
      submitWaiverBoard({ contestId: wrContestId, universalProfileId: p.profileId, userId: p.userId, playerIds: [wr[1].id] }),
      "FORBIDDEN",
    );
    const unchanged = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: first.submissionId } });
    expect(unchanged.universalProfileId).toBe(p.profileId);
  });

  it("refuses writes for a profile the login does not own", async () => {
    const a = await f.addParticipant("owner");
    const b = await f.addParticipant("intruder");
    await expectSubmissionError(
      submitWaiverBoard({ contestId: wrContestId, universalProfileId: a.profileId, userId: b.userId, playerIds: [] }),
      "FORBIDDEN",
    );
  });

  it.each(["AI", "BENCHMARK"] as const)("refuses %s profiles on the owner-authored path", async (type) => {
    const p = await f.addParticipant(`t${type}`, type);
    await expectSubmissionError(
      submitWaiverBoard({ contestId: wrContestId, universalProfileId: p.profileId, userId: p.userId, playerIds: [] }),
      "FORBIDDEN",
    );
  });

  it("accepts CREATOR profiles and refuses suspended ones", async () => {
    const creator = await f.addParticipant("creator", "CREATOR");
    await expect(
      submitWaiverBoard({ contestId: wrContestId, universalProfileId: creator.profileId, userId: creator.userId, playerIds: [wr[0].id] }),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    const suspended = await f.addParticipant("susp", "HUMAN", "SUSPENDED");
    await expectSubmissionError(
      submitWaiverBoard({ contestId: wrContestId, universalProfileId: suspended.profileId, userId: suspended.userId, playerIds: [] }),
      "FORBIDDEN",
    );
  });

  it("reports an unknown contest", async () => {
    const p = await f.addParticipant("nocontest");
    await expectSubmissionError(
      submitWaiverBoard({ contestId: "missing-contest", universalProfileId: p.profileId, userId: p.userId, playerIds: [] }),
      "NOT_FOUND",
    );
  });
});

describe("concurrency", () => {
  it("concurrent writes to one board serialize into a gapless revision history", async () => {
    const p = await f.addParticipant("race");
    const base = { contestId: wrContestId, universalProfileId: p.profileId, userId: p.userId };
    const boards = [[wr[0].id], [wr[1].id], [wr[2].id], [wr[3].id]];
    const results = await Promise.allSettled(boards.map((playerIds) => submitWaiverBoard({ ...base, playerIds })));
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(WaiverSubmissionError);
        expect((result.reason as WaiverSubmissionError).code).toBe("CONFLICT");
      }
    }
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    const submissions = await prisma.waiverSubmission.findMany({ where: { contestId: wrContestId, universalProfileId: p.profileId } });
    expect(submissions).toHaveLength(1);
    const revisions = await prisma.waiverSubmissionRevision.findMany({
      where: { submissionId: submissions[0].id },
      orderBy: { revisionNumber: "asc" },
    });
    expect(revisions.map((r) => r.revisionNumber)).toEqual(revisions.map((_, i) => i + 1));
    expect(submissions[0].currentRevisionId).toBe(revisions.at(-1)!.id);
    expect(submissions[0].submittedAt?.toISOString()).toBe(revisions.at(-1)!.createdAt.toISOString());
  });
});
