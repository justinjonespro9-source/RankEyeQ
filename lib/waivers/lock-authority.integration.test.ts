import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createWaiverFixture,
  expectDbGuard,
  type FixturePlayer,
  type WaiverFixture,
} from "@/lib/waivers/__fixtures__/competition";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { getOwnWaiverBoard, saveWaiverDraft, submitWaiverBoard, WaiverSubmissionError } from "@/lib/waivers/submissions";

let f: WaiverFixture;
let wr: FixturePlayer[];

async function newContest() {
  const week = await f.addWeek();
  const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: wr.map((player) => ({ player })) });
  const contest = await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "WR" });
  return { contestId: contest.id, snapshotId: snapshot.id };
}

async function expectLocked(promise: Promise<unknown>) {
  let error: unknown = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(WaiverSubmissionError);
  expect((error as WaiverSubmissionError).code).toBe("LOCKED");
}

beforeAll(async () => {
  f = await createWaiverFixture("lock");
  wr = await f.addPlayers("WR", 6);
});

afterAll(async () => {
  await f?.cleanup();
});

describe("the authoritative clock rejects post-lock writes", () => {
  it("rejects edits, drafts and new boards once locksAt passes even while stored status is OPEN", async () => {
    const { contestId } = await newContest();
    const owner = await f.addParticipant("lk_owner");
    const drafter = await f.addParticipant("lk_drafter");
    const late = await f.addParticipant("lk_late");
    const ownerBase = { contestId, universalProfileId: owner.profileId, userId: owner.userId };
    await submitWaiverBoard({ ...ownerBase, playerIds: [wr[0].id] });
    await saveWaiverDraft({ contestId, universalProfileId: drafter.profileId, userId: drafter.userId, playerIds: [wr[1].id] });

    await f.passLock(contestId);
    expect((await prisma.waiverContest.findUniqueOrThrow({ where: { id: contestId } })).status).toBe("OPEN");

    await expectLocked(submitWaiverBoard({ ...ownerBase, playerIds: [wr[2].id] }));
    await expectLocked(submitWaiverBoard({ ...ownerBase, playerIds: [] }));
    await expectLocked(
      saveWaiverDraft({ contestId, universalProfileId: drafter.profileId, userId: drafter.userId, playerIds: [wr[3].id] }),
    );
    await expectLocked(
      submitWaiverBoard({ contestId, universalProfileId: drafter.profileId, userId: drafter.userId, playerIds: [wr[3].id] }),
    );
    await expectLocked(submitWaiverBoard({ contestId, universalProfileId: late.profileId, userId: late.userId, playerIds: [] }));

    expect(await prisma.waiverSubmission.count({ where: { contestId, universalProfileId: late.profileId } })).toBe(0);
    expect(await prisma.waiverSubmissionRevision.count({ where: { submission: { contestId } } })).toBe(2);
  });

  it("the database independently rejects post-lock writes that bypass the service", async () => {
    const { contestId, snapshotId } = await newContest();
    const owner = await f.addParticipant("db_owner");
    const late = await f.addParticipant("db_late");
    const first = await submitWaiverBoard({ contestId, universalProfileId: owner.profileId, userId: owner.userId, playerIds: [wr[0].id] });
    const second = await submitWaiverBoard({ contestId, universalProfileId: owner.profileId, userId: owner.userId, playerIds: [wr[1].id] });
    const revisions = await prisma.waiverSubmissionRevision.findMany({
      where: { submissionId: first.submissionId },
      orderBy: { revisionNumber: "asc" },
    });
    await f.passLock(contestId);

    await expectDbGuard(
      prisma.waiverSubmission.create({
        data: { contestId, universalProfileId: late.profileId, createdByUserId: late.userId, authority: "OWNER_AUTHORED" },
      }),
      "WAIVER_LOCKED",
    );
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({
        data: {
          submissionId: first.submissionId,
          revisionNumber: 3,
          kind: "SUBMISSION",
          snapshotId,
          callCount: 0,
          fingerprint: "late",
          authorUserId: owner.userId,
          createdAt: new Date(),
        },
      }),
      "WAIVER_LOCKED",
    );
    const entry = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId, rankableEntryId: wr[5].id } });
    await expectDbGuard(
      prisma.waiverCall.create({ data: { revisionId: revisions[1].id, slot: 2, snapshotEntryId: entry.id } }),
      "WAIVER_LOCKED",
    );
    // Hindsight: pointing the board back at an earlier revision after lock.
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: first.submissionId }, data: { currentRevisionId: revisions[0].id } }),
      "WAIVER_LOCKED",
    );
    await expectDbGuard(
      prisma.waiverSubmission.update({
        where: { id: first.submissionId },
        data: { status: "LOCKED", lockedRevisionId: revisions[0].id, lockedAt: new Date() },
      }),
      "WAIVER_LOCKED",
    );
    const row = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: first.submissionId } });
    expect(row.currentRevisionId).toBe(revisions[1].id);
    expect(second.revisionNumber).toBe(2);
  });

  it("the contest cannot be marked LOCKED early, nor have its lock time changed", async () => {
    const { contestId } = await newContest();
    await expectDbGuard(prisma.waiverContest.update({ where: { id: contestId }, data: { status: "LOCKED" } }), "WAIVER_INVALID");
    await expectDbGuard(
      prisma.waiverContest.update({ where: { id: contestId }, data: { locksAt: new Date(Date.now() + 86_400_000) } }),
      "WAIVER_IMMUTABLE",
    );
  });
});

describe("lock stamp", () => {
  it("names the final submission before lock, stamps lockedAt = locksAt, leaves drafts, and is idempotent", async () => {
    const { contestId } = await newContest();
    const a = await f.addParticipant("st_a");
    const b = await f.addParticipant("st_b");
    const d = await f.addParticipant("st_d");
    const aBase = { contestId, universalProfileId: a.profileId, userId: a.userId };
    await submitWaiverBoard({ ...aBase, playerIds: [wr[0].id] });
    const aFinal = await submitWaiverBoard({ ...aBase, playerIds: [wr[1].id, wr[2].id] });
    const bAbstain = await submitWaiverBoard({ contestId, universalProfileId: b.profileId, userId: b.userId, playerIds: [] });
    const dDraft = await saveWaiverDraft({ contestId, universalProfileId: d.profileId, userId: d.userId, playerIds: [wr[3].id] });

    expect(await ensureWaiverContestLocked(contestId)).toEqual({ locked: false, stampedSubmissions: 0 });

    const locksAt = await f.passLock(contestId);
    expect(await ensureWaiverContestLocked(contestId)).toEqual({ locked: true, stampedSubmissions: 2 });

    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: contestId } });
    expect(contest.status).toBe("LOCKED");

    const aRow = await prisma.waiverSubmission.findUniqueOrThrow({
      where: { id: aFinal.submissionId },
      include: { lockedRevision: true },
    });
    expect(aRow.status).toBe("LOCKED");
    expect(aRow.lockedRevision?.revisionNumber).toBe(2);
    expect(aRow.lockedRevisionId).toBe(aRow.currentRevisionId);
    expect(aRow.lockedAt?.toISOString()).toBe(locksAt.toISOString());
    expect(aRow.submittedAt?.toISOString()).toBe(aFinal.submittedAt?.toISOString());

    const bRow = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: bAbstain.submissionId }, include: { lockedRevision: true } });
    expect(bRow).toMatchObject({ status: "LOCKED" });
    expect(bRow.lockedRevision?.callCount).toBe(0);

    const dRow = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: dDraft.submissionId } });
    expect(dRow).toMatchObject({ status: "DRAFT", lockedRevisionId: null, lockedAt: null });

    expect(await ensureWaiverContestLocked(contestId)).toEqual({ locked: true, stampedSubmissions: 0 });
    const aAgain = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: aFinal.submissionId } });
    expect(aAgain.lockedAt?.toISOString()).toBe(locksAt.toISOString());

    const own = await getOwnWaiverBoard({ contestId, universalProfileId: d.profileId });
    expect(own?.contest.phase).toBe("LOCKED");
    expect(own?.board).toMatchObject({ status: "DRAFT", competitive: false });
  });

  it("selects by lock instant, not by the latest pointer", async () => {
    const { contestId } = await newContest();
    const p = await f.addParticipant("st_instant");
    const base = { contestId, universalProfileId: p.profileId, userId: p.userId };
    const r1 = await submitWaiverBoard({ ...base, playerIds: [wr[0].id] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const lockInstant = new Date();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await submitWaiverBoard({ ...base, playerIds: [wr[1].id] });

    await f.passLock(contestId, lockInstant);
    await ensureWaiverContestLocked(contestId);
    const row = await prisma.waiverSubmission.findUniqueOrThrow({
      where: { id: r1.submissionId },
      include: { lockedRevision: true, currentRevision: true },
    });
    expect(row.lockedRevision?.revisionNumber).toBe(1);
    expect(row.currentRevision?.revisionNumber).toBe(2);
    expect(row.lockedAt?.toISOString()).toBe(lockInstant.toISOString());
  });

  it("the stamp is fixed once written", async () => {
    const { contestId } = await newContest();
    const p = await f.addParticipant("st_fixed");
    const base = { contestId, universalProfileId: p.profileId, userId: p.userId };
    const r1 = await submitWaiverBoard({ ...base, playerIds: [wr[0].id] });
    await f.passLock(contestId);
    await ensureWaiverContestLocked(contestId);
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: r1.submissionId }, data: { lockedAt: new Date() } }),
      "WAIVER_LOCKED",
    );
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: r1.submissionId }, data: { status: "SUBMITTED" } }),
      "WAIVER_LOCKED",
    );
    await expectDbGuard(prisma.waiverContest.update({ where: { id: contestId }, data: { status: "OPEN" } }), "WAIVER_INVALID");
  });
});
