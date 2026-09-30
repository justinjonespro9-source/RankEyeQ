import { describe, expect, it } from "vitest";
import { assembleWaiverCorrectionPreview, type WaiverCorrectionContext, type WaiverCorrectionRequest } from "@/lib/waivers/snapshot/correct-model";
import type { WaiverEntryFacts } from "@/lib/waivers/snapshot/eligibility";
import { buildWaiverPreviewEntry } from "@/lib/waivers/snapshot/preview-model";

const NOW = new Date("2026-10-06T15:00:00.000Z");
const KICKOFF = new Date("2026-10-09T00:15:00.000Z");
const games = [{ id: "g1", homeTeam: "SF", awayTeam: "SEA", startsAt: KICKOFF, status: "SCHEDULED" as const }];

function facts(id: string, team: string | null, extra: Partial<WaiverEntryFacts> = {}): WaiverEntryFacts {
  return {
    rankableEntryId: id,
    canonicalName: `Player ${id}`,
    canonicalTeam: team,
    roster: team ? { team, activeOnNFLRoster: true, nflStatus: "ACT" } : null,
    game: team === "SF" || team === "SEA" ? { kind: "GAME", gameId: "g1", opponent: team === "SF" ? "SEA" : "SF", kickoff: KICKOFF, status: "SCHEDULED" } : { kind: "BYE" },
    availability: { designation: "UNKNOWN", selectable: true, rosterStatus: "ACTIVE", unavailableReason: null, source: "NO_WEEK_ROW" },
    ...extra,
  };
}

function entry(id: string, bps: number, line: number, extra: { tracked?: boolean; team?: string } = {}) {
  return buildWaiverPreviewEntry({
    rankableEntryId: id,
    position: "WR",
    rosteredBps: bps,
    sourceLabel: "Sleeper",
    sourceUrl: null,
    observedAt: new Date("2026-10-06T14:00:00.000Z"),
    inputLineNumber: line,
    inputLine: `Player ${id} | WR | SF | ${bps / 100}`,
    matchMethod: "EXACT_NAME_TEAM",
    sourceTeam: extra.team ?? "SF",
    teamConflict: false,
    tracked: extra.tracked ?? false,
    thresholdBps: 5000,
    facts: facts(id, extra.team ?? "SF"),
  });
}

function context(overrides: Partial<WaiverCorrectionContext> = {}): WaiverCorrectionContext {
  return {
    now: NOW,
    base: {
      id: "s1",
      weekId: "w1",
      version: 1,
      thresholdBps: 5000,
      sourceLabel: "Sleeper",
      sourceUrl: null,
      observedAt: new Date("2026-10-06T14:00:00.000Z"),
      originalFrozenAt: new Date("2026-10-06T14:30:00.000Z"),
      entries: [entry("a", 1000, 1), entry("b", 2000, 2), entry("t", 4000, 3, { tracked: true })],
      missingContextIds: [],
    },
    games,
    contests: [],
    trackedIds: new Set(["t"]),
    rematchTargets: new Map(),
    addParse: null,
    addMatched: [],
    addFactsById: new Map(),
    ...overrides,
  };
}

const request = (ops: WaiverCorrectionRequest["ops"], reason = "fix"): WaiverCorrectionRequest => ({ snapshotId: "s1", reason, ops });

describe("assembleWaiverCorrectionPreview", () => {
  it("is deterministic and re-derives the tracked role from frozen context", () => {
    const req = request([{ kind: "SET_ROSTERED", rankableEntryId: "t", percent: "50" }]);
    const one = assembleWaiverCorrectionPreview(req, context());
    const two = assembleWaiverCorrectionPreview(req, context());
    expect(one.correctionFingerprint).toBe(two.correctionFingerprint);
    const corrected = one.entries.find((e) => e.rankableEntryId === "t")!;
    expect(corrected).toMatchObject({ evidenceRole: "FOLLOW_UP", eligibility: "OBSERVATION_ONLY", rosteredBps: 5000 });
    expect(one.counts).toMatchObject({ candidateCount: 2, followUpCount: 1 });
    expect(one.changes.map((c) => c.field).sort()).toEqual(["eligibility", "evidenceRole", "rosteredBps"]);
  });

  it("blocks conflicting, unknown, no-op and invalid corrections", () => {
    const codes = (ops: WaiverCorrectionRequest["ops"], reason?: string) =>
      assembleWaiverCorrectionPreview(request(ops, reason), context()).blockers.map((b) => b.code).sort();
    expect(codes([{ kind: "REMOVE", rankableEntryId: "a" }, { kind: "SET_ROSTERED", rankableEntryId: "a", percent: "3" }])).toEqual(["CONFLICTING_OPERATIONS"]);
    expect(codes([{ kind: "REMOVE", rankableEntryId: "zz" }])).toEqual(["ENTRY_NOT_FOUND"]);
    expect(codes([{ kind: "SET_ROSTERED", rankableEntryId: "a", percent: "10" }])).toEqual(["NO_CHANGES"]);
    expect(codes([{ kind: "SET_ROSTERED", rankableEntryId: "a", percent: "10.555" }])).toEqual(["INVALID_PERCENT"]);
    expect(codes([{ kind: "SET_TEAM_GAME", rankableEntryId: "a", team: "XYZ" }])).toEqual(["INVALID_TEAM"]);
    expect(codes([{ kind: "SET_AVAILABILITY", rankableEntryId: "a", designation: "OUT", hardUnavailable: true, evidence: " " }])).toEqual(["AVAILABILITY_EVIDENCE_MISSING"]);
    expect(codes([{ kind: "REMATCH", rankableEntryId: "a", toRankableEntryId: "missing" }])).toEqual(["REMATCH_TARGET_NOT_FOUND"]);
    expect(codes([{ kind: "REMOVE", rankableEntryId: "a" }], "  ")).toEqual(["REASON_MISSING"]);
    expect(codes([])).toEqual(["NO_OPERATIONS"]);
    expect(assembleWaiverCorrectionPreview(request([{ kind: "REMOVE", rankableEntryId: "a" }]), context({ base: { ...context().base, missingContextIds: ["x"] } })).blockers.map((b) => b.code)).toContain(
      "FROZEN_FACTS_UNAVAILABLE",
    );
  });

  it("team/game correction re-resolves the game from the schedule (bye when the team has no game)", () => {
    const preview = assembleWaiverCorrectionPreview(request([{ kind: "SET_TEAM_GAME", rankableEntryId: "a", team: "DAL" }]), context());
    expect(preview.entries[0]).toMatchObject({ teamAtFreeze: "DAL", isByeAtFreeze: true, eligibility: "EXCLUDED", exclusionReason: "BYE", nflGameId: null, teamConflict: true });
    expect(preview.requiredAcknowledgments).toContain("TEAM_CONFLICT");
  });

  it("classifies contest impact: open boards are flagged; after lock every pool change needs a policy decision", () => {
    const board = { submissionId: "sub1", calls: [{ callId: "c1", rankableEntryId: "a" }, { callId: "c2", rankableEntryId: "b" }] };
    const open = assembleWaiverCorrectionPreview(
      request([{ kind: "REMOVE", rankableEntryId: "a" }, { kind: "SET_ROSTERED", rankableEntryId: "b", percent: "21" }]),
      context({ contests: [{ contestId: "k1", position: "WR", locksAt: new Date(NOW.getTime() + 3_600_000), snapshotId: "s1", submissionCount: 1, boards: [board] }] }),
    );
    expect(open.correctionCase).toBe("OPEN_WITH_SUBMISSIONS");
    expect(open.contests[0]).toMatchObject({ willRepin: true, affectedCallIds: ["c1"] });
    expect(open.changes.find((c) => c.rankableEntryId === "a")).toMatchObject({ field: "ROW_REMOVED", policy: "AFFECTED_BOARDS_FLAGGED", affectedCallIds: ["c1"] });
    expect(open.changes.find((c) => c.rankableEntryId === "b")).toMatchObject({ policy: "NO_BOARD_EFFECT", affectedCallIds: [] });

    const locked = assembleWaiverCorrectionPreview(
      request([{ kind: "SET_ROSTERED", rankableEntryId: "b", percent: "21" }, { kind: "SET_ROSTERED", rankableEntryId: "a", percent: "60" }]),
      context({ contests: [{ contestId: "k1", position: "WR", locksAt: new Date(NOW.getTime() - 1), snapshotId: "s0", submissionCount: 1, boards: [board] }] }),
    );
    expect(locked.correctionCase).toBe("POST_LOCK");
    expect(locked.contests[0]).toMatchObject({ willRepin: false, pinnedToBase: false });
    expect(locked.changes.filter((c) => c.rankableEntryId === "a").every((c) => c.policy === "POLICY_DECISION_REQUIRED")).toBe(true);
    expect(locked.changes.filter((c) => c.rankableEntryId === "b").every((c) => c.policy === "NO_BOARD_EFFECT")).toBe(true);
    expect(locked.requiredAcknowledgments).toEqual(expect.arrayContaining(["POLICY_DECISION_REQUIRED", "POST_LOCK_RECORD_ONLY"]));
  });
});
