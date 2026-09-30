import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { readWaiverClock } from "@/lib/waivers/clock";
import { openWaiverContestsForWeek, WaiverContestError } from "@/lib/waivers/contests";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";
import { freezeWaiverSnapshot, waiverSnapshotEntryRows, type WaiverFreezeInput } from "@/lib/waivers/snapshot/freeze";
import { normalizeWaiverInputText } from "@/lib/waivers/snapshot/input";
import { previewWaiverSnapshot, type WaiverSnapshotPreviewInput } from "@/lib/waivers/snapshot/preview";
import type { WaiverFollowUpAck } from "@/lib/waivers/snapshot/preview-model";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

let f: WaiverFixture;
type RosterPlayer = FixturePlayer & { team: string };
const p: Record<string, RosterPlayer> = {};

const line = (player: RosterPlayer, pct: string) => `${player.name} | ${player.position} | ${player.team} | ${pct}`;

function input(weekId: string, rows: string[], extra: Partial<WaiverSnapshotPreviewInput> = {}): WaiverSnapshotPreviewInput {
  return {
    weekId,
    rawText: ["Player | Pos | Team | Rostered%", ...rows].join("\r\n"),
    sourceLabel: "Sleeper",
    sourceUrl: "https://sleeper.example/players",
    observedAt: new Date(Date.now() - 15 * 60_000),
    ...extra,
  };
}

async function freezeFromPreview(
  base: WaiverSnapshotPreviewInput,
  overrides: Partial<Pick<WaiverFreezeInput, "adminUserId" | "acknowledged" | "followUpAcks" | "previewFingerprint">> = {},
) {
  const preview = await previewWaiverSnapshot(base);
  const result = await freezeWaiverSnapshot({
    ...base,
    adminUserId: f.adminUserId,
    previewFingerprint: preview.previewFingerprint,
    acknowledged: preview.requiredAcknowledgments,
    followUpAcks: [],
    ...overrides,
  });
  return { preview, result };
}

async function expectSnapshotError(promise: Promise<unknown>, code: WaiverSnapshotError["code"]) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WaiverSnapshotError);
  expect((error as WaiverSnapshotError).code).toBe(code);
  return error as WaiverSnapshotError;
}

async function weekWrites(weekId: string) {
  return {
    snapshots: await prisma.waiverSnapshot.count({ where: { weekId } }),
    entries: await prisma.waiverSnapshotEntry.count({ where: { snapshot: { weekId } } }),
    importLogs: await prisma.manualImportLog.count({ where: { weekId } }),
    audit: await prisma.adminAuditLog.count({ where: { adminUserId: f.adminUserId, action: "waivers.snapshot_frozen" } }),
    contests: await prisma.waiverContest.count({ where: { weekId } }),
  };
}

const standardRows = () => [line(p.qb, "12"), line(p.rb, "30.5"), line(p.wr, "7"), line(p.wrPostponed, "9"), line(p.te, "4")];

beforeAll(async () => {
  f = await createWaiverFixture("fz");
  await f.markRosterSynced();
  p.qb = await f.addRosterPlayer({ position: "QB", team: "SF", label: "Freeze Quarterback" });
  p.rb = await f.addRosterPlayer({ position: "RB", team: "SEA", label: "Freeze Runner" });
  p.wr = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Freeze Receiver" });
  p.wrPostponed = await f.addRosterPlayer({ position: "WR", team: "KC", label: "Freeze Postponed" });
  p.te = await f.addRosterPlayer({ position: "TE", team: "SEA", label: "Freeze Tight" });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await f?.cleanup();
});

describe("freezeWaiverSnapshot", () => {
  it("freezes version 1 with exact evidence, provenance and audit on the authoritative clock; opens nothing", async () => {
    const { weekId } = await f.addWeek({ games: [{ homeTeam: "SF", awayTeam: "SEA" }, { homeTeam: "KC", awayTeam: "LV", status: "POSTPONED" }] });
    const base = input(weekId, standardRows());
    const { preview, result } = await freezeFromPreview(base);
    const clock = await readWaiverClock();

    expect(result).toMatchObject({ version: 1, alreadyFrozen: false, counts: preview.counts });
    expect(Math.abs(clock.getTime() - result.frozenAt.getTime())).toBeLessThan(5_000);

    const snapshot = await prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: result.snapshotId } });
    expect(snapshot).toMatchObject({
      weekId,
      version: 1,
      status: "FROZEN",
      currentForWeekId: weekId,
      supersedesId: null,
      thresholdBps: 5000,
      sourceLabel: "Sleeper",
      sourceUrl: "https://sleeper.example/players",
      observedAt: preview.header.observedAt,
      frozenAt: result.frozenAt,
      frozenByUserId: f.adminUserId,
      rawInputSha256: preview.rawInputSha256,
      entriesFingerprint: preview.entriesFingerprint,
      ...preview.counts,
    });

    const stored = await prisma.waiverSnapshotEntry.findMany({ where: { snapshotId: snapshot.id }, orderBy: { rankableEntryId: "asc" } });
    const expected = waiverSnapshotEntryRows(snapshot.id, preview.entries).sort((a, b) => (a.rankableEntryId < b.rankableEntryId ? -1 : 1));
    expect(stored).toEqual(expected.map((row) => ({ ...row, id: expect.any(String) })));

    const log = await prisma.manualImportLog.findUniqueOrThrow({ where: { id: snapshot.manualImportLogId! } });
    expect(log).toMatchObject({ adminUserId: f.adminUserId, weekId, importType: "WAIVER_OWNERSHIP_SNAPSHOT", createdAt: result.frozenAt, createdCount: 5 });
    const metadata = log.metadata as Record<string, unknown>;
    expect(metadata.rawInput).toBe(normalizeWaiverInputText(base.rawText));
    expect(metadata.previewFingerprint).toBe(preview.previewFingerprint);
    expect(metadata.acknowledged).toEqual([...preview.requiredAcknowledgments].sort());
    expect(metadata.gameStatuses).toContainEqual(expect.objectContaining({ rankableEntryId: p.wrPostponed.id, status: "POSTPONED" }));

    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "waivers.snapshot_frozen", entityId: snapshot.id } });
    expect(audit).toMatchObject({ adminUserId: f.adminUserId, entityType: "WaiverSnapshot", createdAt: result.frozenAt });
    expect(await prisma.waiverContest.count({ where: { weekId } })).toBe(0);

    await f.setAvailability(weekId, p.qb.id, "OUT");
    await prisma.seasonPlayer.updateMany({ where: { rankableEntryId: p.rb.id }, data: { team: "DAL" } });
    await prisma.rankableEntry.update({ where: { id: p.wr.id }, data: { name: `${p.wr.name} Renamed` } });
    expect(await prisma.waiverSnapshotEntry.findMany({ where: { snapshotId: snapshot.id }, orderBy: { rankableEntryId: "asc" } })).toEqual(stored);
    await prisma.seasonPlayer.updateMany({ where: { rankableEntryId: p.rb.id }, data: { team: "SEA" } });
    await prisma.rankableEntry.update({ where: { id: p.wr.id }, data: { name: p.wr.name } });

    const again = await previewWaiverSnapshot(base);
    expect(again.blockers.map((issue) => issue.code)).toContain("SNAPSHOT_EXISTS");
  });

  it("identical re-freeze is idempotent; a different freeze is ALREADY_FROZEN; concurrent freezes create one snapshot", async () => {
    const { weekId } = await f.addWeek();
    const base = input(weekId, standardRows());
    const preview = await previewWaiverSnapshot(base);
    const request: WaiverFreezeInput = {
      ...base,
      adminUserId: f.adminUserId,
      previewFingerprint: preview.previewFingerprint,
      acknowledged: preview.requiredAcknowledgments,
      followUpAcks: [],
    };
    const [a, b] = await Promise.all([freezeWaiverSnapshot(request), freezeWaiverSnapshot(request)]);
    expect(a.snapshotId).toBe(b.snapshotId);
    expect([a.alreadyFrozen, b.alreadyFrozen].sort()).toEqual([false, true]);
    expect((await weekWrites(weekId)).snapshots).toBe(1);
    expect(await prisma.manualImportLog.count({ where: { weekId } })).toBe(1);

    const repeat = await freezeWaiverSnapshot(request);
    expect(repeat).toMatchObject({ snapshotId: a.snapshotId, alreadyFrozen: true });

    const different = input(weekId, [line(p.qb, "13")]);
    await expectSnapshotError(
      freezeWaiverSnapshot({ ...request, ...different }),
      "ALREADY_FROZEN",
    );
    expect((await weekWrites(weekId)).snapshots).toBe(1);
  });

  it("a canonical change after the preview is STALE_PREVIEW and writes nothing", async () => {
    const { weekId } = await f.addWeek();
    const base = input(weekId, standardRows());
    const preview = await previewWaiverSnapshot(base);
    await f.setAvailability(weekId, p.te.id, "OUT");
    const before = await weekWrites(weekId);
    await expectSnapshotError(
      freezeWaiverSnapshot({ ...base, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, acknowledged: preview.requiredAcknowledgments, followUpAcks: [] }),
      "STALE_PREVIEW",
    );
    expect(await weekWrites(weekId)).toEqual(before);
  });

  it("refuses blockers, wrong acknowledgments and non-admins", async () => {
    const { weekId } = await f.addWeek();
    const blocked = input(weekId, [...standardRows(), `Nobody ${f.suffix} | WR | SF | 4`]);
    const blockedPreview = await previewWaiverSnapshot(blocked);
    expect(blockedPreview.blockers.length).toBeGreaterThan(0);
    await expectSnapshotError(
      freezeWaiverSnapshot({ ...blocked, adminUserId: f.adminUserId, previewFingerprint: blockedPreview.previewFingerprint, acknowledged: blockedPreview.requiredAcknowledgments, followUpAcks: [] }),
      "BLOCKED",
    );

    const base = input(weekId, standardRows());
    const preview = await previewWaiverSnapshot(base);
    const request = { ...base, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, followUpAcks: [] };
    const missing = await expectSnapshotError(freezeWaiverSnapshot({ ...request, acknowledged: preview.requiredAcknowledgments.slice(1) }), "ACKNOWLEDGMENT");
    expect(missing.details).toContainEqual(expect.objectContaining({ code: "UNACKNOWLEDGED" }));
    await expectSnapshotError(freezeWaiverSnapshot({ ...request, acknowledged: [...preview.requiredAcknowledgments, "AFTER_LOCK"] }), "ACKNOWLEDGMENT");

    const user = await f.addParticipant("notadmin");
    await expectSnapshotError(freezeWaiverSnapshot({ ...request, acknowledged: preview.requiredAcknowledgments, adminUserId: user.userId }), "FORBIDDEN");
    expect(await weekWrites(weekId)).toMatchObject({ snapshots: 0, entries: 0, importLogs: 0 });
  });

  it("rolls back every write when the transaction fails after the last write", async () => {
    const { weekId } = await f.addWeek();
    const base = input(weekId, standardRows());
    const preview = await previewWaiverSnapshot(base);
    const before = await weekWrites(weekId);
    const original = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, options: unknown) =>
      (original as (fn: unknown, options: unknown) => Promise<unknown>)(async (tx: unknown) => {
        await fn(tx);
        throw new Error("injected failure after writes");
      }, options)) as never);
    await expect(
      freezeWaiverSnapshot({ ...base, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, acknowledged: preview.requiredAcknowledgments, followUpAcks: [] }),
    ).rejects.toThrow("injected failure after writes");
    spy.mockRestore();
    expect(await weekWrites(weekId)).toEqual(before);
  });

  it("missing tracked follow-ups need a per-player acknowledgment; ≥50% tracked players freeze as FOLLOW_UP evidence", async () => {
    const week1 = await f.addWeek();
    const riser = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Freeze Riser" });
    const absent = await f.addRosterPlayer({ position: "WR", team: "SEA", label: "Freeze Absent" });
    const snapshot = await f.freezeSnapshot({ weekId: week1.weekId, rows: [{ player: riser, rosteredBps: 1100 }, { player: absent, rosteredBps: 2400 }] });
    const contest = await f.createContest({ weekId: week1.weekId, snapshotId: snapshot.id, position: "WR" });
    const user = await f.addParticipant("follow");
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: user.profileId, userId: user.userId, playerIds: [riser.id, absent.id] });
    await f.passLock(contest.id);

    const week2 = await f.addWeek();
    const base = input(week2.weekId, [line(riser, "67"), line(p.wr, "5")]);
    const preview = await previewWaiverSnapshot(base);
    expect(preview.requiredAcknowledgments).toContain("MISSING_FOLLOW_UP");
    const request = { ...base, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, acknowledged: preview.requiredAcknowledgments };

    await expectSnapshotError(freezeWaiverSnapshot({ ...request, followUpAcks: [] }), "ACKNOWLEDGMENT");
    await expectSnapshotError(freezeWaiverSnapshot({ ...request, followUpAcks: [{ rankableEntryId: absent.id, reason: "OTHER", note: null }] }), "ACKNOWLEDGMENT");

    const acks: WaiverFollowUpAck[] = [{ rankableEntryId: absent.id, reason: "SOURCE_HAS_NO_LISTING", note: null }];
    const result = await freezeWaiverSnapshot({ ...request, followUpAcks: acks });
    expect(result.counts).toMatchObject({ followUpCount: 1, candidateCount: 1 });
    const riserEntry = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId: result.snapshotId, rankableEntryId: riser.id } });
    expect(riserEntry).toMatchObject({ evidenceRole: "FOLLOW_UP", eligibility: "OBSERVATION_ONLY", rosteredBps: 6700, exclusionReason: null });
    expect(await prisma.waiverSnapshotEntry.count({ where: { snapshotId: result.snapshotId, rankableEntryId: absent.id } })).toBe(0);
    const log = await prisma.manualImportLog.findFirstOrThrow({ where: { weekId: week2.weekId } });
    expect((log.metadata as Record<string, unknown>).followUpAcks).toEqual(acks);
  });

  it("freezing after the Tuesday lock is evidence only: it needs a CONFIRM and never opens a contest", async () => {
    const { weekId } = await f.addWeek({ firstKickoff: new Date(Date.now() - 2 * 24 * 60 * 60_000) });
    const base = input(weekId, standardRows());
    const preview = await previewWaiverSnapshot(base);
    expect(preview.contestsCanOpen).toBe(false);
    expect(preview.requiredAcknowledgments.some((code) => code === "AFTER_LOCK" || code === "LOCK_UNRESOLVABLE")).toBe(true);
    const followUpAcks = preview.missingFollowUps.map((player) => ({ rankableEntryId: player.rankableEntryId, reason: "UNABLE_TO_VERIFY" as const, note: null }));
    const request = { ...base, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, followUpAcks };
    await expectSnapshotError(
      freezeWaiverSnapshot({ ...request, acknowledged: preview.requiredAcknowledgments.filter((code) => code !== "AFTER_LOCK" && code !== "LOCK_UNRESOLVABLE") }),
      "ACKNOWLEDGMENT",
    );
    const result = await freezeWaiverSnapshot({ ...request, acknowledged: preview.requiredAcknowledgments });
    expect(result.contestsCanOpen).toBe(false);
    const error = await openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId, snapshotId: result.snapshotId }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WaiverContestError);
    expect(["LOCK_NOT_BEFORE_FIRST_KICKOFF", "WINDOW_ORDER"]).toContain((error as WaiverContestError).code);
    expect(await prisma.waiverContest.count({ where: { weekId } })).toBe(0);
  });
});
