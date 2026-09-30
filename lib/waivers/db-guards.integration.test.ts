import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createWaiverFixture,
  expectDbGuard,
  withFixtureMaintenance,
  type FixturePlayer,
  type WaiverFixture,
} from "@/lib/waivers/__fixtures__/competition";
import { readWaiverClock } from "@/lib/waivers/clock";
import { WAIVER_EYEQ_V1 } from "@/lib/waivers/constants";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Direct tests of the Phase 2 database backstops (triggers + CHECKs). These
 * writes deliberately bypass the service layer.
 */

let f: WaiverFixture;
let wr: FixturePlayer[];
let qb: FixturePlayer[];
let excludedWr: FixturePlayer;
let weekId: string;
let snapshotId: string;
let otherSnapshotId: string;
let wrContestId: string;
let qbContestId: string;
let owner: { userId: string; profileId: string };
let submissionId: string;
let revisionId: string;
let callId: string;

const entryFor = (player: FixturePlayer, snapshot = snapshotId) =>
  prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId: snapshot, rankableEntryId: player.id } });

async function nextRevisionNumber(id = submissionId) {
  const latest = await prisma.waiverSubmissionRevision.findFirst({ where: { submissionId: id }, orderBy: { revisionNumber: "desc" } });
  return (latest?.revisionNumber ?? 0) + 1;
}

const revisionData = (overrides: Record<string, unknown> = {}) => ({
  submissionId,
  revisionNumber: 99,
  kind: "SUBMISSION" as const,
  snapshotId,
  callCount: 0,
  fingerprint: "direct",
  authorUserId: owner.userId,
  createdAt: new Date(),
  ...overrides,
});

beforeAll(async () => {
  f = await createWaiverFixture("guard");
  wr = await f.addPlayers("WR", 4);
  qb = await f.addPlayers("QB", 4);
  [excludedWr] = await f.addPlayers("WR", 1);
  const week = await f.addWeek();
  weekId = week.weekId;
  const snapshot = await f.freezeSnapshot({
    weekId,
    rows: [...wr.map((player) => ({ player })), ...qb.map((player) => ({ player })), { player: excludedWr, eligibility: "EXCLUDED" }],
  });
  snapshotId = snapshot.id;
  const other = await f.addWeek();
  otherSnapshotId = (await f.freezeSnapshot({ weekId: other.weekId, rows: wr.map((player) => ({ player })) })).id;
  wrContestId = (await f.createContest({ weekId, snapshotId, position: "WR" })).id;
  qbContestId = (await f.createContest({ weekId, snapshotId, position: "QB" })).id;
  owner = await f.addParticipant("g_owner");
  const result = await submitWaiverBoard({
    contestId: wrContestId,
    universalProfileId: owner.profileId,
    userId: owner.userId,
    playerIds: [wr[0].id],
  });
  submissionId = result.submissionId;
  const revision = await prisma.waiverSubmissionRevision.findFirstOrThrow({ where: { submissionId }, include: { calls: true } });
  revisionId = revision.id;
  callId = revision.calls[0].id;
});

afterAll(async () => {
  await f?.cleanup();
});

describe("waiver_utc_now clock", () => {
  it("reads the database clock as a correct UTC instant", async () => {
    const now = await readWaiverClock();
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(5_000);
  });
});

describe("WaiverContest guard", () => {
  const contestData = (overrides: Record<string, unknown> = {}) => ({
    weekId,
    position: "TE" as const,
    snapshotId,
    maxCalls: 3,
    resultFieldSize: 3,
    scoringVersion: WAIVER_EYEQ_V1.slug,
    opensAt: new Date(Date.now() - 3_600_000),
    locksAt: new Date(Date.now() + 3_600_000),
    openedByUserId: f.adminUserId,
    ...overrides,
  });

  it("rejects contests pinned to a non-current snapshot, already locked, or created LOCKED", async () => {
    await expectDbGuard(prisma.waiverContest.create({ data: contestData({ snapshotId: otherSnapshotId }) }), "WAIVER_INVALID");
    await expectDbGuard(
      prisma.waiverContest.create({
        data: contestData({ opensAt: new Date(Date.now() - 7_200_000), locksAt: new Date(Date.now() - 60_000) }),
      }),
      "WAIVER_LOCKED",
    );
    await expectDbGuard(prisma.waiverContest.create({ data: contestData({ status: "LOCKED" }) }), "WAIVER_INVALID");
  });

  it("enforces CHECK constraints on shape and window", async () => {
    await expect(prisma.waiverContest.create({ data: contestData({ maxCalls: 4 }) })).rejects.toThrow();
    await expect(prisma.waiverContest.create({ data: contestData({ resultFieldSize: 2 }) })).rejects.toThrow();
    await expect(
      prisma.waiverContest.create({ data: contestData({ opensAt: new Date(Date.now() + 7_200_000) }) }),
    ).rejects.toThrow();
    expect(await prisma.waiverContest.count({ where: { weekId, position: "TE" } })).toBe(0);
  });

  it("defining fields are immutable and contests cannot be deleted", async () => {
    await expectDbGuard(prisma.waiverContest.update({ where: { id: wrContestId }, data: { maxCalls: 3 } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverContest.update({ where: { id: wrContestId }, data: { position: "TE" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(
      prisma.waiverContest.update({ where: { id: wrContestId }, data: { scoringVersion: "other" } }),
      "WAIVER_IMMUTABLE",
    );
    await expectDbGuard(prisma.waiverContest.delete({ where: { id: wrContestId } }), "WAIVER_IMMUTABLE");
  });
});

describe("WaiverSubmission guard", () => {
  it("new rows must start as an empty DRAFT", async () => {
    const p = await f.addParticipant("g_new");
    await expectDbGuard(
      prisma.waiverSubmission.create({
        data: { contestId: wrContestId, universalProfileId: p.profileId, createdByUserId: p.userId, authority: "OWNER_AUTHORED", status: "SUBMITTED" },
      }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmission.create({
        data: {
          contestId: wrContestId,
          universalProfileId: p.profileId,
          createdByUserId: p.userId,
          authority: "OWNER_AUTHORED",
          currentRevisionId: revisionId,
        },
      }),
      "WAIVER_INVALID",
    );
  });

  it("identity is immutable; rows cannot be deleted", async () => {
    const p = await f.addParticipant("g_ident");
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: submissionId }, data: { universalProfileId: p.profileId } }),
      "WAIVER_IMMUTABLE",
    );
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: submissionId }, data: { createdByUserId: p.userId } }),
      "WAIVER_IMMUTABLE",
    );
    await expectDbGuard(prisma.waiverSubmission.update({ where: { id: submissionId }, data: { contestId: qbContestId } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverSubmission.delete({ where: { id: submissionId } }), "WAIVER_IMMUTABLE");
  });

  it("pre-lock state machine: no early lock, no return to draft, no clearing or rewinding the current revision", async () => {
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: submissionId }, data: { status: "LOCKED", lockedRevisionId: revisionId, lockedAt: new Date() } }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: submissionId }, data: { status: "DRAFT", submittedAt: null } }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(prisma.waiverSubmission.update({ where: { id: submissionId }, data: { currentRevisionId: null } }), "WAIVER_INVALID");
    await expectDbGuard(
      prisma.waiverSubmission.update({ where: { id: submissionId }, data: { submittedAt: new Date(Date.now() - 86_400_000) } }),
      "WAIVER_INVALID",
    );
    const row = await prisma.waiverSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(row).toMatchObject({ status: "SUBMITTED", currentRevisionId: revisionId });
  });
});

describe("WaiverSubmissionRevision guard", () => {
  it("revisions are append-only, even under fixture maintenance", async () => {
    await expectDbGuard(
      prisma.waiverSubmissionRevision.update({ where: { id: revisionId }, data: { fingerprint: "tampered" } }),
      "WAIVER_IMMUTABLE",
    );
    await expectDbGuard(
      withFixtureMaintenance((tx) => tx.waiverSubmissionRevision.update({ where: { id: revisionId }, data: { callCount: 0 } })),
      "WAIVER_IMMUTABLE",
    );
    await expectDbGuard(prisma.waiverSubmissionRevision.delete({ where: { id: revisionId } }), "WAIVER_IMMUTABLE");
  });

  it("rejects wrong snapshot, non-sequential numbers, future or backdated timestamps, and drafts after submission", async () => {
    const next = await nextRevisionNumber();
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({ data: revisionData({ revisionNumber: next, snapshotId: otherSnapshotId }) }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(prisma.waiverSubmissionRevision.create({ data: revisionData({ revisionNumber: next + 1 }) }), "WAIVER_INVALID");
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({ data: revisionData({ revisionNumber: next, createdAt: new Date(Date.now() + 3_600_000) }) }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({ data: revisionData({ revisionNumber: next, createdAt: new Date(Date.now() - 86_400_000) }) }),
      "WAIVER_INVALID",
    );
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({ data: revisionData({ revisionNumber: next, kind: "DRAFT" }) }),
      "WAIVER_INVALID",
    );
    expect(await nextRevisionNumber()).toBe(next);
  });

  it("deferred shape check: stored callCount must equal contiguous calls", async () => {
    const next = await nextRevisionNumber();
    await expectDbGuard(
      prisma.waiverSubmissionRevision.create({ data: revisionData({ revisionNumber: next, callCount: 1 }) }),
      "WAIVER_INVALID",
    );
    const [e0, e2] = [await entryFor(wr[0]), await entryFor(wr[2])];
    await expectDbGuard(
      prisma.$transaction(async (tx) => {
        const revision = await tx.waiverSubmissionRevision.create({ data: revisionData({ revisionNumber: next, callCount: 2 }) });
        await tx.waiverCall.createMany({
          data: [
            { revisionId: revision.id, slot: 1, snapshotEntryId: e0.id },
            { revisionId: revision.id, slot: 3, snapshotEntryId: e2.id },
          ],
        });
      }),
      "WAIVER_INVALID",
    );
    expect(await nextRevisionNumber()).toBe(next);
  });
});

describe("WaiverCall guard", () => {
  it("calls are append-only", async () => {
    await expectDbGuard(prisma.waiverCall.update({ where: { id: callId }, data: { slot: 2 } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverCall.delete({ where: { id: callId } }), "WAIVER_IMMUTABLE");
  });

  it("rejects ineligible, wrong-position and over-max calls", async () => {
    const next = await nextRevisionNumber();
    const excluded = await entryFor(excludedWr);
    const qbEntry = await entryFor(qb[0]);
    for (const snapshotEntryId of [excluded.id, qbEntry.id]) {
      await expectDbGuard(
        prisma.$transaction(async (tx) => {
          const revision = await tx.waiverSubmissionRevision.create({ data: revisionData({ revisionNumber: next, callCount: 1 }) });
          await tx.waiverCall.create({ data: { revisionId: revision.id, slot: 1, snapshotEntryId } });
        }),
        "WAIVER_INVALID",
      );
    }

    const p = await f.addParticipant("g_qb");
    const qbSub = await submitWaiverBoard({ contestId: qbContestId, universalProfileId: p.profileId, userId: p.userId, playerIds: [] });
    const qbEntries = await Promise.all(qb.map((player) => entryFor(player)));
    await expectDbGuard(
      prisma.$transaction(async (tx) => {
        const revision = await tx.waiverSubmissionRevision.create({
          data: revisionData({ submissionId: qbSub.submissionId, revisionNumber: 2, callCount: 4, authorUserId: p.userId }),
        });
        await tx.waiverCall.createMany({
          data: qbEntries.map((entry, i) => ({ revisionId: revision.id, slot: i + 1, snapshotEntryId: entry.id })),
        });
      }),
      "WAIVER_INVALID",
    );
    expect(await nextRevisionNumber(qbSub.submissionId)).toBe(2);
  });
});

describe("fixture-maintenance switch", () => {
  it("only relaxes deletes/updates inside the transaction that sets it", async () => {
    const before = await prisma.waiverCall.count({ where: { id: callId } });
    await expect(
      withFixtureMaintenance(async (tx) => {
        await tx.waiverCall.delete({ where: { id: callId } });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await prisma.waiverCall.count({ where: { id: callId } })).toBe(before);
    await expectDbGuard(prisma.waiverCall.delete({ where: { id: callId } }), "WAIVER_IMMUTABLE");
  });
});
