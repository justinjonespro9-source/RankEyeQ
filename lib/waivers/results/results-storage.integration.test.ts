import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { expectDbGuard } from "@/lib/waivers/__fixtures__/competition";
import { createResultsFixture, expectRejected, type ArtifactRef, type ResultsFixture } from "@/lib/waivers/__fixtures__/results";

/** D3 resolutions, contest results and pool rows (Stage 4B.3 tests 1-7). Synthetic local fixtures only. */

let f: ResultsFixture;
let r1: ArtifactRef;

beforeEach(async () => {
  f = await createResultsFixture("res");
  r1 = await f.importArtifact(1);
});

afterEach(async () => {
  await f.cleanup();
});

describe("D3 conflict resolutions", () => {
  it("1. are immutable: UPDATE and DELETE are refused; a correction appends sequence n+1 and leaves the original intact", async () => {
    const first = await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NON_PARTICIPANT_ZERO" });
    await expectDbGuard(prisma.waiverConflictResolution.update({ where: { id: first.id }, data: { resolution: "NEUTRALIZED" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverConflictResolution.delete({ where: { id: first.id } }), "WAIVER_IMMUTABLE");

    const correction = await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED", supersedes: first });
    expect(correction.sequence).toBe(2);
    const original = await prisma.waiverConflictResolution.findUniqueOrThrow({ where: { id: first.id } });
    expect(original).toEqual(first);
    // the database clock stamps the decision, never the caller
    expect(Math.abs(original.resolvedAt.getTime() - Date.now())).toBeLessThan(60_000);

    // a stale correction (skipping the chain) is refused
    await expectDbGuard(f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED", supersedes: { id: first.id, sequence: 2 } }), "WAIVER_INVALID");
  });

  it("2. bind one exact artifact revision: mismatched revision/checksum is refused and a new revision needs explicit reconfirmation", async () => {
    const decided = await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED" });
    await expectDbGuard(f.resolve({ position: "WR", key: "wr6", artifact: { ...r1, revision: 2 }, resolution: "NEUTRALIZED" }), "WAIVER_INVALID");
    await expectDbGuard(f.resolve({ position: "WR", key: "wr6", artifact: { ...r1, contentChecksum: "0".repeat(64) }, resolution: "NEUTRALIZED" }), "WAIVER_INVALID");

    const r2 = await f.importArtifact(2);
    // r1's resolution is not carried forward: the r2 WR result cannot be built or stored with it
    await expect(f.buildContestResult("WR", { artifact: r2 })).rejects.toThrow(/needs a D3 resolution/);
    const r1Built = await f.buildContestResult("WR", { artifact: r1 });
    const r2Attempt = await f.buildContestResult("WR", { artifact: r2, facts: { wr6: { cls: "NON_PARTICIPANT" } } });
    const wr6 = f.players.wr6.id;
    r2Attempt.rows = r2Attempt.rows.map((row) =>
      row.rankableEntryId === wr6 ? { ...r1Built.rows.find((r) => r.rankableEntryId === wr6)!, sngResultFingerprint: null } : row,
    );
    await expectDbGuard(f.writeContestResult(r2Attempt), "WAIVER_INVALID");

    // a reconfirmation must point at an earlier revision of the same series
    await expectDbGuard(
      f.resolve({ position: "WR", key: "wr6", artifact: r2, resolution: "NEUTRALIZED", reconfirmsResolutionId: (await f.resolve({ position: "WR", key: "wr6", artifact: r2, resolution: "NEUTRALIZED" })).id }),
      "WAIVER_INVALID",
    );
    const reconfirmed = await prisma.waiverConflictResolution.findFirstOrThrow({ where: { artifactRowId: r2.id } });
    expect(reconfirmed.reconfirmsResolutionId).toBeNull();
    const r2Result = await f.writeContestResult(await f.buildContestResult("WR", { artifact: r2 }));
    expect(r2Result.resultVersion).toBe(1);
    expect(decided.artifactRevision).toBe(1);

    // the r1 artifact is now SUPERSEDED: no new decisions or results may bind it
    await expectDbGuard(f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED", supersedes: decided }), "WAIVER_INVALID");
    await expectDbGuard(f.writeContestResult(r1Built), "WAIVER_INVALID");
  });

  it("2b. reconfirmation lineage across revisions is recorded without mutating the prior decision", async () => {
    const decided = await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED" });
    const r2 = await f.importArtifact(2);
    const again = await f.resolve({ position: "WR", key: "wr6", artifact: r2, resolution: "NEUTRALIZED", reconfirmsResolutionId: decided.id });
    expect(again.reconfirmsResolutionId).toBe(decided.id);
    expect(again.conflictKey).not.toBe(decided.conflictKey);
    expect(await prisma.waiverConflictResolution.findUniqueOrThrow({ where: { id: decided.id } })).toEqual(decided);
  });

  it("3. duplicate decisions for the same conflict, artifact and sequence are refused", async () => {
    await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED" });
    await expectRejected(f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NON_PARTICIPANT_ZERO" }), /Unique constraint/);
  });

  it("resolutions cover uncalled eligible pool members, require an ADMIN resolver and never touch the frozen snapshot", async () => {
    const before = await prisma.waiverSnapshotEntry.findMany({ where: { snapshotId: { in: [f.snapshots.v1, f.snapshots.v2] } }, orderBy: { id: "asc" } });
    await expectDbGuard(f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED", resolvedByUserId: f.memberUserId }), "WAIVER_INVALID");
    await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED" });
    // a superseded snapshot's row for an uncalled player is not a member of the contest's pool
    const qb3v1 = await prisma.waiverSnapshotEntry.findUniqueOrThrow({ where: { snapshotId_rankableEntryId: { snapshotId: f.snapshots.v1, rankableEntryId: f.players.qb3.id } } });
    await expectDbGuard(f.resolve({ position: "QB", key: "qb3", artifact: r1, resolution: "NEUTRALIZED", snapshotEntryId: qb3v1.id }), "WAIVER_INVALID");
    expect(await prisma.waiverSnapshotEntry.findMany({ where: { snapshotId: { in: [f.snapshots.v1, f.snapshots.v2] } }, orderBy: { id: "asc" } })).toEqual(before);
  });
});

describe("contest results and pool rows", () => {
  it("4. result versions are contiguous and unique per contest; an identical input is refused as a duplicate", async () => {
    const first = await f.buildContestResult("QB", { artifact: r1 });
    const stored = await f.writeContestResult(first);
    expect(stored.resultVersion).toBe(1);
    await expectRejected(f.writeContestResult({ ...first, result: { ...first.result, resultVersion: 2 } }), /Unique constraint|WAIVER_INVALID/);
    const changed = await f.buildContestResult("QB", { artifact: r1, facts: { qb3: { cls: "RANKED", points: 100 } } });
    await expectDbGuard(f.writeContestResult({ ...changed, result: { ...changed.result, resultVersion: 3 } }), "WAIVER_INVALID");
    expect((await f.writeContestResult(changed)).resultVersion).toBe(2);
    await expectDbGuard(prisma.waiverContestResult.update({ where: { id: stored.id }, data: { effectivePoolSize: 0 } }), "WAIVER_IMMUTABLE");
  });

  it("5. a result binds the contest's pinned snapshot, real pool size and effective available slots", async () => {
    const built = await f.buildContestResult("QB", { artifact: r1 });
    expect(built.result).toMatchObject({ snapshotId: f.snapshots.v2, eligiblePoolSize: 3, effectivePoolSize: 2, effectiveFieldSize: 2, effectiveAvailableSlots: 3, invalidatedCalledCount: 1 });
    await expectDbGuard(f.writeContestResult({ ...built, result: { ...built.result, snapshotId: f.snapshots.v1 } }), "WAIVER_INVALID");
    await expectDbGuard(f.writeContestResult({ ...built, result: { ...built.result, eligiblePoolSize: 4 } }), "WAIVER_INVALID");
    await expectDbGuard(f.writeContestResult({ ...built, result: { ...built.result, invalidatedCalledCount: 0 } }), "WAIVER_INVALID");
    await expectRejected(f.writeContestResult({ ...built, result: { ...built.result, effectiveFieldSize: 3 } }), /WaiverContestResult_shape_check/);
    await expectDbGuard(f.writeContestResult({ ...built, result: { ...built.result, contestId: f.contests.RB } }), "WAIVER_INVALID");
  });

  it("6. every eligible frozen member and every invalidated called player is stored once, in separate categories", async () => {
    const built = await f.buildContestResult("QB", { artifact: r1 });
    const qbX = built.rows.find((r) => r.rankableEntryId === f.players.qbX.id)!;
    expect(qbX).toMatchObject({ category: "INVALIDATED_CALLED_PLAYER", treatment: "INVALIDATED_PRE_LOCK", fpHundredths: 0, waiverPoolRank: null, invalidationBasis: "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" });
    const qb3 = built.rows.find((r) => r.rankableEntryId === f.players.qb3.id)!;
    expect(qb3).toMatchObject({ category: "ELIGIBLE_POOL_MEMBER", treatment: "NON_PARTICIPANT_ZERO", fpHundredths: 0, waiverPoolRank: null });

    const without = (id: string) => ({ ...built, rows: built.rows.filter((r) => r.rankableEntryId !== id) });
    await expectDbGuard(f.writeContestResult(without(f.players.qb3.id)), "WAIVER_INVALID");
    await expectDbGuard(f.writeContestResult(without(f.players.qbX.id)), "WAIVER_INVALID");
    // categories are never merged
    await expectRejected(
      f.writeContestResult({ ...built, rows: built.rows.map((r) => (r.rankableEntryId === f.players.qbX.id ? { ...r, category: "ELIGIBLE_POOL_MEMBER", invalidationBasis: null, invalidatedBySnapshotId: null, treatment: "RANKED", fpHundredths: 3000, waiverPoolRank: 1 } : r)) }),
      /WAIVER_INVALID|WaiverPoolResult_\w+_check/,
    );
    await expectRejected(
      f.writeContestResult({ ...built, rows: built.rows.map((r) => (r.rankableEntryId === f.players.qb3.id ? { ...r, category: "INVALIDATED_CALLED_PLAYER", invalidationBasis: "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT", invalidatedBySnapshotId: f.snapshots.v2, treatment: "INVALIDATED_PRE_LOCK" } : r)) }),
      /WAIVER_INVALID/,
    );
    // a snapshot conflict cannot be stored without a D3 resolution
    const wr = await f.buildContestResult("WR", { artifact: r1, facts: { wr6: { cls: "NON_PARTICIPANT" } } });
    await expectRejected(
      f.writeContestResult({ ...wr, rows: wr.rows.map((r) => (r.rankableEntryId === f.players.wr6.id ? { ...r, canonicalClass: "SNAPSHOT_CONFLICT", participantDisposition: "BYE" } : r)) }),
      /WaiverPoolResult_(canonical|treatment)_check/,
    );
    // canonical class must match SNG participation facts
    await expectRejected(
      f.writeContestResult({ ...built, rows: built.rows.map((r) => (r.rankableEntryId === f.players.qb3.id ? { ...r, participantDisposition: "PLAYED" } : r)) }),
      /WaiverPoolResult_canonical_check/,
    );
    const stored = await f.writeContestResult(built);
    expect(await prisma.waiverPoolResult.count({ where: { contestResultId: stored.id } })).toBe(4);
  });

  it("7. pool rows carry the frozen identity, their own D3 resolution and competition ranks over the post-treatment RANKED set", async () => {
    const built = await f.buildContestResult("QB", { artifact: r1 });
    const ranks = Object.fromEntries(built.rows.map((r) => [r.rankableEntryId, r.waiverPoolRank]));
    expect([ranks[f.players.qb1.id], ranks[f.players.qb2.id]]).toEqual([1, 1]);

    const tweak = (id: string, patch: Record<string, unknown>) => ({ ...built, rows: built.rows.map((r) => (r.rankableEntryId === id ? { ...r, ...patch } : r)) });
    await expectDbGuard(f.writeContestResult(tweak(f.players.qb1.id, { identityExternalId: "someone-else" })), "WAIVER_INVALID");
    await expectDbGuard(f.writeContestResult(tweak(f.players.qb2.id, { waiverPoolRank: 2 })), "WAIVER_INVALID");
    await expectRejected(f.writeContestResult(tweak(f.players.qb1.id, { fpHundredths: 2600 })), /WaiverPoolResult_treatment_check/);
    await expectDbGuard(f.writeContestResult(tweak(f.players.qb1.id, { rankableEntryId: f.players.rb1.id })), "WAIVER_INVALID");

    // a resolution belongs to one player: wr6's decision cannot be applied to wr5
    await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED" });
    const wr = await f.buildContestResult("WR", { artifact: r1 });
    const wr6Resolution = wr.rows.find((r) => r.rankableEntryId === f.players.wr6.id)!.conflictResolutionId;
    expect(wr6Resolution).toBeTruthy();
    await expectDbGuard(
      f.writeContestResult({ ...wr, rows: wr.rows.map((r) => (r.rankableEntryId === f.players.wr5.id ? { ...r, conflictResolutionId: wr6Resolution } : r)) }),
      "WAIVER_INVALID",
    );
    // the stored WR result applies the decision: wr6 neutralized and unranked, wr1..wr5 ranked 1..5
    const stored = await f.writeContestResult(wr);
    const rows = await prisma.waiverPoolResult.findMany({ where: { contestResultId: stored.id } });
    expect(rows.find((r) => r.rankableEntryId === f.players.wr6.id)).toMatchObject({ treatment: "NEUTRALIZED", fpHundredths: null, waiverPoolRank: null });
    expect(rows.filter((r) => r.waiverPoolRank !== null).map((r) => r.waiverPoolRank).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("a later D3 correction makes the stored result stale; a new result version must apply the current decision", async () => {
    const first = await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NEUTRALIZED" });
    const stale = await f.buildContestResult("WR", { artifact: r1 });
    await f.resolve({ position: "WR", key: "wr6", artifact: r1, resolution: "NON_PARTICIPANT_ZERO", supersedes: first });
    await expectDbGuard(f.writeContestResult(stale), "WAIVER_INVALID");
    const fresh = await f.buildContestResult("WR", { artifact: r1 });
    expect(fresh.rows.find((r) => r.rankableEntryId === f.players.wr6.id)?.treatment).toBe("NON_PARTICIPANT_ZERO");
    await f.writeContestResult(fresh);
  });
});
