import { describe, expect, it } from "vitest";
import { resolvePlayerWeekStatus } from "@/lib/eligibility/player-week-availability";
import { ROSTER_STALE_AFTER_MS } from "@/lib/nfl/roster-status-sync";
import { computeWaiverCompleteness } from "@/lib/waivers/snapshot/completeness";
import {
  canonicalWaiverTeam,
  resolveWaiverGame,
  waiverAvailabilityFact,
  type WaiverEntryFacts,
  type WaiverWeekGame,
} from "@/lib/waivers/snapshot/eligibility";
import { parseWaiverInput } from "@/lib/waivers/snapshot/input";
import { buildWaiverMatchIndex, type WaiverMatchCandidate } from "@/lib/waivers/snapshot/match";
import {
  assembleWaiverSnapshotPreview,
  matchedWaiverEntryIds,
  matchWaiverInputRows,
  validateWaiverAcknowledgments,
  WAIVER_ROSTER_STALE_AFTER_MS,
  type WaiverPreviewContext,
} from "@/lib/waivers/snapshot/preview-model";

const NOW = new Date("2026-10-06T15:00:00Z"); // Tuesday 10:00 CT
const OBSERVED = new Date("2026-10-06T14:30:00Z");
const KICKOFF = new Date("2026-10-11T17:00:00Z"); // Sunday → lock Tue 2026-10-06 19:00 CT

const games: WaiverWeekGame[] = [
  { id: "g_sf", homeTeam: "SF", awayTeam: "SEA", startsAt: KICKOFF, status: "SCHEDULED" },
  { id: "g_kc", homeTeam: "KC", awayTeam: "LV", startsAt: KICKOFF, status: "POSTPONED" },
  { id: "g_buf", homeTeam: "BUF", awayTeam: "MIA", startsAt: KICKOFF, status: "SCHEDULED" },
  { id: "g_lac", homeTeam: "LAC", awayTeam: "DEN", startsAt: KICKOFF, status: "SCHEDULED" },
];

type Spec = { id: string; name: string; position: WaiverMatchCandidate["position"]; team: string | null; nflStatus?: string; designation?: "AVAILABLE" | "QUESTIONABLE" | "OUT" };
const specs: Spec[] = [
  { id: "qb1", name: "Quarter Back", position: "QB", team: "SF" },
  { id: "qb2", name: "Second Quarter", position: "QB", team: "KC", designation: "QUESTIONABLE" },
  { id: "rb1", name: "Running Back", position: "RB", team: "SEA" },
  { id: "rb2", name: "Hurt Back", position: "RB", team: "BUF", nflStatus: "IR" },
  { id: "wr1", name: "Wide One", position: "WR", team: "MIA" },
  { id: "wr2", name: "Wide Two", position: "WR", team: "LAC" },
  { id: "wr3", name: "Bye Receiver", position: "WR", team: "DAL" },
  { id: "wr4", name: "Traded Receiver", position: "WR", team: "DEN" },
  { id: "te1", name: "Tight End", position: "TE", team: "LV" },
  { id: "def_sf", name: "49ers", position: "DEF", team: "SF" },
  { id: "tracked1", name: "Tracked Graduate", position: "RB", team: "SF" },
  { id: "tracked2", name: "Tracked Missing", position: "TE", team: "SF" },
];

const universe: WaiverMatchCandidate[] = specs.map((s) => ({
  id: s.id,
  name: s.name,
  position: s.position,
  adminNotes: null,
  type: s.position === "DEF" ? "DEFENSE" : "PLAYER",
  canonicalTeam: s.team,
  onSeasonRoster: true,
}));

function factsFor(ids: string[]): Map<string, WaiverEntryFacts> {
  return new Map(
    ids.map((id) => {
      const s = specs.find((spec) => spec.id === id)!;
      const team = canonicalWaiverTeam(s.team, null);
      const resolved = resolvePlayerWeekStatus({ nflStatus: s.nflStatus ?? "ACTIVE", weekDesignation: s.designation ?? "AVAILABLE" });
      return [
        id,
        {
          rankableEntryId: id,
          canonicalName: s.name,
          canonicalTeam: team,
          roster: { team, activeOnNFLRoster: true, nflStatus: s.nflStatus ?? "ACTIVE" },
          game: resolveWaiverGame(team, games),
          availability: waiverAvailabilityFact(resolved, true),
        },
      ];
    }),
  );
}

const context = (overrides: Partial<WaiverPreviewContext> = {}): WaiverPreviewContext => ({
  now: NOW,
  week: { id: "week5", seasonId: "s", weekNumber: 5 },
  thresholdBps: 5000,
  games,
  currentSnapshot: null,
  rosterSyncedAt: new Date(NOW.getTime() - 3_600_000),
  tracked: [
    { rankableEntryId: "tracked1", name: "Tracked Graduate", position: "RB", lastObservedBps: 4300, lastObservedWeekNumber: 4 },
    { rankableEntryId: "tracked2", name: "Tracked Missing", position: "TE", lastObservedBps: 2100, lastObservedWeekNumber: 4 },
  ],
  rankingsPool: [
    { rankableEntryId: "qb1", name: "Quarter Back", position: "QB" },
    { rankableEntryId: "qb_unseen", name: "Unseen QB", position: "QB" },
  ],
  previousWeekNumber: 4,
  previousEligible: [{ rankableEntryId: "wr_gone", name: "Gone Receiver", position: "WR" }],
  ...overrides,
});

const CLEAN_PASTE = [
  "Player | Pos | Team | Rostered%",
  "Quarter Back | QB | SF | 12",
  "Second Quarter | QB | KC | 30",
  "Running Back | RB | SEA | 49.99",
  "Hurt Back | RB | BUF | 5",
  "Wide One | WR | MIA | 50",
  "Wide Two | WR | LAC | 8",
  "Bye Receiver | WR | DAL | 3",
  "Traded Receiver | WR | LAC | 4",
  "Tight End | TE | LV | 10",
  "Niners D/ST | DEF | SF | 20",
  "Tracked Graduate | RB | SF | 67",
].join("\n");

function preview(text = CLEAN_PASTE, ctx = context(), form: Partial<{ sourceLabel: string; sourceUrl: string | null; observedAt: Date | null }> = {}) {
  const parse = parseWaiverInput(text);
  const index = buildWaiverMatchIndex(universe);
  const matched = matchWaiverInputRows(parse.rows, index);
  return assembleWaiverSnapshotPreview({
    form: { weekId: "week5", sourceLabel: "Sleeper", sourceUrl: "https://sleeper.example/players", observedAt: OBSERVED, ...form },
    parse,
    matched,
    factsById: factsFor(matchedWaiverEntryIds(matched)),
    context: ctx,
  });
}

describe("assembleWaiverSnapshotPreview", () => {
  it("derives every entry with copied facts and exact counts", () => {
    const p = preview();
    expect(p.blockers).toEqual([]);
    const byId = new Map(p.entries.map((entry) => [entry.rankableEntryId, entry]));
    expect(byId.get("qb1")).toMatchObject({ eligibility: "ELIGIBLE", nflGameId: "g_sf", opponentAtFreeze: "SEA", teamAtFreeze: "SF" });
    expect(byId.get("qb2")).toMatchObject({ eligibility: "ELIGIBLE", availabilityDesignationAtFreeze: "QUESTIONABLE", gameStatusAtFreeze: "POSTPONED" });
    expect(byId.get("rb1")).toMatchObject({ eligibility: "ELIGIBLE", rosteredBps: 4999 });
    expect(byId.get("rb2")).toMatchObject({ eligibility: "EXCLUDED", exclusionReason: "HARD_UNAVAILABLE", hardUnavailableAtFreeze: true });
    expect(byId.get("wr1")).toMatchObject({ eligibility: "EXCLUDED", exclusionReason: "AT_OR_ABOVE_THRESHOLD", evidenceRole: "CANDIDATE" });
    expect(byId.get("wr3")).toMatchObject({ eligibility: "EXCLUDED", exclusionReason: "BYE", isByeAtFreeze: true });
    expect(byId.get("wr4")).toMatchObject({ teamConflict: true, sourceTeam: "LAC", teamAtFreeze: "DEN", opponentAtFreeze: "LAC" });
    expect(byId.get("tracked1")).toMatchObject({ evidenceRole: "FOLLOW_UP", eligibility: "OBSERVATION_ONLY", exclusionReason: null });
    expect(byId.get("def_sf")).toMatchObject({ matchMethod: "EXACT_NAME_TEAM", inputLine: "Niners D/ST | DEF | SF | 20" });
    expect(p.counts).toEqual({ candidateCount: 10, eligibleCount: 7, excludedCount: 3, followUpCount: 1 });
    expect(p.header.observedAt).toEqual(OBSERVED);
    expect(p.locksAt?.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(p.contestsCanOpen).toBe(true);
  });

  it("requires confirmations for team conflict, reduced depth, and missing tracked follow-ups (no invented thresholds)", () => {
    const p = preview();
    expect(p.requiredAcknowledgments).toEqual([
      "MISSING_FOLLOW_UP",
      "REDUCED_DEPTH:DEF",
      "REDUCED_DEPTH:QB",
      "REDUCED_DEPTH:RB",
      "REDUCED_DEPTH:TE",
      "REDUCED_DEPTH:WR",
      "SOURCE_COMPLETE_ATTESTATION",
      "TEAM_CONFLICT",
    ]);
    expect(p.missingFollowUps.map((player) => player.rankableEntryId)).toEqual(["tracked2"]);
    expect(p.issues.find((issue) => issue.code === "TEAM_CONFLICT")?.lineNumbers).toEqual([9]);
    const qb = p.completeness.byPosition.find((row) => row.position === "QB")!;
    expect(qb).toMatchObject({ rankingsPoolCount: 2, rankingsPoolObserved: 1, rankingsPoolUnobservedBps: 5000, eligible: 2, effectiveMaxCalls: 2 });
    expect(p.completeness.previousWeekEligibleMissing.map((player) => player.rankableEntryId)).toEqual(["wr_gone"]);
    expect(p.issues.filter((issue) => issue.level === "CONFIRM").map((issue) => issue.code)).not.toContain("COVERAGE");
  });

  it("zero eligible at a position is a confirmation, not a blocker", () => {
    const p = preview(CLEAN_PASTE.replace("Niners D/ST | DEF | SF | 20", "Niners D/ST | DEF | SF | 70"));
    expect(p.requiredAcknowledgments).toContain("ZERO_ELIGIBLE:DEF");
    expect(p.blockers).toEqual([]);
  });

  it("blocks unmatched, ambiguous, duplicate, invalid, position-mismatch and ID-mismatch rows", () => {
    const text = [
      "Nobody Known | WR | SF | 3",
      "Quarter Back | QB | SF | 12",
      "Quarter Back | QB | SF | 13",
      "Wide One | WR | MIA | 49.995",
      "Tight End | QB | LV | 3",
      "Wide Two | WR | LAC | 3 | qb1",
    ].join("\n");
    const p = preview(text);
    expect(p.rows.map((row) => row.state)).toEqual(["UNMATCHED", "DUPLICATE", "DUPLICATE", "INVALID", "POSITION_MISMATCH", "ID_MISMATCH"]);
    expect(p.blockers.map((issue) => issue.code).sort()).toEqual(
      ["ROWS_DUPLICATE", "ROWS_ID_MISMATCH", "ROWS_INVALID", "ROWS_POSITION_MISMATCH", "ROWS_UNMATCHED"].sort(),
    );
  });

  it("blocks missing source label, missing or future observation, an existing snapshot and no schedule", () => {
    expect(preview(CLEAN_PASTE, context(), { sourceLabel: " " }).blockers.map((b) => b.code)).toContain("SOURCE_LABEL_MISSING");
    expect(preview(CLEAN_PASTE, context(), { observedAt: null }).blockers.map((b) => b.code)).toContain("OBSERVED_AT_MISSING");
    expect(preview(CLEAN_PASTE, context(), { observedAt: new Date(NOW.getTime() + 60_000) }).blockers.map((b) => b.code)).toContain(
      "OBSERVED_AT_FUTURE",
    );
    expect(preview(CLEAN_PASTE, context({ currentSnapshot: { id: "snap", version: 1 } })).blockers.map((b) => b.code)).toContain(
      "SNAPSHOT_EXISTS",
    );
    expect(preview(CLEAN_PASTE, context({ games: [] })).blockers.map((b) => b.code)).toContain("NO_SCHEDULE");
    expect(preview("").blockers.map((b) => b.code)).toContain("INPUT_EMPTY");
  });

  it("flags a missing URL, stale roster sync and an elapsed lock as confirmations", () => {
    const p = preview(CLEAN_PASTE, context({ now: new Date("2026-10-07T01:00:00Z"), rosterSyncedAt: null }), { sourceUrl: null });
    expect(p.requiredAcknowledgments).toEqual(expect.arrayContaining(["SOURCE_URL_MISSING", "STALE_ROSTER_SYNC", "AFTER_LOCK"]));
    expect(p.contestsCanOpen).toBe(false);
  });

  it("per-row source/observed overrides are evidence; header observation is the latest row observation", () => {
    const p = preview(`${CLEAN_PASTE}\nTracked Missing | TE | SF | 55 | | FantasyPros | 2026-10-06 09:45 CT`);
    const row = p.entries.find((entry) => entry.rankableEntryId === "tracked2")!;
    expect(row).toMatchObject({ sourceLabel: "FantasyPros", sourceUrl: null, evidenceRole: "FOLLOW_UP" });
    expect(p.header.observedAt?.toISOString()).toBe("2026-10-06T14:45:00.000Z");
    expect(p.missingFollowUps).toEqual([]);
    expect(preview(`${CLEAN_PASTE}\nTracked Missing | TE | SF | 55 | | X | 2026-10-06 11:00 CT`).rows.at(-1)?.issues).toContain(
      "FUTURE_OBSERVED_AT",
    );
  });

  it("fingerprints are stable and sensitive to facts and input", () => {
    const a = preview();
    expect(preview().previewFingerprint).toBe(a.previewFingerprint);
    expect(preview().entriesFingerprint).toBe(a.entriesFingerprint);
    expect(preview(CLEAN_PASTE.replace("| 12", "| 13")).previewFingerprint).not.toBe(a.previewFingerprint);
    const changedFacts = assembleWaiverSnapshotPreview({
      form: { weekId: "week5", sourceLabel: "Sleeper", sourceUrl: "https://sleeper.example/players", observedAt: OBSERVED },
      parse: parseWaiverInput(CLEAN_PASTE),
      matched: matchWaiverInputRows(parseWaiverInput(CLEAN_PASTE).rows, buildWaiverMatchIndex(universe)),
      factsById: new Map(
        [...factsFor(specs.map((s) => s.id))].map(([id, f]) =>
          id === "qb1" ? [id, { ...f, availability: { ...f.availability, designation: "DOUBTFUL" as const } }] : [id, f],
        ),
      ),
      context: context(),
    });
    expect(changedFacts.previewFingerprint).not.toBe(a.previewFingerprint);
    expect(changedFacts.entriesFingerprint).not.toBe(a.entriesFingerprint);
  });
});

describe("validateWaiverAcknowledgments", () => {
  const p = preview();
  const ackAll = p.requiredAcknowledgments;
  const followUp = [{ rankableEntryId: "tracked2", reason: "SOURCE_HAS_NO_LISTING" as const, note: null }];

  it("accepts the exact required set with per-player follow-up reasons", () => {
    expect(validateWaiverAcknowledgments(p, ackAll, followUp)).toEqual([]);
  });

  it("rejects missing or extra codes and incomplete follow-up acknowledgments", () => {
    expect(validateWaiverAcknowledgments(p, ackAll.slice(1), followUp)[0]).toMatchObject({ code: "UNACKNOWLEDGED" });
    expect(validateWaiverAcknowledgments(p, [...ackAll, "AFTER_LOCK"], followUp)[0]).toMatchObject({ code: "UNEXPECTED_ACKNOWLEDGMENT" });
    expect(validateWaiverAcknowledgments(p, ackAll, [])[0]).toMatchObject({ code: "FOLLOW_UP_ACK_MISSING", rankableEntryIds: ["tracked2"] });
    expect(validateWaiverAcknowledgments(p, ackAll, [...followUp, { rankableEntryId: "qb1", reason: "OTHER", note: "x" }])[0]).toMatchObject({
      code: "FOLLOW_UP_ACK_UNEXPECTED",
    });
    expect(validateWaiverAcknowledgments(p, ackAll, [{ rankableEntryId: "tracked2", reason: "OTHER", note: " " }])[0]).toMatchObject({
      code: "FOLLOW_UP_ACK_INVALID",
    });
  });
});

describe("computeWaiverCompleteness", () => {
  it("reports raw coverage without thresholds", () => {
    const evidence = computeWaiverCompleteness({
      entries: [{ rankableEntryId: "a", position: "TE", evidenceRole: "CANDIDATE", eligibility: "ELIGIBLE" }],
      rankingsPool: [
        { rankableEntryId: "a", name: "A", position: "TE" },
        { rankableEntryId: "b", name: "B", position: "TE" },
        { rankableEntryId: "c", name: "C", position: "TE" },
      ],
      previousWeekNumber: null,
      previousEligible: [],
      tracked: [],
    });
    const te = evidence.byPosition.find((row) => row.position === "TE")!;
    expect(te).toMatchObject({ rankingsPoolObserved: 1, rankingsPoolUnobserved: 2, rankingsPoolObservedBps: 3333, rankingsPoolUnobservedBps: 6666 });
    expect(evidence.byPosition.find((row) => row.position === "DEF")?.rankingsPoolObservedBps).toBeNull();
  });
});

it("roster staleness window matches the Rankings roster-sync constant", () => {
  expect(WAIVER_ROSTER_STALE_AFTER_MS).toBe(ROSTER_STALE_AFTER_MS);
});
