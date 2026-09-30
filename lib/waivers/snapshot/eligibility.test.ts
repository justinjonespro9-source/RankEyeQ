import { describe, expect, it } from "vitest";
import { resolvePlayerWeekStatus } from "@/lib/eligibility/player-week-availability";
import {
  canonicalWaiverTeam,
  deriveWaiverEligibility,
  deriveWaiverEvidenceRole,
  resolveWaiverGame,
  waiverAvailabilityFact,
  type WaiverEntryFacts,
  type WaiverWeekGame,
} from "@/lib/waivers/snapshot/eligibility";

const kickoff = new Date("2026-10-11T17:00:00Z");
const games: WaiverWeekGame[] = [
  { id: "g1", homeTeam: "SF", awayTeam: "SEA", startsAt: kickoff, status: "SCHEDULED" },
  { id: "g2", homeTeam: "KC", awayTeam: "LV", startsAt: kickoff, status: "POSTPONED" },
  { id: "g3", homeTeam: "NYG", awayTeam: "DAL", startsAt: kickoff, status: "CANCELED" },
];

function facts(overrides: Partial<WaiverEntryFacts> & { nflStatus?: string; designation?: "AVAILABLE" | "QUESTIONABLE" | "DOUBTFUL" | "OUT" } = {}): WaiverEntryFacts {
  const resolved = resolvePlayerWeekStatus({ nflStatus: overrides.nflStatus ?? "ACTIVE", weekDesignation: overrides.designation ?? "AVAILABLE" });
  return {
    rankableEntryId: "p1",
    canonicalName: "Player One",
    canonicalTeam: "SF",
    roster: { team: "SF", activeOnNFLRoster: true, nflStatus: overrides.nflStatus ?? "ACTIVE" },
    game: resolveWaiverGame("SF", games),
    availability: waiverAvailabilityFact(resolved, true),
    ...overrides,
  };
}

const derive = (f: WaiverEntryFacts, rosteredBps = 1200, role: "CANDIDATE" | "FOLLOW_UP" = "CANDIDATE") =>
  deriveWaiverEligibility({ role, rosteredBps, thresholdBps: 5000, facts: f });

describe("canonical team and game", () => {
  it("prefers the season roster team and treats FA tokens as no team", () => {
    expect(canonicalWaiverTeam("jac", "SF")).toBe("JAX");
    expect(canonicalWaiverTeam(null, "SEA")).toBe("SEA");
    expect(canonicalWaiverTeam("FA", "SEA")).toBeNull();
  });

  it("POSTPONED is scheduled, CANCELED is no game, unknown codes have no scheduled game", () => {
    expect(resolveWaiverGame("SEA", games)).toEqual({ kind: "GAME", gameId: "g1", opponent: "SF", kickoff, status: "SCHEDULED" });
    expect(resolveWaiverGame("LV", games)).toMatchObject({ kind: "GAME", gameId: "g2", status: "POSTPONED" });
    expect(resolveWaiverGame("DAL", games)).toEqual({ kind: "BYE" });
    expect(resolveWaiverGame("XXX", games)).toEqual({ kind: "NO_SCHEDULED_GAME" });
    expect(resolveWaiverGame(null, games)).toEqual({ kind: "NO_TEAM" });
  });

  it("never guesses when a team is on two games", () => {
    const doubled = [...games, { id: "g4", homeTeam: "SF", awayTeam: "ARI", startsAt: kickoff, status: "SCHEDULED" as const }];
    expect(resolveWaiverGame("SF", doubled)).toEqual({ kind: "AMBIGUOUS", gameIds: ["g1", "g4"] });
  });
});

describe("deriveWaiverEvidenceRole", () => {
  it("tracked ≥ threshold is FOLLOW_UP; tracked below and untracked ≥ are candidates", () => {
    expect(deriveWaiverEvidenceRole({ rosteredBps: 6700, thresholdBps: 5000, tracked: true })).toBe("FOLLOW_UP");
    expect(deriveWaiverEvidenceRole({ rosteredBps: 5000, thresholdBps: 5000, tracked: true })).toBe("FOLLOW_UP");
    expect(deriveWaiverEvidenceRole({ rosteredBps: 4300, thresholdBps: 5000, tracked: true })).toBe("CANDIDATE");
    expect(deriveWaiverEvidenceRole({ rosteredBps: 6700, thresholdBps: 5000, tracked: false })).toBe("CANDIDATE");
  });
});

describe("deriveWaiverEligibility precedence", () => {
  it("49.99% eligible, 50.00% excluded", () => {
    expect(derive(facts(), 4999)).toEqual({ eligibility: "ELIGIBLE", exclusionReason: null, exclusionNote: null });
    expect(derive(facts(), 5000)).toMatchObject({ eligibility: "EXCLUDED", exclusionReason: "AT_OR_ABOVE_THRESHOLD" });
  });

  it("follow-ups are observation-only with no exclusion reason", () => {
    expect(derive(facts(), 6700, "FOLLOW_UP")).toEqual({ eligibility: "OBSERVATION_ONLY", exclusionReason: null, exclusionNote: null });
  });

  it("not on an NFL roster: no season row, inactive roster flag, or no team", () => {
    expect(derive(facts({ roster: null })).exclusionReason).toBe("NOT_ON_NFL_ROSTER");
    expect(derive(facts({ roster: { team: "SF", activeOnNFLRoster: false, nflStatus: "ACTIVE" } })).exclusionReason).toBe("NOT_ON_NFL_ROSTER");
    expect(derive(facts({ canonicalTeam: null, game: { kind: "NO_TEAM" } })).exclusionReason).toBe("NOT_ON_NFL_ROSTER");
  });

  it("bye and no-scheduled-game", () => {
    expect(derive(facts({ canonicalTeam: "DAL", game: resolveWaiverGame("DAL", games) })).exclusionReason).toBe("BYE");
    expect(derive(facts({ game: { kind: "NO_SCHEDULED_GAME" } })).exclusionReason).toBe("NO_SCHEDULED_GAME");
  });

  it.each(["IR", "PRACTICE_SQUAD", "PUP", "SUSPENDED"])("roster %s is hard-unavailable", (nflStatus) => {
    const decision = derive(facts({ nflStatus }));
    expect(decision.exclusionReason).toBe("HARD_UNAVAILABLE");
    expect(decision.exclusionNote).toContain("roster");
  });

  it("weekly OUT is hard-unavailable; QUESTIONABLE and DOUBTFUL stay eligible", () => {
    expect(derive(facts({ designation: "OUT" })).exclusionReason).toBe("HARD_UNAVAILABLE");
    expect(derive(facts({ designation: "QUESTIONABLE" })).eligibility).toBe("ELIGIBLE");
    expect(derive(facts({ designation: "DOUBTFUL" })).eligibility).toBe("ELIGIBLE");
  });

  it("first failure is the reason; the rest are listed in the note", () => {
    const decision = derive(facts({ designation: "OUT", canonicalTeam: "DAL", game: resolveWaiverGame("DAL", games) }), 6000);
    expect(decision.exclusionReason).toBe("AT_OR_ABOVE_THRESHOLD");
    expect(decision.exclusionNote).toContain("Also: BYE, HARD_UNAVAILABLE");
  });
});

describe("waiverAvailabilityFact", () => {
  it("records source provenance or NO_WEEK_ROW", () => {
    const observedAt = new Date("2026-10-05T12:00:00Z");
    const withRow = resolvePlayerWeekStatus({ nflStatus: "ACTIVE", weekDesignation: "OUT", sourceType: "NFL_SYNC", observedAt });
    expect(waiverAvailabilityFact(withRow, true).source).toBe("NFL_SYNC|2026-10-05T12:00:00.000Z|NO_OVERRIDE");
    expect(waiverAvailabilityFact(resolvePlayerWeekStatus({ nflStatus: "ACTIVE" }), false)).toMatchObject({
      source: "NO_WEEK_ROW",
      designation: "UNKNOWN",
      selectable: true,
    });
  });
});
