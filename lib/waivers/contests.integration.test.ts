import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, futureFirstKickoff, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { WAIVER_EYEQ_V1 } from "@/lib/waivers/constants";
import { openWaiverContestsForWeek, WaiverContestError } from "@/lib/waivers/contests";
import { computeWaiverLocksAt } from "@/lib/waivers/lock-time";

let f: WaiverFixture;
let players: Record<"QB" | "RB" | "WR" | "TE" | "DEF", FixturePlayer[]>;

async function expectContestError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(WaiverContestError);
  await promise.catch((error: WaiverContestError) => expect(error.code).toBe(code));
}

beforeAll(async () => {
  f = await createWaiverFixture("open");
  players = {
    QB: await f.addPlayers("QB", 4),
    RB: await f.addPlayers("RB", 4),
    WR: await f.addPlayers("WR", 6),
    TE: await f.addPlayers("TE", 2),
    DEF: await f.addPlayers("DEF", 2),
  };
});

afterAll(async () => {
  await f?.cleanup();
});

function standardRows() {
  return [
    ...players.QB.map((player) => ({ player })),
    ...players.RB.map((player) => ({ player })),
    ...players.WR.map((player) => ({ player })),
    { player: players.TE[0], eligibility: "EXCLUDED" as const },
    { player: players.TE[1], evidenceRole: "FOLLOW_UP" as const },
    ...players.DEF.map((player) => ({ player })),
  ];
}

describe("openWaiverContestsForWeek", () => {
  it("opens one contest per position pinned to the current snapshot, locking Tuesday 7 PM CT", async () => {
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: standardRows() });
    const before = Date.now();
    const result = await openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: week.weekId, snapshotId: snapshot.id });

    const expectedLock = computeWaiverLocksAt(week.firstKickoff!);
    expect(result.locksAt.toISOString()).toBe(expectedLock.toISOString());
    expect(result.opened.map((o) => o.position).sort()).toEqual(["DEF", "QB", "RB", "WR"]);
    expect(result.refused).toEqual([{ position: "TE", reason: "EMPTY_ELIGIBLE_POOL" }]);
    expect(result.opened.find((o) => o.position === "DEF")?.availableSlots).toBe(2);
    expect(result.opened.find((o) => o.position === "WR")?.availableSlots).toBe(5);

    const contests = await prisma.waiverContest.findMany({ where: { weekId: week.weekId } });
    expect(contests).toHaveLength(4);
    for (const contest of contests) {
      expect(contest.snapshotId).toBe(snapshot.id);
      expect(contest.status).toBe("OPEN");
      expect(contest.locksAt.toISOString()).toBe(expectedLock.toISOString());
      expect(contest.scoringVersion).toBe(WAIVER_EYEQ_V1.slug);
      expect(contest.maxCalls).toBe(contest.position === "WR" ? 5 : 3);
      expect(contest.resultFieldSize).toBe(contest.position === "WR" ? 5 : 3);
      expect(contest.openedByUserId).toBe(f.adminUserId);
      expect(Math.abs(contest.opensAt.getTime() - before)).toBeLessThan(10_000);
    }
    expect(contests.some((c) => c.position === "TE")).toBe(false);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { adminUserId: f.adminUserId, action: "waivers.contests_opened", entityId: week.weekId },
    });
    expect(audit?.metadata).toMatchObject({ snapshotId: snapshot.id, locksAt: expectedLock.toISOString() });

    const again = await openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: week.weekId, snapshotId: snapshot.id });
    expect(again.opened).toEqual([]);
    expect(again.existing.map((e) => e.position).sort()).toEqual(["DEF", "QB", "RB", "WR"]);
    expect(await prisma.waiverContest.count({ where: { weekId: week.weekId } })).toBe(4);

    await expect(
      f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "QB" }),
    ).rejects.toThrow();
  });

  it("refuses a superseded snapshot and a snapshot from another week", async () => {
    const week = await f.addWeek();
    const v1 = await f.freezeSnapshot({ weekId: week.weekId, rows: standardRows() });
    const v2 = await f.freezeSnapshot({ weekId: week.weekId, rows: standardRows(), supersedesId: v1.id });
    await expectContestError(
      openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: week.weekId, snapshotId: v1.id }),
      "SNAPSHOT_NOT_CURRENT",
    );
    const other = await f.addWeek();
    await expectContestError(
      openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: other.weekId, snapshotId: v2.id }),
      "NOT_FOUND",
    );
    expect(await prisma.waiverContest.count({ where: { weekId: { in: [week.weekId, other.weekId] } } })).toBe(0);
  });

  it("refuses when Tuesday 7 PM CT is not before the first kickoff (no override)", async () => {
    const tuesdayLock = computeWaiverLocksAt(futureFirstKickoff(10));
    for (const kickoff of [new Date(tuesdayLock.getTime() - 7 * 3_600_000), tuesdayLock]) {
      const week = await f.addWeek({ firstKickoff: kickoff });
      const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: standardRows() });
      await expectContestError(
        openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: week.weekId, snapshotId: snapshot.id }),
        "LOCK_NOT_BEFORE_FIRST_KICKOFF",
      );
      expect(await prisma.waiverContest.count({ where: { weekId: week.weekId } })).toBe(0);
    }
  });

  it("refuses a week without a schedule", async () => {
    const week = await f.addWeek({ firstKickoff: null });
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: standardRows() });
    await expectContestError(
      openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: week.weekId, snapshotId: snapshot.id }),
      "NO_SCHEDULE",
    );
  });

  it("refuses when the computed lock has already passed", async () => {
    const week = await f.addWeek({ firstKickoff: new Date(Date.now() + 3_600_000) });
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: standardRows() });
    const promise = openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: week.weekId, snapshotId: snapshot.id });
    await expect(promise).rejects.toBeInstanceOf(WaiverContestError);
    await promise.catch((error: WaiverContestError) =>
      expect(["WINDOW_ORDER", "LOCK_NOT_BEFORE_FIRST_KICKOFF"]).toContain(error.code),
    );
    expect(await prisma.waiverContest.count({ where: { weekId: week.weekId } })).toBe(0);
  });

  it("requires an admin user", async () => {
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: standardRows() });
    const member = await f.addParticipant("notadmin");
    await expectContestError(
      openWaiverContestsForWeek({ adminUserId: member.userId, weekId: week.weekId, snapshotId: snapshot.id }),
      "FORBIDDEN",
    );
    expect(await prisma.waiverContest.count({ where: { weekId: week.weekId } })).toBe(0);
  });
});
