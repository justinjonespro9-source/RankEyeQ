import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createWaiverFixture,
  expectDbGuard,
  type FixturePlayer,
  type SnapshotRowSpec,
  type WaiverFixture,
} from "@/lib/waivers/__fixtures__/competition";
import { WaiverContestError } from "@/lib/waivers/contests";
import { repinWaiverContestsOnSupersession } from "@/lib/waivers/corrections";
import { getOwnWaiverBoard, saveWaiverDraft, submitWaiverBoard, WaiverSubmissionError } from "@/lib/waivers/submissions";

let f: WaiverFixture;
let wr: FixturePlayer[];

const v1Rows = (): SnapshotRowSpec[] => wr.slice(0, 6).map((player) => ({ player }));
/** Correction: wr[0] becomes EXCLUDED; wr[6] becomes a newly eligible candidate. */
const v2Rows = (): SnapshotRowSpec[] => [
  { player: wr[0], eligibility: "EXCLUDED" },
  ...wr.slice(1, 7).map((player) => ({ player })),
];

function repin(fromSnapshotId: string, toSnapshotId: string, adminUserId = f.adminUserId) {
  return prisma.$transaction((tx) => repinWaiverContestsOnSupersession(tx, { fromSnapshotId, toSnapshotId, adminUserId }));
}

beforeAll(async () => {
  f = await createWaiverFixture("corr");
  wr = await f.addPlayers("WR", 7);
});

afterAll(async () => {
  await f?.cleanup();
});

describe("pre-lock snapshot supersession", () => {
  it("re-pins, identifies affected boards and calls, and never rewrites history", async () => {
    const week = await f.addWeek();
    const v1 = await f.freezeSnapshot({ weekId: week.weekId, rows: v1Rows() });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: v1.id, position: "WR" });
    const a = await f.addParticipant("c_a");
    const b = await f.addParticipant("c_b");
    const d = await f.addParticipant("c_d");
    const aBase = { contestId: contest.id, universalProfileId: a.profileId, userId: a.userId };
    const aSub = await submitWaiverBoard({ ...aBase, playerIds: [wr[0].id, wr[1].id] });
    const bSub = await submitWaiverBoard({ contestId: contest.id, universalProfileId: b.profileId, userId: b.userId, playerIds: [wr[2].id] });
    const dDraft = await saveWaiverDraft({ contestId: contest.id, universalProfileId: d.profileId, userId: d.userId, playerIds: [wr[0].id] });

    const aRevisionBefore = await prisma.waiverSubmissionRevision.findFirstOrThrow({
      where: { submissionId: aSub.submissionId },
      include: { calls: { orderBy: { slot: "asc" } } },
    });

    const v2 = await f.freezeSnapshot({ weekId: week.weekId, rows: v2Rows(), supersedesId: v1.id });
    const outcomes = await repin(v1.id, v2.id);
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0];
    expect(outcome).toMatchObject({ contestId: contest.id, outcome: "REPINNED", policy: "AFFECTED_BOARDS_FLAGGED" });
    if (outcome.outcome !== "REPINNED") throw new Error("expected REPINNED");
    expect([...outcome.affectedSubmissionIds].sort()).toEqual([aSub.submissionId, dDraft.submissionId].sort());
    const aWinCall = aRevisionBefore.calls.find((c) => c.slot === 1)!;
    expect(outcome.affectedCallIds).toContain(aWinCall.id);
    expect(outcome.affectedCallIds).toHaveLength(2);

    expect((await prisma.waiverContest.findUniqueOrThrow({ where: { id: contest.id } })).snapshotId).toBe(v2.id);

    const aRevisionAfter = await prisma.waiverSubmissionRevision.findFirstOrThrow({
      where: { id: aRevisionBefore.id },
      include: { calls: { orderBy: { slot: "asc" } } },
    });
    expect(aRevisionAfter).toEqual(aRevisionBefore);
    const aRow = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: aSub.submissionId } });
    expect(aRow).toMatchObject({ status: "SUBMITTED", currentRevisionId: aRevisionBefore.id });

    const aOwn = await getOwnWaiverBoard({ contestId: contest.id, universalProfileId: a.profileId });
    expect(aOwn?.board).toMatchObject({
      status: "SUBMITTED",
      competitive: true,
      snapshotId: v1.id,
      needsReview: true,
      affectedCalls: [{ slot: 1, rankableEntryId: wr[0].id, reason: "NOT_ELIGIBLE_IN_CURRENT_SNAPSHOT" }],
    });
    expect(aOwn?.board?.calls.map((c) => c.rankableEntryId)).toEqual([wr[0].id, wr[1].id]);
    const bOwn = await getOwnWaiverBoard({ contestId: contest.id, universalProfileId: b.profileId });
    expect(bOwn?.board).toMatchObject({ needsReview: false, affectedCalls: [] });
    expect(bSub.status).toBe("SUBMITTED");

    let error: unknown = null;
    try {
      await submitWaiverBoard({ ...aBase, playerIds: [wr[0].id, wr[1].id] });
    } catch (caught) {
      error = caught;
    }
    expect((error as WaiverSubmissionError).code).toBe("INVALID_BOARD");

    const revised = await submitWaiverBoard({ ...aBase, playerIds: [wr[6].id, wr[1].id] });
    expect(revised).toMatchObject({ revisionNumber: 2, status: "SUBMITTED" });
    const aOwnAfter = await getOwnWaiverBoard({ contestId: contest.id, universalProfileId: a.profileId });
    expect(aOwnAfter?.board).toMatchObject({ snapshotId: v2.id, needsReview: false, affectedCalls: [] });
    expect(await prisma.waiverSubmissionRevision.count({ where: { submissionId: aSub.submissionId } })).toBe(2);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { adminUserId: f.adminUserId, action: "waivers.contests_repinned", entityId: v2.id },
    });
    expect(audit?.metadata).toMatchObject({ fromSnapshotId: v1.id });
  });

  it("reports NO_BOARD_EFFECT when no current call is affected", async () => {
    const week = await f.addWeek();
    const v1 = await f.freezeSnapshot({ weekId: week.weekId, rows: v1Rows() });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: v1.id, position: "WR" });
    const p = await f.addParticipant("c_clean");
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [wr[3].id] });
    const v2 = await f.freezeSnapshot({ weekId: week.weekId, rows: v2Rows(), supersedesId: v1.id });
    expect(await repin(v1.id, v2.id)).toEqual([
      expect.objectContaining({ outcome: "REPINNED", policy: "NO_BOARD_EFFECT", affectedSubmissionIds: [], affectedCallIds: [] }),
    ]);
  });

  it("refuses a target that does not directly supersede the pinned version, or a non-admin", async () => {
    const week = await f.addWeek();
    const v1 = await f.freezeSnapshot({ weekId: week.weekId, rows: v1Rows() });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: v1.id, position: "WR" });
    const other = await f.addWeek();
    const unrelated = await f.freezeSnapshot({ weekId: other.weekId, rows: v1Rows() });

    await expect(repin(v1.id, unrelated.id)).rejects.toBeInstanceOf(WaiverContestError);
    await expectDbGuard(
      prisma.waiverContest.update({ where: { id: contest.id }, data: { snapshotId: unrelated.id } }),
      "WAIVER_INVALID",
    );

    const v2 = await f.freezeSnapshot({ weekId: week.weekId, rows: v2Rows(), supersedesId: v1.id });
    const member = await f.addParticipant("c_member");
    await expect(repin(v1.id, v2.id, member.userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.waiverContest.findUniqueOrThrow({ where: { id: contest.id } })).snapshotId).toBe(v1.id);
  });
});

describe("post-lock snapshot supersession", () => {
  it("does not re-pin a locked contest: POLICY_DECISION_REQUIRED, and the DB refuses a direct re-pin", async () => {
    const week = await f.addWeek();
    const v1 = await f.freezeSnapshot({ weekId: week.weekId, rows: v1Rows() });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: v1.id, position: "WR" });
    const p = await f.addParticipant("c_locked");
    const sub = await submitWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId, userId: p.userId, playerIds: [wr[0].id] });
    await f.passLock(contest.id);

    const v2 = await f.freezeSnapshot({ weekId: week.weekId, rows: v2Rows(), supersedesId: v1.id });
    expect(await repin(v1.id, v2.id)).toEqual([
      { contestId: contest.id, position: "WR", outcome: "POLICY_DECISION_REQUIRED", policy: "POLICY_DECISION_REQUIRED" },
    ]);
    expect((await prisma.waiverContest.findUniqueOrThrow({ where: { id: contest.id } })).snapshotId).toBe(v1.id);
    await expectDbGuard(
      prisma.waiverContest.update({ where: { id: contest.id }, data: { snapshotId: v2.id } }),
      "WAIVER_LOCKED",
    );

    const own = await getOwnWaiverBoard({ contestId: contest.id, universalProfileId: p.profileId });
    expect(own?.board).toMatchObject({ status: "LOCKED", needsReview: false, affectedCalls: [] });
    const calls = await prisma.waiverCall.count({ where: { revision: { submissionId: sub.submissionId } } });
    expect(calls).toBe(1);
  });
});
