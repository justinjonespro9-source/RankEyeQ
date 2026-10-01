import { describe, expect, it } from "vitest";
import { hex } from "@/lib/waivers/__fixtures__/canonical-artifact";
import {
  canonicalPerfectHonor,
  detectSnapshotCanonicalConflicts,
  evaluateCanonicalWaiverBoard,
  rankFrozenPoolFromCanonical,
  resolveCanonicalCallTreatment,
  type CanonicalBoardEvaluation,
  type CanonicalCallTreatment,
  type SnapshotCanonicalConflict,
  type SnapshotCanonicalConflictResolution,
} from "@/lib/waivers/canonical/policy";
import { computeWaiverProduction } from "@/lib/waivers/production";
import { scoreWaiverBoard, WaiverScoringError } from "@/lib/waivers/scoring";

const ranked = (waiverPoolRank: number, fpHundredths: number): CanonicalCallTreatment => ({ kind: "RANKED", waiverPoolRank, fpHundredths });
const dnp: CanonicalCallTreatment = { kind: "NON_PARTICIPANT_ZERO", reason: "DNP" };
const cancelled: CanonicalCallTreatment = { kind: "NEUTRALIZED", reason: "CANCELLED_GAME" };
const moved: CanonicalCallTreatment = { kind: "NEUTRALIZED", reason: "MOVED_OUT_OF_WEEK" };
const board = (treatments: CanonicalCallTreatment[], availableSlots = 3, resultFieldSize = 3) =>
  evaluateCanonicalWaiverBoard({ calls: treatments.map((treatment, i) => ({ slot: i + 1, treatment })), availableSlots, resultFieldSize });
function evaluated(result: CanonicalBoardEvaluation) {
  if (result.status !== "EVALUATED") throw new Error(`expected EVALUATED, got ${JSON.stringify(result)}`);
  return result;
}

describe("rankFrozenPoolFromCanonical", () => {
  it("ranks only canonical-ranked pool members; D1/D2 members take no rank position", () => {
    const ranks = rankFrozenPoolFromCanonical([
      { snapshotEntryId: "A", cls: "RANKED", fpHundredths: 1200 },
      { snapshotEntryId: "B", cls: "NON_PARTICIPANT", fpHundredths: null },
      { snapshotEntryId: "Z", cls: "RANKED", fpHundredths: 0 },
      { snapshotEntryId: "N", cls: "SYSTEMIC_NEUTRALIZE", fpHundredths: null },
      { snapshotEntryId: "C", cls: "RANKED", fpHundredths: -120 },
    ]);
    expect(Object.fromEntries([...ranks].map(([id, r]) => [id, r.waiverPoolRank]))).toEqual({ A: 1, Z: 2, C: 3 });
  });

  it("shares competition ranks on exact integer ties", () => {
    const ranks = rankFrozenPoolFromCanonical([
      { snapshotEntryId: "A", cls: "RANKED", fpHundredths: 1940 },
      { snapshotEntryId: "B", cls: "RANKED", fpHundredths: 1940 },
      { snapshotEntryId: "C", cls: "RANKED", fpHundredths: 900 },
    ]);
    expect([...ranks.values()].map((r) => r.waiverPoolRank)).toEqual([1, 1, 3]);
  });

  it("refuses a ranked member without integer points", () => {
    expect(() => rankFrozenPoolFromCanonical([{ snapshotEntryId: "A", cls: "RANKED", fpHundredths: null }])).toThrow(WaiverScoringError);
  });
});

describe("D1 — VERIFIED_NON_PARTICIPANT call", () => {
  it("earns 0 raw points, keeps coverage, and contributes 0 FP to both denominators (RB example → 66.67)", () => {
    const result = evaluated(board([ranked(1, 2810), dnp, ranked(3, 1940)]));
    expect(result).toMatchObject({
      submittedCalls: 3,
      scoredCalls: 3,
      neutralizedSlots: [],
      effectiveAvailableSlots: 3,
      earnedRawPoints: 56,
      maxRawPoints: 84,
      eyeqHundredths: 6667,
      totalFpHundredths: 4750,
      fpPerCallHundredths: 1583,
      fpPerAvailableSlotHundredths: 1583,
    });
    expect(result.calls[1]).toEqual({
      slot: 2,
      treatment: "NON_PARTICIPANT_ZERO",
      scored: true,
      rawPoints: 0,
      fpHundredths: 0,
      exactSlotHit: false,
      honorCreditEligible: false,
      invalidatedPreLock: false,
      precedence: null,
      operatorResolutions: [],
    });
  });

  it("treats NO_ROSTER_ASSIGNMENT exactly like DNP", () => {
    const unrostered: CanonicalCallTreatment = { kind: "NON_PARTICIPANT_ZERO", reason: "NO_ROSTER_ASSIGNMENT" };
    const result = evaluated(board([ranked(1, 2810), unrostered, ranked(3, 1940)]));
    expect({ ...result, calls: undefined }).toEqual({ ...evaluated(board([ranked(1, 2810), dnp, ranked(3, 1940)])), calls: undefined });
    expect(result.calls[1]).toMatchObject({ scored: true, rawPoints: 0, fpHundredths: 0, exactSlotHit: false, honorCreditEligible: false });
  });

  it("matches Phase 1 scoring of an unranked call exactly", () => {
    const phase1 = scoreWaiverBoard({ actualRanksBySlot: [1, null, 3], resultFieldSize: 3, availableSlots: 3 });
    const production = computeWaiverProduction({ calls: [{ fpHundredths: 2810 }, { fpHundredths: 0 }, { fpHundredths: 1940 }], availableSlots: 3 });
    const result = evaluated(board([ranked(1, 2810), dnp, ranked(3, 1940)]));
    expect(result.eyeqHundredths).toBe(phase1.eyeqHundredths);
    expect(result.earnedRawPoints).toBe(phase1.earnedRawPoints);
    expect(result.fpPerCallHundredths).toBe(production.fpPerCallHundredths);
    expect(result.fpPerAvailableSlotHundredths).toBe(production.fpPerAvailableSlotHundredths);
  });

  it("does not let the non-participant occupy a rank (TE example: C stays #2 → 90.00)", () => {
    const ranks = rankFrozenPoolFromCanonical([
      { snapshotEntryId: "A", cls: "RANKED", fpHundredths: 1200 },
      { snapshotEntryId: "B", cls: "NON_PARTICIPANT", fpHundredths: null },
      { snapshotEntryId: "C", cls: "RANKED", fpHundredths: -120 },
    ]);
    const a = ranks.get("A")!;
    const c = ranks.get("C")!;
    const result = evaluated(board([ranked(a.waiverPoolRank, a.fpHundredths), ranked(c.waiverPoolRank, c.fpHundredths)]));
    expect(c.waiverPoolRank).toBe(2);
    expect(result).toMatchObject({ earnedRawPoints: 61, maxRawPoints: 61, eyeqHundredths: 9000, totalFpHundredths: 1080 });
  });

  it("removes Perfect-board eligibility because the slot is never exact", () => {
    const result = evaluated(board([ranked(1, 2810), dnp]));
    expect(result.calls.every((call) => call.exactSlotHit)).toBe(false);
  });
});

describe("C2 — pre-lock invalidated call left unrevised", () => {
  it("has the same accounting as D1", () => {
    const invalidated = evaluated(board([ranked(1, 2810), { kind: "INVALIDATED_PRE_LOCK" }, ranked(3, 1940)]));
    const nonParticipant = evaluated(board([ranked(1, 2810), dnp, ranked(3, 1940)]));
    expect({ ...invalidated, calls: undefined }).toEqual({ ...nonParticipant, calls: undefined });
    expect(invalidated.calls[1]).toMatchObject({ rawPoints: 0, fpHundredths: 0, scored: true, honorCreditEligible: false, invalidatedPreLock: true, precedence: null });
  });
});

describe("Precedence — D2 systemic neutralization over C2 pre-lock invalidation", () => {
  const base = { ranked: null, conflicts: [], resolutions: [] };

  it.each(["CANCELLED_GAME", "MOVED_OUT_OF_WEEK"])("neutralizes an invalidated call when the game is %s, keeping both facts", (reason) => {
    const treatment = resolveCanonicalCallTreatment({ ...base, cls: "SYSTEMIC_NEUTRALIZE", reason, invalidatedPreLock: true });
    expect(treatment).toEqual({ kind: "NEUTRALIZED", reason, invalidatedPreLock: true, precedence: "D2_NEUTRALIZATION_OVER_C2_INVALIDATION" });

    const result = evaluated(board([ranked(1, 2810), treatment, ranked(3, 1940)]));
    expect(result.calls[1]).toEqual({
      slot: 2,
      treatment: "NEUTRALIZED",
      scored: false,
      rawPoints: null,
      fpHundredths: null,
      exactSlotHit: false,
      honorCreditEligible: false,
      invalidatedPreLock: true,
      precedence: "D2_NEUTRALIZATION_OVER_C2_INVALIDATION",
      operatorResolutions: [],
    });
  });

  it("scores exactly like any other neutralized call: removed from earned/max, FP/Call and FP/Slot, no compaction", () => {
    const invalidatedThenCancelled = resolveCanonicalCallTreatment({ ...base, cls: "SYSTEMIC_NEUTRALIZE", reason: "CANCELLED_GAME", invalidatedPreLock: true });
    const precedence = evaluated(board([ranked(1, 2810), invalidatedThenCancelled, ranked(3, 1940)]));
    const plain = evaluated(board([ranked(1, 2810), cancelled, ranked(3, 1940)]));
    expect({ ...precedence, calls: undefined }).toEqual({ ...plain, calls: undefined });
    expect(precedence).toMatchObject({ neutralizedSlots: [2], effectiveAvailableSlots: 2, maxRawPoints: 56, eyeqHundredths: 10000, fpPerCallHundredths: 2375 });
    expect(precedence.calls[2]).toMatchObject({ slot: 3, exactSlotHit: true });
  });

  it("does not let neutralization rescue C2 on a game that was played", () => {
    expect(resolveCanonicalCallTreatment({ ...base, cls: "RANKED", reason: "", ranked: { waiverPoolRank: 1, fpHundredths: 2000 }, invalidatedPreLock: true })).toEqual({
      kind: "INVALIDATED_PRE_LOCK",
    });
    expect(resolveCanonicalCallTreatment({ ...base, cls: "NON_PARTICIPANT", reason: "DNP", invalidatedPreLock: true })).toEqual({ kind: "INVALIDATED_PRE_LOCK" });
  });
});

describe("D2 — CANCELLED_GAME / MOVED_OUT_OF_WEEK neutralization", () => {
  it("neutralizes the call and slot without compacting the board (RB example → 100.00)", () => {
    const result = evaluated(board([ranked(1, 2810), cancelled, ranked(3, 1940)]));
    expect(result).toMatchObject({
      submittedCalls: 3,
      scoredCalls: 2,
      neutralizedSlots: [2],
      availableSlots: 3,
      effectiveAvailableSlots: 2,
      earnedRawPoints: 56,
      maxRawPoints: 56,
      eyeqHundredths: 10000,
      totalFpHundredths: 4750,
      fpPerCallHundredths: 2375,
      fpPerAvailableSlotHundredths: 2375,
      allNeutralized: false,
    });
    expect(result.calls[2]).toMatchObject({ slot: 3, rawPoints: 23, exactSlotHit: true });
    expect(result.calls[1]).toEqual({
      slot: 2,
      treatment: "NEUTRALIZED",
      scored: false,
      rawPoints: null,
      fpHundredths: null,
      exactSlotHit: false,
      honorCreditEligible: false,
      invalidatedPreLock: false,
      precedence: null,
      operatorResolutions: [],
    });
  });

  it("treats a moved game identically", () => {
    expect(evaluated(board([moved, ranked(2, 1500)])).eyeqHundredths).toBe(evaluated(board([cancelled, ranked(2, 1500)])).eyeqHundredths);
  });

  it("reports N/A everywhere when every submitted call is neutralized", () => {
    const result = evaluated(board([cancelled, moved]));
    expect(result).toMatchObject({
      submittedCalls: 2,
      scoredCalls: 0,
      neutralizedSlots: [1, 2],
      effectiveAvailableSlots: 1,
      eyeqHundredths: null,
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: null,
      allNeutralized: true,
    });
  });

  it("leaves an explicit zero-call board on its existing semantics", () => {
    expect(evaluated(board([]))).toMatchObject({ eyeqHundredths: null, fpPerCallHundredths: null, fpPerAvailableSlotHundredths: 0, allNeutralized: false });
  });
});

describe("D3 — snapshot / canonical conflicts", () => {
  const artifactA = hex("artifact-a");
  const bye = (artifactContentChecksum = artifactA) =>
    detectSnapshotCanonicalConflicts({
      artifactContentChecksum,
      snapshotEntryId: "entry-1",
      snapshot: { isByeAtFreeze: false, teamAtFreeze: "GB" },
      canonical: { participantId: "rb-bye", cls: "SNAPSHOT_CONFLICT", disposition: "BYE", teamKey: "green-bay-packers" },
    });
  const resolve = (conflicts: SnapshotCanonicalConflict[], overrides: Partial<SnapshotCanonicalConflictResolution> = {}): SnapshotCanonicalConflictResolution[] =>
    conflicts.map((c) => ({
      conflictKey: c.conflictKey,
      conflictKind: c.kind,
      resolution: "NEUTRALIZED",
      resolvedByUserId: "admin-1",
      resolvedAt: "2026-10-06T15:04:05.000Z",
      reason: "Reviewed schedule evidence",
      ...overrides,
    }));

  it("detects BYE against a scheduled frozen game with a stable, artifact-scoped key", () => {
    const [conflict] = bye();
    expect(conflict).toMatchObject({ code: "SNAPSHOT_CANONICAL_CONFLICT", kind: "BYE_VS_SCHEDULED", participantId: "rb-bye" });
    expect(bye()[0].conflictKey).toBe(conflict.conflictKey);
    expect(bye(hex("artifact-b"))[0].conflictKey).not.toBe(conflict.conflictKey);
  });

  it("blocks the call and the board until resolved", () => {
    const conflicts = bye();
    const treatment = resolveCanonicalCallTreatment({ cls: "SNAPSHOT_CONFLICT", reason: "BYE", ranked: null, invalidatedPreLock: false, conflicts, resolutions: [] });
    expect(treatment).toMatchObject({ kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT" });
    expect(board([ranked(1, 2810), treatment])).toEqual({
      status: "BLOCKED",
      blockers: [{ slot: 2, code: "SNAPSHOT_CANONICAL_CONFLICT", detail: expect.stringContaining("BYE") }],
    });
  });

  it("requires conflict type, an approved resolution, operator, UTC timestamp, reason, and a key for this artifact", () => {
    const conflicts = bye();
    const attempt = (resolutions: SnapshotCanonicalConflictResolution[]) =>
      resolveCanonicalCallTreatment({ cls: "SNAPSHOT_CONFLICT", reason: "BYE", ranked: null, invalidatedPreLock: false, conflicts, resolutions });
    expect(attempt(resolve(conflicts, { reason: "  " })).kind).toBe("BLOCKED");
    expect(attempt(resolve(conflicts, { resolvedByUserId: "" })).kind).toBe("BLOCKED");
    expect(attempt(resolve(conflicts, { conflictKind: "TEAM_CHANGED" })).kind).toBe("BLOCKED");
    expect(attempt(resolve(conflicts, { resolvedAt: "" })).kind).toBe("BLOCKED");
    expect(attempt(resolve(conflicts, { resolvedAt: "2026-10-06" })).kind).toBe("BLOCKED");
    expect(attempt(resolve(conflicts, { resolvedAt: "2026-10-06T10:04:05-05:00" })).kind).toBe("BLOCKED");
    expect(attempt(resolve(conflicts, { resolution: "VOID" as never })).kind).toBe("BLOCKED");
    expect(attempt(resolve(bye(hex("artifact-b")))).kind).toBe("BLOCKED");
    expect(attempt(resolve(conflicts, { resolution: "SCORE_AS_RANKED" })).kind).toBe("BLOCKED");
  });

  it("carries the full audit record with the resolved treatment and into the evaluation", () => {
    const conflicts = bye();
    const attempt = (resolutions: SnapshotCanonicalConflictResolution[]) =>
      resolveCanonicalCallTreatment({ cls: "SNAPSHOT_CONFLICT", reason: "BYE", ranked: null, invalidatedPreLock: false, conflicts, resolutions });
    const neutralized = resolve(conflicts);
    expect(attempt(neutralized)).toEqual({ kind: "NEUTRALIZED", reason: "operator-resolved conflict", operatorResolutions: neutralized });
    const zero = resolve(conflicts, { resolution: "NON_PARTICIPANT_ZERO" });
    expect(attempt(zero)).toEqual({ kind: "NON_PARTICIPANT_ZERO", reason: "operator-resolved conflict", operatorResolutions: zero });

    const [record] = evaluated(board([ranked(1, 2810), attempt(neutralized)])).calls[1].operatorResolutions;
    expect(record).toEqual({
      conflictKey: conflicts[0].conflictKey,
      conflictKind: "BYE_VS_SCHEDULED",
      resolution: "NEUTRALIZED",
      resolvedByUserId: "admin-1",
      resolvedAt: "2026-10-06T15:04:05.000Z",
      reason: "Reviewed schedule evidence",
    });
  });

  it("detects a team contradiction for a ranked or DNP player, but not for an unrostered one", () => {
    const team = (cls: "RANKED" | "NON_PARTICIPANT", disposition: string, teamKey: string, teamAtFreeze: string | null = "SF") =>
      detectSnapshotCanonicalConflicts({
        artifactContentChecksum: artifactA,
        snapshotEntryId: "entry-2",
        snapshot: { isByeAtFreeze: false, teamAtFreeze },
        canonical: { participantId: "p", cls, disposition, teamKey },
      });
    expect(team("RANKED", "PLAYED", "san-francisco-49ers")).toEqual([]);
    expect(team("RANKED", "PLAYED", "seattle-seahawks")).toMatchObject([{ kind: "TEAM_CHANGED", detail: "frozen team SF; canonical team SEA" }]);
    expect(team("NON_PARTICIPANT", "DNP", "seattle-seahawks")).toHaveLength(1);
    expect(team("NON_PARTICIPANT", "NO_ROSTER_ASSIGNMENT", "new-york-jets")).toEqual([]);
    expect(team("RANKED", "PLAYED", "seattle-seahawks", null)).toEqual([]);
    expect(team("RANKED", "PLAYED", "washington-commanders", "WAS")).toEqual([]);
  });

  it("keeps TEAM_CHANGED blocking until an operator resolves it, then honors SCORE_AS_RANKED", () => {
    const conflicts = detectSnapshotCanonicalConflicts({
      artifactContentChecksum: artifactA,
      snapshotEntryId: "entry-3",
      snapshot: { isByeAtFreeze: false, teamAtFreeze: "SF" },
      canonical: { participantId: "p", cls: "RANKED", disposition: "PLAYED", teamKey: "seattle-seahawks" },
    });
    const attempt = (resolutions: SnapshotCanonicalConflictResolution[]) =>
      resolveCanonicalCallTreatment({
        cls: "RANKED",
        reason: "PARTICIPATED_WITH_STATS",
        ranked: { waiverPoolRank: 2, fpHundredths: 1500 },
        invalidatedPreLock: false,
        conflicts,
        resolutions,
      });
    expect(attempt([])).toMatchObject({ kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT" });
    const resolutions = resolve(conflicts, { resolution: "SCORE_AS_RANKED", reason: "Traded after freeze; played for SEA" });
    expect(resolutions[0].conflictKind).toBe("TEAM_CHANGED");
    expect(attempt(resolutions)).toEqual({ kind: "RANKED", waiverPoolRank: 2, fpHundredths: 1500, operatorResolutions: resolutions });
  });
});

describe("Precedence — audited D3 NEUTRALIZED over C2 pre-lock invalidation", () => {
  const artifactA = hex("artifact-a");
  const byeConflicts = () =>
    detectSnapshotCanonicalConflicts({
      artifactContentChecksum: artifactA,
      snapshotEntryId: "entry-1",
      snapshot: { isByeAtFreeze: false, teamAtFreeze: "GB" },
      canonical: { participantId: "rb-bye", cls: "SNAPSHOT_CONFLICT", disposition: "BYE", teamKey: "green-bay-packers" },
    });
  const teamConflicts = () =>
    detectSnapshotCanonicalConflicts({
      artifactContentChecksum: artifactA,
      snapshotEntryId: "entry-3",
      snapshot: { isByeAtFreeze: false, teamAtFreeze: "SF" },
      canonical: { participantId: "p", cls: "RANKED", disposition: "PLAYED", teamKey: "seattle-seahawks" },
    });
  const resolution = (conflict: SnapshotCanonicalConflict, overrides: Partial<SnapshotCanonicalConflictResolution> = {}): SnapshotCanonicalConflictResolution => ({
    conflictKey: conflict.conflictKey,
    conflictKind: conflict.kind,
    resolution: "NEUTRALIZED",
    resolvedByUserId: "admin-1",
    resolvedAt: "2026-10-06T15:04:05.000Z",
    reason: "Snapshot schedule contradicted by league record",
    ...overrides,
  });
  const invalidatedBye = (resolutions: SnapshotCanonicalConflictResolution[]) =>
    resolveCanonicalCallTreatment({ cls: "SNAPSHOT_CONFLICT", reason: "BYE", ranked: null, invalidatedPreLock: true, conflicts: byeConflicts(), resolutions });
  const invalidatedTeam = (resolutions: SnapshotCanonicalConflictResolution[]) =>
    resolveCanonicalCallTreatment({
      cls: "RANKED",
      reason: "PARTICIPATED_WITH_STATS",
      ranked: { waiverPoolRank: 2, fpHundredths: 1500 },
      invalidatedPreLock: true,
      conflicts: teamConflicts(),
      resolutions,
    });

  it("neutralizes the invalidated call and preserves both the invalidation and the full D3 record", () => {
    const resolutions = [resolution(byeConflicts()[0])];
    const treatment = invalidatedBye(resolutions);
    expect(treatment).toEqual({
      kind: "NEUTRALIZED",
      reason: "operator-resolved conflict",
      invalidatedPreLock: true,
      precedence: "D3_NEUTRALIZATION_OVER_C2_INVALIDATION",
      operatorResolutions: resolutions,
    });
    expect(evaluated(board([ranked(1, 2810), treatment, ranked(3, 1940)])).calls[1]).toEqual({
      slot: 2,
      treatment: "NEUTRALIZED",
      scored: false,
      rawPoints: null,
      fpHundredths: null,
      exactSlotHit: false,
      honorCreditEligible: false,
      invalidatedPreLock: true,
      precedence: "D3_NEUTRALIZATION_OVER_C2_INVALIDATION",
      operatorResolutions: resolutions,
    });
  });

  it("applies to a resolved TEAM_CHANGED conflict as well", () => {
    expect(invalidatedTeam([resolution(teamConflicts()[0])])).toMatchObject({ kind: "NEUTRALIZED", precedence: "D3_NEUTRALIZATION_OVER_C2_INVALIDATION" });
  });

  it("scores exactly like ordinary neutralization, keeping the original slot (no compaction or replacement)", () => {
    const d3 = evaluated(board([ranked(1, 2810), invalidatedBye([resolution(byeConflicts()[0])]), ranked(3, 1940)]));
    const plain = evaluated(board([ranked(1, 2810), cancelled, ranked(3, 1940)]));
    expect({ ...d3, calls: undefined }).toEqual({ ...plain, calls: undefined });
    expect(d3).toMatchObject({ neutralizedSlots: [2], effectiveAvailableSlots: 2, earnedRawPoints: 56, maxRawPoints: 56, eyeqHundredths: 10000, fpPerCallHundredths: 2375, fpPerAvailableSlotHundredths: 2375 });
    expect(d3.calls.map((call) => call.slot)).toEqual([1, 2, 3]);
    expect(d3.calls[2]).toMatchObject({ slot: 3, exactSlotHit: true });
  });

  it("keeps C2 zero scoring for an invalidated call resolved as SCORE_AS_RANKED, with the D3 record attached", () => {
    const resolutions = [resolution(teamConflicts()[0], { resolution: "SCORE_AS_RANKED" })];
    const treatment = invalidatedTeam(resolutions);
    expect(treatment).toEqual({ kind: "INVALIDATED_PRE_LOCK", operatorResolutions: resolutions });
    expect(evaluated(board([ranked(1, 2810), treatment])).calls[1]).toMatchObject({
      scored: true,
      rawPoints: 0,
      fpHundredths: 0,
      invalidatedPreLock: true,
      precedence: null,
      operatorResolutions: resolutions,
    });
  });

  it("keeps C2 zero scoring for an invalidated call resolved as NON_PARTICIPANT_ZERO, with the D3 record attached", () => {
    const resolutions = [resolution(byeConflicts()[0], { resolution: "NON_PARTICIPANT_ZERO" })];
    const treatment = invalidatedBye(resolutions);
    expect(treatment).toEqual({ kind: "INVALIDATED_PRE_LOCK", operatorResolutions: resolutions });
    expect(evaluated(board([ranked(1, 2810), treatment])).calls[1]).toMatchObject({ scored: true, rawPoints: 0, fpHundredths: 0, precedence: null });
  });

  it("never applies D3 precedence without an accepted NEUTRALIZED resolution", () => {
    const [conflict] = byeConflicts();
    expect(invalidatedBye([])).toMatchObject({ kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT" });
    expect(invalidatedBye([resolution(conflict, { reason: " " })])).toMatchObject({ kind: "BLOCKED" });
    expect(invalidatedBye([resolution(conflict, { resolvedByUserId: "" })])).toMatchObject({ kind: "BLOCKED" });
    expect(invalidatedBye([resolution(conflict, { resolvedAt: "not-a-time" })])).toMatchObject({ kind: "BLOCKED" });
    expect(invalidatedBye([resolution(conflict, { conflictKind: "TEAM_CHANGED" })])).toMatchObject({ kind: "BLOCKED" });
    expect(invalidatedBye([resolution(conflict, { conflictKey: hex("other") })])).toMatchObject({ kind: "BLOCKED" });

    const base = { ranked: null, conflicts: [], resolutions: [resolution(conflict)] };
    expect(resolveCanonicalCallTreatment({ ...base, cls: "NON_PARTICIPANT", reason: "DNP", invalidatedPreLock: true })).toEqual({ kind: "INVALIDATED_PRE_LOCK" });
    expect(resolveCanonicalCallTreatment({ ...base, cls: "RANKED", reason: "", ranked: { waiverPoolRank: 1, fpHundredths: 900 }, invalidatedPreLock: true })).toEqual({
      kind: "INVALIDATED_PRE_LOCK",
    });

    const notInvalidated = resolveCanonicalCallTreatment({ cls: "SNAPSHOT_CONFLICT", reason: "BYE", ranked: null, invalidatedPreLock: false, conflicts: [conflict], resolutions: [resolution(conflict)] });
    expect(notInvalidated).not.toHaveProperty("precedence");
    expect(evaluated(board([notInvalidated])).calls[0]).toMatchObject({ invalidatedPreLock: false, precedence: null });
  });
});

describe("resolveCanonicalCallTreatment", () => {
  const base = { reason: "", ranked: null, invalidatedPreLock: false, conflicts: [], resolutions: [] };

  it("never turns a missing canonical row into zero", () => {
    expect(resolveCanonicalCallTreatment({ ...base, cls: null })).toMatchObject({ kind: "BLOCKED", code: "CANONICAL_RESULT_MISSING" });
  });

  it("maps classes to the approved treatments", () => {
    expect(resolveCanonicalCallTreatment({ ...base, cls: "RANKED", ranked: { waiverPoolRank: 1, fpHundredths: 0 } })).toEqual(ranked(1, 0));
    expect(resolveCanonicalCallTreatment({ ...base, cls: "NON_PARTICIPANT", reason: "DNP" })).toEqual(dnp);
    expect(resolveCanonicalCallTreatment({ ...base, cls: "SYSTEMIC_NEUTRALIZE", reason: "CANCELLED_GAME" })).toEqual(cancelled);
    expect(resolveCanonicalCallTreatment({ ...base, cls: "BLOCKED", reason: "x" })).toMatchObject({ kind: "BLOCKED", code: "CANONICAL_RESULT_BLOCKED" });
    expect(resolveCanonicalCallTreatment({ ...base, cls: "SNAPSHOT_CONFLICT", reason: "BYE" })).toMatchObject({ kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT" });
  });

  it("applies C2 to invalidated calls and lets systemic D2 take precedence", () => {
    expect(resolveCanonicalCallTreatment({ ...base, cls: "RANKED", ranked: { waiverPoolRank: 1, fpHundredths: 2000 }, invalidatedPreLock: true })).toEqual({
      kind: "INVALIDATED_PRE_LOCK",
    });
    expect(resolveCanonicalCallTreatment({ ...base, cls: "SYSTEMIC_NEUTRALIZE", reason: "CANCELLED_GAME", invalidatedPreLock: true })).toEqual({
      kind: "NEUTRALIZED",
      reason: "CANCELLED_GAME",
      invalidatedPreLock: true,
      precedence: "D2_NEUTRALIZATION_OVER_C2_INVALIDATION",
    });
  });
});

describe("Perfect honors with D1 and neutralized calls", () => {
  const wr = (treatments: CanonicalCallTreatment[]) => board(treatments, 5, 5);
  const honor = (result: CanonicalBoardEvaluation) => evaluated(result).perfectHonor;

  it("keeps the base definitions: partial exact boards are Perfect Call; full exact boards are Perfect Podium / Perfect Five", () => {
    expect(honor(board([ranked(1, 2810)]))).toBe("PERFECT_CALL");
    expect(honor(board([ranked(1, 2810), ranked(2, 2000)]))).toBe("PERFECT_CALL");
    expect(honor(board([ranked(1, 2810), ranked(2, 2000), ranked(3, 1940)]))).toBe("PERFECT_PODIUM");
    expect(honor(wr([ranked(1, 3000), ranked(2, 2500), ranked(3, 2000)]))).toBe("PERFECT_CALL");
    expect(honor(wr([ranked(1, 3000), ranked(2, 2500), ranked(3, 2000), ranked(4, 1500)]))).toBe("PERFECT_CALL");
    expect(honor(wr([ranked(1, 3000), ranked(2, 2500), ranked(3, 2000), ranked(4, 1500), ranked(5, 1000)]))).toBe("PERFECT_FIVE");
    expect(honor(board([ranked(2, 2000), ranked(1, 2810)]))).toBeNull();
    expect(honor(board([]))).toBeNull();
  });

  it("denies every perfect honor when a D1 or C2 call is on the board", () => {
    expect(honor(board([ranked(1, 2810), dnp, ranked(3, 1940)]))).toBeNull();
    expect(honor(board([ranked(1, 2810), { kind: "INVALIDATED_PRE_LOCK" }]))).toBeNull();
    expect(honor(wr([ranked(1, 3000), ranked(2, 2500), ranked(3, 2000), ranked(4, 1500), dnp]))).toBeNull();
  });

  it("does not grant Perfect Podium when a required Top-3 call is neutralized; the rest can earn Perfect Call", () => {
    for (const treatments of [
      [cancelled, ranked(2, 2000), ranked(3, 1940)],
      [ranked(1, 2810), cancelled, ranked(3, 1940)],
      [ranked(1, 2810), ranked(2, 2000), moved],
    ]) {
      const result = evaluated(board(treatments));
      expect(result.perfectHonor).toBe("PERFECT_CALL");
      expect(result.eyeqHundredths).toBe(10000);
    }
  });

  it("does not grant Perfect Five when any WR call is neutralized; the rest can earn Perfect Call", () => {
    expect(honor(wr([ranked(1, 3000), ranked(2, 2500), ranked(3, 2000), ranked(4, 1500), cancelled]))).toBe("PERFECT_CALL");
    expect(honor(wr([cancelled, ranked(2, 2500), ranked(3, 2000), ranked(4, 1500), ranked(5, 1000)]))).toBe("PERFECT_CALL");
  });

  it("treats a neutralized call as no miss: an inexact scored call still denies Perfect Call", () => {
    expect(honor(board([ranked(1, 2810), cancelled, ranked(2, 1940)]))).toBeNull();
  });

  it("awards nothing when every submitted call is neutralized", () => {
    expect(evaluated(board([cancelled, moved, cancelled]))).toMatchObject({
      allNeutralized: true,
      eyeqHundredths: null,
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: null,
      perfectHonor: null,
    });
    expect(honor(wr([cancelled, cancelled, cancelled, cancelled, cancelled]))).toBeNull();
  });

  it("applies the same rules to a D2-over-C2 precedence call", () => {
    const precedence = resolveCanonicalCallTreatment({ cls: "SYSTEMIC_NEUTRALIZE", reason: "MOVED_OUT_OF_WEEK", ranked: null, invalidatedPreLock: true, conflicts: [], resolutions: [] });
    expect(honor(board([ranked(1, 2810), ranked(2, 2000), precedence]))).toBe("PERFECT_CALL");
  });

  it("fails closed on a result field without a perfect-honor rule", () => {
    expect(() => canonicalPerfectHonor([], 4)).toThrow(WaiverScoringError);
  });
});

describe("evaluateCanonicalWaiverBoard input guards", () => {
  it("requires contiguous slots within the available depth", () => {
    expect(() => evaluateCanonicalWaiverBoard({ calls: [{ slot: 2, treatment: dnp }], availableSlots: 3, resultFieldSize: 3 })).toThrow(WaiverScoringError);
    expect(() => board([dnp, dnp, dnp, dnp])).toThrow(WaiverScoringError);
    expect(() => board([], 4, 3)).toThrow(WaiverScoringError);
  });
});
