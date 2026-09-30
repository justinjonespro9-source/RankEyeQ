import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { withFixtureMaintenance } from "@/lib/waivers/__fixtures__/competition";

const suffix = `wsnap${Date.now().toString(36)}`;
const seasonYear = 3800 + (Date.now() % 90);

function entryData(snapshotId: string, rankableEntryId: string, line: number) {
  return {
    snapshotId,
    rankableEntryId,
    evidenceRole: "CANDIDATE" as const,
    position: "WR" as const,
    displayNameAtFreeze: `Player ${line}`,
    teamAtFreeze: "SF",
    rosteredBps: 1234,
    sourceLabel: "Sleeper",
    observedAt: new Date("2026-09-29T15:00:00.000Z"),
    inputLineNumber: line,
    inputLine: `Player ${line}, SF, WR, 12.34%`,
    matchMethod: "EXACT_NAME_TEAM" as const,
    eligibility: "ELIGIBLE" as const,
    isByeAtFreeze: false,
    hardUnavailableAtFreeze: false,
  };
}

function snapshotData(version: number, extra: Record<string, unknown> = {}) {
  return {
    seasonId,
    weekId,
    version,
    sourceLabel: "Sleeper",
    observedAt: new Date("2026-09-29T15:00:00.000Z"),
    frozenByUserId: userId,
    rawInputSha256: `sha-${suffix}-${version}`,
    entriesFingerprint: `fp-${suffix}-${version}`,
    candidateCount: 2,
    eligibleCount: 2,
    excludedCount: 0,
    followUpCount: 0,
    ...extra,
  };
}

let seasonId = "";
let weekId = "";
let userId = "";
let gameId = "";
let playerAId = "";
let playerBId = "";
let v1Id = "";
let v2Id = "";

async function expectRejected(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow();
}

describe("Waiver snapshot schema (local DB)", () => {
  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: seasonYear, sport: `WAIVERS-${suffix}`, active: false },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 4,
        label: "W4",
        startsAt: new Date("2026-09-29T05:00:00.000Z"),
        endsAt: new Date("2026-10-06T05:00:00.000Z"),
        status: "OPEN",
        isTest: true,
      },
    });
    weekId = week.id;
    const user = await prisma.user.create({ data: { email: `waivers-${suffix}@example.test` } });
    userId = user.id;
    const game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `waivers-${suffix}`,
        seasonId,
        weekId,
        seasonYear,
        weekNumber: 4,
        homeTeam: "SF",
        awayTeam: "SEA",
        startsAt: new Date("2026-10-04T20:25:00.000Z"),
      },
    });
    gameId = game.id;
    const [a, b] = await Promise.all(
      ["a", "b"].map((k) =>
        prisma.rankableEntry.create({
          data: {
            externalId: `waivers-${suffix}-${k}`,
            type: "PLAYER",
            name: `Waiver Test ${k}`,
            shortName: `W. ${k}`,
            team: "SF",
            position: "WR",
          },
        }),
      ),
    );
    playerAId = a.id;
    playerBId = b.id;
  });

  afterAll(async () => {
    await withFixtureMaintenance(async (tx) => {
      await tx.waiverSnapshotCorrection.deleteMany({ where: { operatorUserId: userId } });
      const snapshots = await tx.waiverSnapshot.findMany({
        where: { weekId },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      await tx.waiverSnapshotEntry.deleteMany({ where: { snapshotId: { in: snapshots.map((s) => s.id) } } });
      for (const s of snapshots) await tx.waiverSnapshot.delete({ where: { id: s.id } });
    });
    await prisma.nflGame.deleteMany({ where: { id: gameId } });
    await prisma.rankableEntry.deleteMany({ where: { id: { in: [playerAId, playerBId] } } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("freezes a v1 snapshot with entries and defaults", async () => {
    const v1 = await prisma.$transaction(async (tx) => {
      const header = await tx.waiverSnapshot.create({ data: snapshotData(1, { currentForWeekId: weekId }) });
      await tx.waiverSnapshotEntry.create({
        data: { ...entryData(header.id, playerAId, 1), nflGameId: gameId, opponentAtFreeze: "SEA" },
      });
      await tx.waiverSnapshotEntry.create({ data: entryData(header.id, playerBId, 2) });
      return header;
    });
    v1Id = v1.id;
    expect(v1.status).toBe("FROZEN");
    expect(v1.thresholdBps).toBe(5000);
    expect(await prisma.waiverSnapshotEntry.count({ where: { snapshotId: v1Id } })).toBe(2);
  });

  it("rejects a duplicate player within one snapshot", async () => {
    await expectRejected(prisma.waiverSnapshotEntry.create({ data: entryData(v1Id, playerAId, 3) }));
  });

  it("rejects a duplicate (weekId, version)", async () => {
    await expectRejected(prisma.waiverSnapshot.create({ data: snapshotData(1, { rawInputSha256: "dup" }) }));
  });

  it("allows only one current snapshot per week", async () => {
    await expectRejected(prisma.waiverSnapshot.create({ data: snapshotData(2, { currentForWeekId: weekId }) }));
  });

  it("supersedes v1 with v2 and records an auditable correction", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.waiverSnapshot.update({
        where: { id: v1Id },
        data: { status: "SUPERSEDED", currentForWeekId: null },
      });
      const v2 = await tx.waiverSnapshot.create({
        data: snapshotData(2, {
          currentForWeekId: weekId,
          supersedesId: v1Id,
          correctionCase: "PRE_SUBMISSION",
          correctionReason: "Ownership typo on line 2",
        }),
      });
      v2Id = v2.id;
      await tx.waiverSnapshotEntry.create({ data: entryData(v2Id, playerAId, 1) });
      await tx.waiverSnapshotEntry.create({ data: { ...entryData(v2Id, playerBId, 2), rosteredBps: 4321 } });
      await tx.waiverSnapshotCorrection.create({
        data: {
          fromSnapshotId: v1Id,
          toSnapshotId: v2Id,
          rankableEntryId: playerBId,
          field: "rosteredBps",
          originalValue: 1234,
          correctedValue: 4321,
          reason: "Ownership typo on line 2",
          correctionCase: "PRE_SUBMISSION",
          policy: "NO_BOARD_EFFECT",
          operatorUserId: userId,
        },
      });
    });
    const original = await prisma.waiverSnapshotEntry.findUnique({
      where: { snapshotId_rankableEntryId: { snapshotId: v1Id, rankableEntryId: playerBId } },
    });
    expect(original?.rosteredBps).toBe(1234);
    const current = await prisma.waiverSnapshot.findUnique({ where: { currentForWeekId: weekId } });
    expect(current?.id).toBe(v2Id);
  });

  it("allows a snapshot to be superseded only once", async () => {
    await expectRejected(prisma.waiverSnapshot.create({ data: snapshotData(3, { supersedesId: v1Id }) }));
  });

  describe("delete protection (onDelete: Restrict)", () => {
    it("blocks deleting a snapshot that has entries", async () => {
      await expectRejected(prisma.waiverSnapshot.delete({ where: { id: v2Id } }));
      expect(await prisma.waiverSnapshot.count({ where: { id: v2Id } })).toBe(1);
    });

    it("blocks deleting a superseded snapshot referenced by its successor and corrections", async () => {
      await expectRejected(prisma.waiverSnapshot.delete({ where: { id: v1Id } }));
      expect(await prisma.waiverSnapshot.count({ where: { id: v1Id } })).toBe(1);
    });

    it("blocks deleting the Week", async () => {
      await expectRejected(prisma.week.delete({ where: { id: weekId } }));
      expect(await prisma.week.count({ where: { id: weekId } })).toBe(1);
    });

    it("blocks deleting the Season (Week cascade cannot reach frozen evidence)", async () => {
      await expectRejected(prisma.season.delete({ where: { id: seasonId } }));
      expect(await prisma.season.count({ where: { id: seasonId } })).toBe(1);
      expect(await prisma.waiverSnapshotEntry.count({ where: { snapshotId: { in: [v1Id, v2Id] } } })).toBe(4);
    });

    it("blocks deleting a RankableEntry referenced by evidence", async () => {
      await expectRejected(prisma.rankableEntry.delete({ where: { id: playerAId } }));
      expect(await prisma.rankableEntry.count({ where: { id: playerAId } })).toBe(1);
    });

    it("blocks deleting the NflGame referenced by evidence", async () => {
      await expectRejected(prisma.nflGame.delete({ where: { id: gameId } }));
      expect(await prisma.nflGame.count({ where: { id: gameId } })).toBe(1);
    });

    it("blocks deleting the freezing/operator User", async () => {
      await expectRejected(prisma.user.delete({ where: { id: userId } }));
      expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
    });
  });
});
