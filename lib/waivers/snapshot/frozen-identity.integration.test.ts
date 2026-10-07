import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createWaiverFixture, expectDbGuard, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { buildWaiverCanonicalPreflight } from "@/lib/waivers/canonical/preflight";
import { applyWaiverCorrection, previewWaiverCorrection } from "@/lib/waivers/snapshot/correct";
import type { WaiverCorrectionOp } from "@/lib/waivers/snapshot/correct-model";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";
import { freezeWaiverSnapshot } from "@/lib/waivers/snapshot/freeze";
import { previewWaiverSnapshot } from "@/lib/waivers/snapshot/preview";

let f: WaiverFixture;
type RosterPlayer = FixturePlayer & { team: string };
const line = (player: RosterPlayer, pct: string) => `${player.name} | ${player.position} | ${player.team} | ${pct}`;
const DISABLE_ENTRY_GUARD = 'ALTER TABLE "WaiverSnapshotEntry" DISABLE TRIGGER "WaiverSnapshotEntry_guard"';
const ENABLE_ENTRY_GUARD = 'ALTER TABLE "WaiverSnapshotEntry" ENABLE TRIGGER "WaiverSnapshotEntry_guard"';

async function freezeWeek(players: RosterPlayer[]) {
  const { weekId } = await f.addWeek();
  const base = {
    weekId,
    rawText: players.map((player) => line(player, "10")).join("\n"),
    sourceLabel: "Sleeper",
    sourceUrl: "https://sleeper.example/players",
    observedAt: new Date(Date.now() - 20 * 60_000),
  };
  const preview = await previewWaiverSnapshot(base);
  expect(preview.blockers).toEqual([]);
  const result = await freezeWaiverSnapshot({
    ...base,
    adminUserId: f.adminUserId,
    previewFingerprint: preview.previewFingerprint,
    acknowledged: preview.requiredAcknowledgments,
    followUpAcks: preview.missingFollowUps.map((player) => ({ rankableEntryId: player.rankableEntryId, reason: "UNABLE_TO_VERIFY" as const, note: null })),
  });
  return { weekId, snapshotId: result.snapshotId };
}

async function correct(snapshotId: string, ops: WaiverCorrectionOp[]) {
  const request = { snapshotId, reason: "Operator correction", ops };
  const preview = await previewWaiverCorrection(request);
  expect(preview.blockers).toEqual([]);
  return applyWaiverCorrection({ ...request, adminUserId: f.adminUserId, correctionFingerprint: preview.correctionFingerprint, acknowledged: preview.requiredAcknowledgments });
}

const identityOf = (rankableEntryId: string) =>
  prisma.rankableEntry.findUniqueOrThrow({ where: { id: rankableEntryId }, select: { provider: true, externalId: true } });
const entriesOf = (snapshotId: string) => prisma.waiverSnapshotEntry.findMany({ where: { snapshotId }, orderBy: { rankableEntryId: "asc" } });

/** Rewrites service-frozen rows into pre-Stage-4B.1 rows (identity never recorded). Local test DB only. */
async function makeLegacy(snapshotId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(DISABLE_ENTRY_GUARD);
    await tx.$executeRaw`UPDATE "WaiverSnapshotEntry" SET "identityProviderAtFreeze" = NULL, "identityExternalIdAtFreeze" = NULL WHERE "snapshotId" = ${snapshotId}`;
    await tx.$executeRawUnsafe(ENABLE_ENTRY_GUARD);
  });
}

async function insertOne(player: RosterPlayer, identity: Partial<Prisma.WaiverSnapshotEntryUncheckedCreateInput>) {
  const { weekId } = await f.addWeek();
  const observedAt = new Date(Date.now() - 60_000);
  return prisma.$transaction(async (tx) => {
    const header = await tx.waiverSnapshot.create({
      data: {
        seasonId: f.seasonId,
        weekId,
        version: 1,
        currentForWeekId: weekId,
        sourceLabel: "Sleeper",
        observedAt,
        frozenByUserId: f.adminUserId,
        rawInputSha256: "raw-identity",
        entriesFingerprint: "fp-identity",
        candidateCount: 1,
        eligibleCount: 1,
        excludedCount: 0,
        followUpCount: 0,
      },
    });
    await tx.waiverSnapshotEntry.create({
      data: {
        snapshotId: header.id,
        rankableEntryId: player.id,
        evidenceRole: "CANDIDATE",
        position: player.position,
        displayNameAtFreeze: player.name,
        teamAtFreeze: player.team,
        rosteredBps: 1200,
        sourceLabel: "Sleeper",
        observedAt,
        inputLineNumber: 1,
        inputLine: line(player, "12"),
        matchMethod: "EXACT_NAME_TEAM",
        eligibility: "ELIGIBLE",
        isByeAtFreeze: false,
        hardUnavailableAtFreeze: false,
        ...identity,
      },
    });
    return header;
  });
}

async function expectCheck(promise: Promise<unknown>, constraint: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${constraint} violation`).not.toBeNull();
  expect(String(error instanceof Error ? error.message : error)).toContain(constraint);
}

let a: RosterPlayer;
let b: RosterPlayer;

beforeAll(async () => {
  f = await createWaiverFixture("fid");
  await f.markRosterSynced();
  a = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Identity Receiver A" });
  b = await f.addRosterPlayer({ position: "WR", team: "SEA", label: "Identity Receiver B" });
});

afterAll(async () => {
  await f?.cleanup();
});

describe("frozen identity at insertion (DB guard)", () => {
  it("the freeze service records the RankableEntry identity of every entry", async () => {
    const { snapshotId } = await freezeWeek([a, b]);
    for (const row of await entriesOf(snapshotId)) {
      const live = await identityOf(row.rankableEntryId);
      expect(row).toMatchObject({ identityProviderAtFreeze: live.provider, identityExternalIdAtFreeze: live.externalId });
    }
  });

  it("rejects a new entry with no identity, half an identity, or the wrong provider/externalId", async () => {
    const live = await identityOf(a.id);
    await expectDbGuard(insertOne(a, {}), "WAIVER_INVALID");
    await expectDbGuard(insertOne(a, { identityProviderAtFreeze: live.provider }), "WAIVER_INVALID");
    await expectDbGuard(insertOne(a, { identityExternalIdAtFreeze: live.externalId }), "WAIVER_INVALID");
    await expectDbGuard(insertOne(a, { identityProviderAtFreeze: "nflcom-bootstrap", identityExternalIdAtFreeze: live.externalId }), "WAIVER_INVALID");
    await expectDbGuard(insertOne(a, { identityProviderAtFreeze: live.provider, identityExternalIdAtFreeze: `${live.externalId}-other` }), "WAIVER_INVALID");
    const bIdentity = await identityOf(b.id);
    await expectDbGuard(insertOne(a, { identityProviderAtFreeze: bIdentity.provider, identityExternalIdAtFreeze: bIdentity.externalId }), "WAIVER_INVALID");
    const accepted = await insertOne(a, { identityProviderAtFreeze: live.provider, identityExternalIdAtFreeze: live.externalId });
    expect((await entriesOf(accepted.id))[0]).toMatchObject({ identityProviderAtFreeze: live.provider, identityExternalIdAtFreeze: live.externalId });
  });

  it("frozen identity is immutable, and legacy NULL identity cannot be backfilled", async () => {
    const { snapshotId } = await freezeWeek([a]);
    const [row] = await entriesOf(snapshotId);
    await expectDbGuard(prisma.waiverSnapshotEntry.update({ where: { id: row.id }, data: { identityExternalIdAtFreeze: "rewritten" } }), "WAIVER_IMMUTABLE");
    await makeLegacy(snapshotId);
    const live = await identityOf(a.id);
    await expectDbGuard(
      prisma.waiverSnapshotEntry.update({ where: { id: row.id }, data: { identityProviderAtFreeze: live.provider, identityExternalIdAtFreeze: live.externalId } }),
      "WAIVER_IMMUTABLE",
    );
    expect((await entriesOf(snapshotId))[0]).toMatchObject({ identityProviderAtFreeze: null, identityExternalIdAtFreeze: null });
  });

  it("legacy rows may hold both NULL; the CHECK rejects exactly one NULL even with the guard disabled", async () => {
    const { snapshotId } = await freezeWeek([a, b]);
    await makeLegacy(snapshotId);
    const rows = await entriesOf(snapshotId);
    expect(rows.map((row) => [row.identityProviderAtFreeze, row.identityExternalIdAtFreeze])).toEqual([
      [null, null],
      [null, null],
    ]);
    const halfNull = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(DISABLE_ENTRY_GUARD);
      await tx.$executeRaw`UPDATE "WaiverSnapshotEntry" SET "identityProviderAtFreeze" = 'waivers-test' WHERE "id" = ${rows[0].id}`;
    });
    await expectCheck(halfNull, "WaiverSnapshotEntry_frozen_identity_check");
    expect(await entriesOf(snapshotId)).toEqual(rows);
  });
});

describe("corrections re-establish identity without touching prior versions", () => {
  it("version n+1 records the identity used at correction; version n rows are unchanged", async () => {
    const v1 = await freezeWeek([a, b]);
    const before = await entriesOf(v1.snapshotId);
    const result = await correct(v1.snapshotId, [{ kind: "SET_ROSTERED", rankableEntryId: a.id, percent: "12", reason: "Source showed 12%" }]);
    expect(await entriesOf(v1.snapshotId)).toEqual(before);
    for (const row of await entriesOf(result.snapshotId)) {
      const live = await identityOf(row.rankableEntryId);
      expect(row).toMatchObject({ identityProviderAtFreeze: live.provider, identityExternalIdAtFreeze: live.externalId });
    }
  });

  it("a correction of a legacy version records live identity on n+1 and leaves the legacy rows NULL", async () => {
    const v1 = await freezeWeek([a, b]);
    await makeLegacy(v1.snapshotId);
    const before = await entriesOf(v1.snapshotId);
    const result = await correct(v1.snapshotId, [{ kind: "SET_ROSTERED", rankableEntryId: b.id, percent: "14", reason: "Source showed 14%" }]);
    expect(await entriesOf(v1.snapshotId)).toEqual(before);
    for (const row of await entriesOf(result.snapshotId)) {
      const live = await identityOf(row.rankableEntryId);
      expect(row).toMatchObject({ identityProviderAtFreeze: live.provider, identityExternalIdAtFreeze: live.externalId });
    }
  });

  it("blocks a correction when a carried entry's identity changed since it was frozen", async () => {
    const drifting = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Identity Drift" });
    const v1 = await freezeWeek([a, drifting]);
    const before = await entriesOf(v1.snapshotId);
    const original = await identityOf(drifting.id);
    await prisma.rankableEntry.update({ where: { id: drifting.id }, data: { externalId: `${original.externalId}-rekeyed` } });
    try {
      const request = { snapshotId: v1.snapshotId, reason: "Operator correction", ops: [{ kind: "SET_ROSTERED" as const, rankableEntryId: a.id, percent: "13", reason: "x" }] };
      const preview = await previewWaiverCorrection(request);
      expect(preview.blockers).toContainEqual(expect.objectContaining({ code: "FROZEN_IDENTITY_CHANGED", rankableEntryIds: [drifting.id] }));
      const error = await applyWaiverCorrection({
        ...request,
        adminUserId: f.adminUserId,
        correctionFingerprint: preview.correctionFingerprint,
        acknowledged: preview.requiredAcknowledgments,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WaiverSnapshotError);
      expect((error as WaiverSnapshotError).code).toBe("BLOCKED");
      expect(await prisma.waiverSnapshot.count({ where: { weekId: v1.weekId } })).toBe(1);
      expect(await entriesOf(v1.snapshotId)).toEqual(before);
    } finally {
      await prisma.rankableEntry.update({ where: { id: drifting.id }, data: { externalId: original.externalId } });
    }
  });
});

describe("canonical preflight identity authority", () => {
  it("uses the frozen identity, blocks on frozen-vs-live drift, and keeps the advisory only for legacy rows", async () => {
    const drifting = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Preflight Drift" });
    const frozen = await freezeWeek([a, drifting]);
    const clean = await buildWaiverCanonicalPreflight(prisma, { snapshotId: frozen.snapshotId });
    expect(clean.rows.every((row) => row.identitySource === "FROZEN_AT_SNAPSHOT")).toBe(true);
    expect(clean.advisories.map((x) => x.code)).not.toContain("IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT");
    expect(clean.counts.frozenIdentityMismatch).toBe(0);

    const original = await identityOf(drifting.id);
    await prisma.rankableEntry.update({ where: { id: drifting.id }, data: { externalId: `${original.externalId}-rekeyed` } });
    try {
      const drifted = await buildWaiverCanonicalPreflight(prisma, { snapshotId: frozen.snapshotId });
      const row = drifted.rows.find((r) => r.rankableEntryId === drifting.id)!;
      expect(row.issues.map((i) => i.code)).toContain("FROZEN_IDENTITY_MISMATCH");
      expect(row.rankeyeqIdentity.externalId).toBe(original.externalId);
      expect(drifted.blockers.map((x) => x.code)).toContain("FROZEN_IDENTITY_MISMATCH");
      expect(drifted.counts.frozenIdentityMismatch).toBe(1);
    } finally {
      await prisma.rankableEntry.update({ where: { id: drifting.id }, data: { externalId: original.externalId } });
    }

    const legacy = await freezeWeek([a, b]);
    await makeLegacy(legacy.snapshotId);
    const report = await buildWaiverCanonicalPreflight(prisma, { snapshotId: legacy.snapshotId });
    expect(report.rows.every((row) => row.identitySource === "LIVE_NOT_FROZEN")).toBe(true);
    expect(report.advisories.map((x) => x.code)).toContain("IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT");
    expect(report.blockers.map((x) => x.code)).not.toContain("FROZEN_IDENTITY_MISMATCH");
    expect(report.counts.identityNotFrozen).toBe(2);
  });
});
