import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  createWaiverFixture,
  expectDbGuard,
  MAINTENANCE_SQL,
  type FixturePlayer,
  type WaiverFixture,
} from "@/lib/waivers/__fixtures__/competition";

let f: WaiverFixture;
let weekId: string;
let otherWeekId: string;
let players: FixturePlayer[];
let v1: { id: string };

const entry = (snapshotId: string, player: FixturePlayer, line: number, extra: Partial<Prisma.WaiverSnapshotEntryUncheckedCreateInput> = {}) =>
  ({
    snapshotId,
    rankableEntryId: player.id,
    evidenceRole: "CANDIDATE",
    position: player.position,
    displayNameAtFreeze: player.name,
    teamAtFreeze: "SF",
    rosteredBps: 1200,
    sourceLabel: "Sleeper",
    observedAt: new Date(Date.now() - 60_000),
    inputLineNumber: line,
    inputLine: `${player.name} | WR | SF | 12`,
    matchMethod: "EXACT_NAME_TEAM",
    eligibility: "ELIGIBLE",
    isByeAtFreeze: false,
    hardUnavailableAtFreeze: false,
    ...extra,
  }) satisfies Prisma.WaiverSnapshotEntryUncheckedCreateInput;

const header = (week: string, version: number, extra: Partial<Prisma.WaiverSnapshotUncheckedCreateInput> = {}) =>
  ({
    seasonId: f.seasonId,
    weekId: week,
    version,
    currentForWeekId: week,
    sourceLabel: "Sleeper",
    observedAt: new Date(Date.now() - 60_000),
    frozenAt: new Date(),
    frozenByUserId: f.adminUserId,
    rawInputSha256: `raw-${version}`,
    entriesFingerprint: `fp-${version}`,
    candidateCount: 0,
    eligibleCount: 0,
    excludedCount: 0,
    followUpCount: 0,
    ...extra,
  }) satisfies Prisma.WaiverSnapshotUncheckedCreateInput;

async function expectCheck(promise: Promise<unknown>, constraint: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${constraint} violation`).not.toBeNull();
  expect(String(error instanceof Error ? error.message : error)).toContain(constraint);
}

beforeAll(async () => {
  f = await createWaiverFixture("integ");
  ({ weekId } = await f.addWeek());
  ({ weekId: otherWeekId } = await f.addWeek());
  players = await f.addPlayers("WR", 4);
  v1 = await f.freezeSnapshot({ weekId, rows: [{ player: players[0] }, { player: players[1], eligibility: "EXCLUDED" }] });
});

afterAll(async () => {
  await f?.cleanup();
});

describe("snapshot entries and corrections are immutable", () => {
  it("rejects any entry UPDATE and a plain DELETE", async () => {
    const row = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId: v1.id } });
    await expectDbGuard(prisma.waiverSnapshotEntry.update({ where: { id: row.id }, data: { rosteredBps: 1300 } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverSnapshotEntry.delete({ where: { id: row.id } }), "WAIVER_IMMUTABLE");
  });

  it("allows DELETE only under fixture maintenance", async () => {
    const row = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId: v1.id } });
    const rolledBack = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(MAINTENANCE_SQL);
      await tx.waiverSnapshotEntry.delete({ where: { id: row.id } });
      throw new Error("rollback");
    });
    await expect(rolledBack).rejects.toThrow("rollback");
    expect(await prisma.waiverSnapshotEntry.count({ where: { id: row.id } })).toBe(1);
  });

  it("cannot append evidence to a committed snapshot (commit-time count check)", async () => {
    await expectDbGuard(prisma.waiverSnapshotEntry.create({ data: entry(v1.id, players[2], 9) }), "WAIVER_INVALID");
    expect(await prisma.waiverSnapshotEntry.count({ where: { snapshotId: v1.id } })).toBe(2);
  });

  it("rejects a header whose counts do not match its entries", async () => {
    const tx = prisma.$transaction(async (t) => {
      const h = await t.waiverSnapshot.create({ data: header(otherWeekId, 1, { candidateCount: 2, eligibleCount: 2 }) });
      await t.waiverSnapshotEntry.create({ data: entry(h.id, players[0], 1) });
    });
    await expectDbGuard(tx, "WAIVER_INVALID");
    expect(await prisma.waiverSnapshot.count({ where: { weekId: otherWeekId } })).toBe(0);
  });
});

describe("snapshot header transitions", () => {
  it("rejects changing any evidence column, reverting, or superseding without clearing current", async () => {
    await expectDbGuard(prisma.waiverSnapshot.update({ where: { id: v1.id }, data: { sourceLabel: "Other" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverSnapshot.update({ where: { id: v1.id }, data: { status: "SUPERSEDED" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(
      prisma.waiverSnapshot.update({ where: { id: v1.id }, data: { status: "SUPERSEDED", currentForWeekId: null, eligibleCount: 9 } }),
      "WAIVER_IMMUTABLE",
    );
    await expectDbGuard(prisma.waiverSnapshot.delete({ where: { id: v1.id } }), "WAIVER_IMMUTABLE");
  });

  it("a superseded version must have its successor by commit", async () => {
    await expectDbGuard(
      prisma.waiverSnapshot.update({ where: { id: v1.id }, data: { status: "SUPERSEDED", currentForWeekId: null } }),
      "WAIVER_INVALID",
    );
    expect((await prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("FROZEN");
  });

  it("new headers are FROZEN and current; v1 supersedes nothing; v(n+1) directly supersedes v(n) of the same week", async () => {
    await expectDbGuard(prisma.waiverSnapshot.create({ data: header(otherWeekId, 2) }), "WAIVER_INVALID");
    await expectDbGuard(prisma.waiverSnapshot.create({ data: header(otherWeekId, 1, { currentForWeekId: null }) }), "WAIVER_INVALID");
    const crossWeek = prisma.$transaction(async (t) => {
      await t.waiverSnapshot.update({ where: { id: v1.id }, data: { status: "SUPERSEDED", currentForWeekId: null } });
      await t.waiverSnapshot.create({ data: header(otherWeekId, 2, { supersedesId: v1.id }) });
    });
    await expectDbGuard(crossWeek, "WAIVER_INVALID");
    const skipped = prisma.$transaction(async (t) => {
      await t.waiverSnapshot.update({ where: { id: v1.id }, data: { status: "SUPERSEDED", currentForWeekId: null } });
      await t.waiverSnapshot.create({ data: header(weekId, 3, { supersedesId: v1.id }) });
    });
    await expectDbGuard(skipped, "WAIVER_INVALID");
    const stillCurrent = prisma.$transaction(async (t) => {
      await t.waiverSnapshot.create({ data: header(weekId, 2, { supersedesId: v1.id, currentForWeekId: null }) });
    });
    await expectDbGuard(stillCurrent, "WAIVER_INVALID");
  });

  it("entries go only into FROZEN headers; corrections only onto the current direct successor", async () => {
    const v2 = await f.freezeSnapshot({ weekId, supersedesId: v1.id, rows: [{ player: players[0] }] });
    await expectDbGuard(prisma.waiverSnapshotEntry.create({ data: entry(v1.id, players[3], 7) }), "WAIVER_IMMUTABLE");
    const correction = {
      toSnapshotId: v2.id,
      rankableEntryId: players[1].id,
      field: "REMOVE",
      originalValue: {},
      correctedValue: {},
      reason: "test",
      correctionCase: "PRE_SUBMISSION" as const,
      policy: "NO_BOARD_EFFECT" as const,
      operatorUserId: f.adminUserId,
    };
    await expectDbGuard(prisma.waiverSnapshotCorrection.create({ data: { ...correction, fromSnapshotId: v2.id } }), "WAIVER_INVALID");
    const recorded = await prisma.waiverSnapshotCorrection.create({ data: { ...correction, fromSnapshotId: v1.id } });
    await expectDbGuard(prisma.waiverSnapshotCorrection.update({ where: { id: recorded.id }, data: { reason: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverSnapshotCorrection.delete({ where: { id: recorded.id } }), "WAIVER_IMMUTABLE");
  });
});

describe("CHECK constraints", () => {
  const inTx = (week: string, counts: Partial<Prisma.WaiverSnapshotUncheckedCreateInput>, rows: (id: string) => Prisma.WaiverSnapshotEntryUncheckedCreateInput[]) =>
    prisma.$transaction(async (t) => {
      const h = await t.waiverSnapshot.create({ data: header(week, 1, counts) });
      for (const row of rows(h.id)) await t.waiverSnapshotEntry.create({ data: row });
    });

  it("rejects out-of-range basis points, threshold and line numbers", async () => {
    const one = { candidateCount: 1, eligibleCount: 1 };
    await expectCheck(inTx(otherWeekId, one, (id) => [entry(id, players[0], 1, { rosteredBps: 10_001 })]), "WaiverSnapshotEntry_rosteredBps_check");
    await expectCheck(inTx(otherWeekId, one, (id) => [entry(id, players[0], 1, { rosteredBps: -1 })]), "WaiverSnapshotEntry_rosteredBps_check");
    await expectCheck(inTx(otherWeekId, one, (id) => [entry(id, players[0], 0)]), "WaiverSnapshotEntry_inputLineNumber_check");
    await expectCheck(inTx(otherWeekId, { thresholdBps: 0 }, () => []), "WaiverSnapshot_thresholdBps_check");
    await expectCheck(inTx(otherWeekId, { candidateCount: 1, eligibleCount: 0, excludedCount: 0 }, () => []), "WaiverSnapshot_counts_check");
  });

  it("ties FOLLOW_UP to OBSERVATION_ONLY and EXCLUDED to an exclusion reason", async () => {
    await expectCheck(
      inTx(otherWeekId, { followUpCount: 1 }, (id) => [entry(id, players[0], 1, { evidenceRole: "FOLLOW_UP" })]),
      "WaiverSnapshotEntry_role_check",
    );
    await expectCheck(
      inTx(otherWeekId, { candidateCount: 1, eligibleCount: 1 }, (id) => [entry(id, players[0], 1, { eligibility: "OBSERVATION_ONLY" })]),
      "WaiverSnapshotEntry_role_check",
    );
    await expectCheck(
      inTx(otherWeekId, { candidateCount: 1, excludedCount: 1 }, (id) => [entry(id, players[0], 1, { eligibility: "EXCLUDED" })]),
      "WaiverSnapshotEntry_exclusion_check",
    );
    await expectCheck(
      inTx(otherWeekId, { candidateCount: 1, eligibleCount: 1 }, (id) => [entry(id, players[0], 1, { exclusionReason: "BYE" })]),
      "WaiverSnapshotEntry_exclusion_check",
    );
  });
});
