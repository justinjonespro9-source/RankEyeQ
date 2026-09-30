import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Permanent regression for the authoritative Waivers clock. Every module in
 * this file (services, triggers via the same connections, fixtures) runs on a
 * Prisma client whose database sessions are pinned to Pacific/Kiritimati
 * (UTC+14), so lock semantics are proven independent of session time zone.
 */
const { SESSION_TZ } = vi.hoisted(() => ({ SESSION_TZ: "Pacific/Kiritimati" }));

vi.mock("@/lib/db", async () => {
  const { Pool } = await import("pg");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/lib/generated/prisma/client");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c TimeZone=${SESSION_TZ}` });
  return { prisma: new PrismaClient({ adapter: new PrismaPg(pool) }) };
});

import { prisma } from "@/lib/db";
import { createWaiverFixture, expectDbGuard, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { readWaiverClock } from "@/lib/waivers/clock";
import { submitWaiverBoard, WaiverSubmissionError } from "@/lib/waivers/submissions";

let f: WaiverFixture;
let wr: FixturePlayer[];

beforeAll(async () => {
  f = await createWaiverFixture("tz");
  wr = await f.addPlayers("WR", 3);
});

afterAll(async () => {
  await f?.cleanup();
});

describe("waiver_utc_now() is session-time-zone independent", () => {
  it("the test client really runs non-UTC sessions", async () => {
    const rows = await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW TIME ZONE`;
    expect(rows[0].TimeZone).toBe(SESSION_TZ);
  });

  it.each(["UTC", "America/Chicago", "Pacific/Kiritimati"])("returns the same UTC instant under %s", async (tz) => {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${tz}'`);
      const now = await readWaiverClock(tx);
      const [{ skew }] = await tx.$queryRaw<Array<{ skew: number }>>`
        SELECT abs(extract(epoch FROM ("waiver_utc_now"() - (clock_timestamp() AT TIME ZONE 'UTC'))))::float8 AS skew`;
      return { now, skew };
    });
    expect(Math.abs(result.now.getTime() - Date.now())).toBeLessThan(5_000);
    expect(result.skew).toBeLessThan(1);
  });

  it("all three session zones agree with each other", async () => {
    const reads: number[] = [];
    for (const tz of ["UTC", "America/Chicago", "Pacific/Kiritimati"]) {
      reads.push(
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${tz}'`);
          return (await readWaiverClock(tx)).getTime();
        }),
      );
    }
    expect(Math.max(...reads) - Math.min(...reads)).toBeLessThan(2_000);
  });
});

describe("service and trigger enforcement agree at the lock boundary under a non-UTC session", () => {
  it("both accept just before locksAt and both reject just after", async () => {
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: wr.map((player) => ({ player })) });
    const contest = await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "WR" });
    const viaService = await f.addParticipant("tz_service");
    const viaTrigger = await f.addParticipant("tz_trigger");
    const lateService = await f.addParticipant("tz_late_service");
    const lateTrigger = await f.addParticipant("tz_late_trigger");

    const locksAt = new Date(Date.now() + 3_000);
    await f.moveLock(contest.id, locksAt);

    await expect(
      submitWaiverBoard({ contestId: contest.id, universalProfileId: viaService.profileId, userId: viaService.userId, playerIds: [wr[0].id] }),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    await expect(
      prisma.waiverSubmission.create({
        data: { contestId: contest.id, universalProfileId: viaTrigger.profileId, createdByUserId: viaTrigger.userId, authority: "OWNER_AUTHORED" },
      }),
    ).resolves.toMatchObject({ status: "DRAFT" });
    expect(Date.now(), "pre-boundary writes must finish before locksAt").toBeLessThan(locksAt.getTime());

    await new Promise((resolve) => setTimeout(resolve, locksAt.getTime() - Date.now() + 50));

    let serviceError: unknown = null;
    try {
      await submitWaiverBoard({ contestId: contest.id, universalProfileId: lateService.profileId, userId: lateService.userId, playerIds: [] });
    } catch (error) {
      serviceError = error;
    }
    expect(serviceError).toBeInstanceOf(WaiverSubmissionError);
    expect((serviceError as WaiverSubmissionError).code).toBe("LOCKED");
    await expectDbGuard(
      prisma.waiverSubmission.create({
        data: { contestId: contest.id, universalProfileId: lateTrigger.profileId, createdByUserId: lateTrigger.userId, authority: "OWNER_AUTHORED" },
      }),
      "WAIVER_LOCKED",
    );
    expect((await prisma.waiverContest.findUniqueOrThrow({ where: { id: contest.id } })).status).toBe("OPEN");
  });
});
