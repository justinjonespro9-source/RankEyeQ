import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { openWaiverContestsForWeek } from "@/lib/waivers/contests";
import { applyWaiverCorrection, previewWaiverCorrection } from "@/lib/waivers/snapshot/correct";
import type { WaiverCorrectionOp, WaiverCorrectionRequest } from "@/lib/waivers/snapshot/correct-model";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";
import { freezeWaiverSnapshot } from "@/lib/waivers/snapshot/freeze";
import { previewWaiverSnapshot } from "@/lib/waivers/snapshot/preview";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

let f: WaiverFixture;
type RosterPlayer = FixturePlayer & { team: string };
const p: Record<string, RosterPlayer> = {};
const line = (player: RosterPlayer, pct: string, extra = "") => `${player.name} | ${player.position} | ${player.team} | ${pct}${extra}`;

async function freezeWeek(rows: string[], week?: { weekId: string }) {
  const { weekId } = week ?? (await f.addWeek());
  const base = { weekId, rawText: rows.join("\n"), sourceLabel: "Sleeper", sourceUrl: "https://sleeper.example/players", observedAt: new Date(Date.now() - 20 * 60_000) };
  const preview = await previewWaiverSnapshot(base);
  expect(preview.blockers).toEqual([]);
  const result = await freezeWaiverSnapshot({
    ...base,
    adminUserId: f.adminUserId,
    previewFingerprint: preview.previewFingerprint,
    acknowledged: preview.requiredAcknowledgments,
    followUpAcks: preview.missingFollowUps.map((player) => ({ rankableEntryId: player.rankableEntryId, reason: "UNABLE_TO_VERIFY" as const, note: null })),
  });
  return { weekId, snapshotId: result.snapshotId, frozenAt: result.frozenAt, observedAt: preview.header.observedAt! };
}

async function correct(snapshotId: string, ops: WaiverCorrectionOp[], reason = "Operator correction") {
  const request: WaiverCorrectionRequest = { snapshotId, reason, ops };
  const preview = await previewWaiverCorrection(request);
  expect(preview.blockers).toEqual([]);
  const result = await applyWaiverCorrection({
    ...request,
    adminUserId: f.adminUserId,
    correctionFingerprint: preview.correctionFingerprint,
    acknowledged: preview.requiredAcknowledgments,
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

const entriesOf = (snapshotId: string) => prisma.waiverSnapshotEntry.findMany({ where: { snapshotId }, orderBy: { rankableEntryId: "asc" } });

beforeAll(async () => {
  f = await createWaiverFixture("cr");
  await f.markRosterSynced();
  p.wr1 = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Correct Receiver One" });
  p.wr2 = await f.addRosterPlayer({ position: "WR", team: "SEA", label: "Correct Receiver Two" });
  p.wr3 = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Correct Receiver Three" });
  p.rb = await f.addRosterPlayer({ position: "RB", team: "SEA", label: "Correct Runner" });
  p.omitted = await f.addRosterPlayer({ position: "RB", team: "SF", label: "Correct Omitted" });
  p.wrong = await f.addRosterPlayer({ position: "WR", team: "SEA", label: "Correct Wrong" });
  p.right = await f.addRosterPlayer({ position: "WR", team: "SEA", label: "Correct Right" });
});

afterAll(async () => {
  await f?.cleanup();
});

describe("snapshot corrections", () => {
  it("before submissions: supersedes to version 2 with field-level rows, re-derived from frozen facts, audit on the clock", async () => {
    const v1 = await freezeWeek([line(p.wr1, "10"), line(p.wr2, "20"), line(p.rb, "5")]);
    const v1Entries = await entriesOf(v1.snapshotId);
    await f.setAvailability(v1.weekId, p.wr2.id, "OUT");

    const { preview, result } = await correct(v1.snapshotId, [
      { kind: "SET_ROSTERED", rankableEntryId: p.wr1.id, percent: "55", reason: "Source showed 55% at the official time" },
      { kind: "SET_ROSTERED", rankableEntryId: p.wr2.id, percent: "21" },
    ]);
    expect(preview.requiredAcknowledgments).toEqual(["OFFICIAL_OBSERVATION_EVIDENCE", "REDUCED_DEPTH:WR"]);
    expect(result).toMatchObject({ version: 2, supersededSnapshotId: v1.snapshotId, correctionCase: "PRE_SUBMISSION", repin: [] });

    const [old, next] = await Promise.all([
      prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: v1.snapshotId } }),
      prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: result.snapshotId } }),
    ]);
    expect(old).toMatchObject({ status: "SUPERSEDED", currentForWeekId: null });
    expect(next).toMatchObject({
      status: "FROZEN",
      currentForWeekId: v1.weekId,
      version: 2,
      supersedesId: v1.snapshotId,
      correctionCase: "PRE_SUBMISSION",
      correctionReason: "Operator correction",
      observedAt: v1.observedAt,
      frozenAt: result.frozenAt,
      eligibleCount: 2,
      excludedCount: 1,
    });
    expect(await entriesOf(v1.snapshotId)).toEqual(v1Entries);

    const byId = new Map((await entriesOf(result.snapshotId)).map((entry) => [entry.rankableEntryId, entry]));
    expect(byId.get(p.wr1.id)).toMatchObject({ rosteredBps: 5500, eligibility: "EXCLUDED", exclusionReason: "AT_OR_ABOVE_THRESHOLD" });
    expect(byId.get(p.wr2.id)).toMatchObject({
      rosteredBps: 2100,
      eligibility: "ELIGIBLE",
      availabilityDesignationAtFreeze: v1Entries.find((entry) => entry.rankableEntryId === p.wr2.id)!.availabilityDesignationAtFreeze,
      hardUnavailableAtFreeze: false,
    });

    const rows = await prisma.waiverSnapshotCorrection.findMany({ where: { toSnapshotId: result.snapshotId }, orderBy: [{ rankableEntryId: "asc" }, { field: "asc" }] });
    const wr1Rows = rows.filter((row) => row.rankableEntryId === p.wr1.id);
    expect(wr1Rows.map((row) => row.field).sort()).toEqual(["eligibility", "exclusionReason", "rosteredBps"]);
    expect(wr1Rows.find((row) => row.field === "rosteredBps")).toMatchObject({
      originalValue: 1000,
      correctedValue: 5500,
      reason: "Source showed 55% at the official time",
      eligibilityBefore: "ELIGIBLE",
      eligibilityAfter: "EXCLUDED",
      correctionCase: "PRE_SUBMISSION",
      policy: "NO_BOARD_EFFECT",
      operatorUserId: f.adminUserId,
      createdAt: result.frozenAt,
    });
    expect(rows.find((row) => row.rankableEntryId === p.wr2.id)).toMatchObject({ field: "rosteredBps", reason: "Operator correction" });

    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "waivers.snapshot_corrected", entityId: result.snapshotId } });
    expect(audit.createdAt).toEqual(result.frozenAt);
    const log = await prisma.manualImportLog.findUniqueOrThrow({ where: { id: next.manualImportLogId! } });
    expect(log).toMatchObject({ importType: "WAIVER_OWNERSHIP_CORRECTION", createdAt: result.frozenAt });

    await expectSnapshotError(
      previewWaiverCorrection({ snapshotId: v1.snapshotId, reason: "again", ops: [{ kind: "REMOVE", rankableEntryId: p.rb.id }] }),
      "SNAPSHOT_NOT_CURRENT",
    );
  });

  it("chains versions linearly and keeps exactly one current version", async () => {
    const v1 = await freezeWeek([line(p.wr1, "10"), line(p.rb, "5")]);
    const { result: v2 } = await correct(v1.snapshotId, [{ kind: "SET_ROSTERED", rankableEntryId: p.wr1.id, percent: "11" }]);
    const { result: v3 } = await correct(v2.snapshotId, [{ kind: "REMOVE", rankableEntryId: p.rb.id }]);
    const chain = await prisma.waiverSnapshot.findMany({ where: { weekId: v1.weekId }, orderBy: { version: "asc" } });
    expect(chain.map((s) => [s.version, s.status, s.supersedesId, s.currentForWeekId])).toEqual([
      [1, "SUPERSEDED", null, null],
      [2, "SUPERSEDED", v1.snapshotId, null],
      [3, "FROZEN", v2.snapshotId, v1.weekId],
    ]);
    expect(v3.version).toBe(3);
    const removal = await prisma.waiverSnapshotCorrection.findFirstOrThrow({ where: { toSnapshotId: v3.snapshotId } });
    expect(removal).toMatchObject({ field: "ROW_REMOVED", rankableEntryId: p.rb.id, eligibilityBefore: "ELIGIBLE", eligibilityAfter: null, correctedValue: null });
    expect(await prisma.waiverSnapshotEntry.count({ where: { snapshotId: v3.snapshotId } })).toBe(1);
  });

  it("with submissions before lock: re-pins, flags affected boards and never rewrites revisions", async () => {
    const v1 = await freezeWeek([line(p.wr1, "10"), line(p.wr2, "20"), line(p.wr3, "30")]);
    const opened = await openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: v1.weekId, snapshotId: v1.snapshotId, positions: ["WR"] });
    const contestId = opened.opened[0].contestId;
    const user = await f.addParticipant("board");
    await submitWaiverBoard({ contestId, universalProfileId: user.profileId, userId: user.userId, playerIds: [p.wr1.id, p.wr2.id] });
    const revisionBefore = await prisma.waiverSubmissionRevision.findFirstOrThrow({
      where: { submission: { contestId } },
      include: { calls: { orderBy: { slot: "asc" } } },
    });

    const { preview, result } = await correct(v1.snapshotId, [
      { kind: "SET_AVAILABILITY", rankableEntryId: p.wr1.id, designation: "OUT", hardUnavailable: true, evidence: "Team ruled out Friday" },
    ]);
    expect(preview.correctionCase).toBe("OPEN_WITH_SUBMISSIONS");
    expect(preview.requiredAcknowledgments).toEqual(["AFFECTED_BOARDS", "REDUCED_DEPTH:WR"]);
    expect(result.repin).toEqual([expect.objectContaining({ contestId, outcome: "REPINNED", policy: "AFFECTED_BOARDS_FLAGGED" })]);
    expect((await prisma.waiverContest.findUniqueOrThrow({ where: { id: contestId } })).snapshotId).toBe(result.snapshotId);

    const rows = await prisma.waiverSnapshotCorrection.findMany({ where: { toSnapshotId: result.snapshotId, rankableEntryId: p.wr1.id } });
    const call = revisionBefore.calls.find((c) => c.slot === 1)!;
    expect(rows.every((row) => row.policy === "AFFECTED_BOARDS_FLAGGED" && row.affectedSubmissionCount === 1)).toBe(true);
    expect(rows[0].affectedCallIds).toEqual([call.id]);
    expect(rows.find((row) => row.field === "availabilityDesignationAtFreeze")).toMatchObject({ originalValue: "UNKNOWN", correctedValue: "OUT" });
    const live = await prisma.playerWeekAvailability.findUnique({ where: { weekId_rankableEntryId: { weekId: v1.weekId, rankableEntryId: p.wr1.id } } });
    expect(live).toBeNull();

    const revisionAfter = await prisma.waiverSubmissionRevision.findUniqueOrThrow({ where: { id: revisionBefore.id }, include: { calls: { orderBy: { slot: "asc" } } } });
    expect(revisionAfter).toEqual(revisionBefore);
  });

  it("after lock: records the new version only, never re-pins, and requires a policy decision with locked-call impact", async () => {
    const v1 = await freezeWeek([line(p.wr1, "10"), line(p.wr2, "20")]);
    const opened = await openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: v1.weekId, snapshotId: v1.snapshotId, positions: ["WR"] });
    const contestId = opened.opened[0].contestId;
    const user = await f.addParticipant("locked");
    await submitWaiverBoard({ contestId, universalProfileId: user.profileId, userId: user.userId, playerIds: [p.wr2.id, p.wr1.id] });
    await f.passLock(contestId);

    const { preview, result } = await correct(v1.snapshotId, [{ kind: "SET_ROSTERED", rankableEntryId: p.wr2.id, percent: "62" }]);
    expect(preview.correctionCase).toBe("POST_LOCK");
    expect(preview.requiredAcknowledgments).toEqual(["OFFICIAL_OBSERVATION_EVIDENCE", "POLICY_DECISION_REQUIRED", "POST_LOCK_RECORD_ONLY", "REDUCED_DEPTH:WR"]);
    expect(result.repin).toEqual([expect.objectContaining({ contestId, outcome: "POLICY_DECISION_REQUIRED" })]);
    expect((await prisma.waiverContest.findUniqueOrThrow({ where: { id: contestId } })).snapshotId).toBe(v1.snapshotId);
    expect((await prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: result.snapshotId } })).currentForWeekId).toBe(v1.weekId);

    const rows = await prisma.waiverSnapshotCorrection.findMany({ where: { toSnapshotId: result.snapshotId } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.policy === "POLICY_DECISION_REQUIRED" && row.correctionCase === "POST_LOCK" && row.affectedSubmissionCount === 1)).toBe(true);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "waivers.snapshot_corrected", entityId: result.snapshotId } });
    const lockedImpact = (audit.metadata as { lockedImpact: Array<{ contestId: string; affectedCallIds: string[] }> }).lockedImpact;
    expect(lockedImpact).toEqual([expect.objectContaining({ contestId, affectedCallIds: rows[0].affectedCallIds })]);
  });

  it("adds an omitted player at the official observation time and refuses hindsight observations", async () => {
    const v1 = await freezeWeek([line(p.wr1, "10"), line(p.rb, "5")]);
    const late = new Date(v1.frozenAt.getTime() + 60_000).toISOString();
    const refused = await previewWaiverCorrection({
      snapshotId: v1.snapshotId,
      reason: "Omitted",
      ops: [{ kind: "ADD_ROWS", rawText: line(p.omitted, "7", ` | | | ${late}`) }],
    });
    expect(refused.blockers.map((issue) => issue.code)).toContain("ADD_ROWS_OBSERVED_AFTER_FREEZE");

    const { preview, result } = await correct(v1.snapshotId, [{ kind: "ADD_ROWS", rawText: line(p.omitted, "7") }], "Source row missed in paste");
    expect(preview.requiredAcknowledgments).toEqual(["FACTS_CAPTURED_AT_CORRECTION", "OFFICIAL_OBSERVATION_EVIDENCE"]);
    const added = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId: result.snapshotId, rankableEntryId: p.omitted.id } });
    expect(added).toMatchObject({ rosteredBps: 700, observedAt: v1.observedAt, sourceLabel: "Sleeper", eligibility: "ELIGIBLE", inputLineNumber: 3 });
    const row = await prisma.waiverSnapshotCorrection.findFirstOrThrow({ where: { toSnapshotId: result.snapshotId } });
    expect(row).toMatchObject({ field: "ROW_ADDED", originalValue: null, eligibilityBefore: null, eligibilityAfter: "ELIGIBLE" });
  });

  it("re-matches a wrong canonical match to the admin-confirmed player", async () => {
    const v1 = await freezeWeek([line(p.wrong, "12"), line(p.rb, "5")]);
    const { result } = await correct(v1.snapshotId, [{ kind: "REMATCH", rankableEntryId: p.wrong.id, toRankableEntryId: p.right.id }]);
    const entries = await entriesOf(result.snapshotId);
    expect(entries.map((entry) => entry.rankableEntryId)).not.toContain(p.wrong.id);
    expect(entries.find((entry) => entry.rankableEntryId === p.right.id)).toMatchObject({
      matchMethod: "ADMIN_CONFIRMED",
      displayNameAtFreeze: p.right.name,
      rosteredBps: 1200,
      inputLine: line(p.wrong, "12"),
    });
    const identity = await prisma.waiverSnapshotCorrection.findFirstOrThrow({ where: { toSnapshotId: result.snapshotId, field: "rankableEntryId" } });
    expect(identity).toMatchObject({ originalValue: p.wrong.id, correctedValue: p.right.id, rankableEntryId: p.right.id });
  });

  it("a tracked player observed late at ≥50% is added as FOLLOW_UP evidence", async () => {
    const g = await createWaiverFixture("crf");
    try {
      await g.markRosterSynced();
      const week1 = await g.addWeek();
      const riser = await g.addRosterPlayer({ position: "WR", team: "SF", label: "Correct Late Riser" });
      const other = await g.addRosterPlayer({ position: "WR", team: "SEA", label: "Correct Late Other" });
      const snapshot = await g.freezeSnapshot({ weekId: week1.weekId, rows: [{ player: riser, rosteredBps: 1500 }] });
      const contest = await g.createContest({ weekId: week1.weekId, snapshotId: snapshot.id, position: "WR" });
      const user = await g.addParticipant("late");
      await submitWaiverBoard({ contestId: contest.id, universalProfileId: user.profileId, userId: user.userId, playerIds: [riser.id] });
      await g.passLock(contest.id);

      const week2 = await g.addWeek();
      const base = { weekId: week2.weekId, rawText: line(other, "8"), sourceLabel: "Sleeper", sourceUrl: null, observedAt: new Date(Date.now() - 60_000) };
      const preview = await previewWaiverSnapshot(base);
      const frozen = await freezeWaiverSnapshot({
        ...base,
        adminUserId: g.adminUserId,
        previewFingerprint: preview.previewFingerprint,
        acknowledged: preview.requiredAcknowledgments,
        followUpAcks: [{ rankableEntryId: riser.id, reason: "UNABLE_TO_VERIFY", note: null }],
      });
      const request: WaiverCorrectionRequest = { snapshotId: frozen.snapshotId, reason: "Follow-up found", ops: [{ kind: "ADD_ROWS", rawText: line(riser, "71") }] };
      const correction = await previewWaiverCorrection(request);
      const result = await applyWaiverCorrection({
        ...request,
        adminUserId: g.adminUserId,
        correctionFingerprint: correction.correctionFingerprint,
        acknowledged: correction.requiredAcknowledgments,
      });
      const entry = await prisma.waiverSnapshotEntry.findFirstOrThrow({ where: { snapshotId: result.snapshotId, rankableEntryId: riser.id } });
      expect(entry).toMatchObject({ evidenceRole: "FOLLOW_UP", eligibility: "OBSERVATION_ONLY", rosteredBps: 7100 });
      expect(await prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: result.snapshotId } })).toMatchObject({ followUpCount: 1, candidateCount: 1 });
    } finally {
      await g.cleanup();
    }
  });

  it("refuses stale previews, blockers, wrong acknowledgments and non-admins without writing", async () => {
    const v1 = await freezeWeek([line(p.wr1, "10"), line(p.wr2, "20")]);
    const opened = await openWaiverContestsForWeek({ adminUserId: f.adminUserId, weekId: v1.weekId, snapshotId: v1.snapshotId, positions: ["WR"] });
    const request: WaiverCorrectionRequest = { snapshotId: v1.snapshotId, reason: "fix", ops: [{ kind: "SET_ROSTERED", rankableEntryId: p.wr1.id, percent: "12" }] };
    const preview = await previewWaiverCorrection(request);
    const apply = (overrides: Partial<Parameters<typeof applyWaiverCorrection>[0]> = {}) =>
      applyWaiverCorrection({ ...request, adminUserId: f.adminUserId, correctionFingerprint: preview.correctionFingerprint, acknowledged: preview.requiredAcknowledgments, ...overrides });

    await expectSnapshotError(apply({ acknowledged: [] }), "ACKNOWLEDGMENT");
    const outsider = await f.addParticipant("outsider");
    await expectSnapshotError(apply({ adminUserId: outsider.userId }), "FORBIDDEN");

    const user = await f.addParticipant("stale");
    await submitWaiverBoard({ contestId: opened.opened[0].contestId, universalProfileId: user.profileId, userId: user.userId, playerIds: [p.wr2.id] });
    await expectSnapshotError(apply(), "STALE_PREVIEW");

    const blocked = await previewWaiverCorrection({ snapshotId: v1.snapshotId, reason: " ", ops: [{ kind: "SET_ROSTERED", rankableEntryId: p.rb.id, percent: "101" }] });
    expect(blocked.blockers.map((issue) => issue.code).sort()).toEqual(["ENTRY_NOT_FOUND", "REASON_MISSING"]);
    await expectSnapshotError(
      applyWaiverCorrection({ snapshotId: v1.snapshotId, reason: " ", ops: [{ kind: "SET_ROSTERED", rankableEntryId: p.rb.id, percent: "101" }], adminUserId: f.adminUserId, correctionFingerprint: blocked.correctionFingerprint, acknowledged: [] }),
      "BLOCKED",
    );
    expect(await prisma.waiverSnapshot.count({ where: { weekId: v1.weekId } })).toBe(1);
    expect(await prisma.waiverSnapshotCorrection.count({ where: { fromSnapshotId: v1.snapshotId } })).toBe(0);
  });
});
