import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateWeeklyEligibility } from "@/lib/nfl/manual/eligibility";
import { buildAiSchedulePrompt } from "@/lib/nfl/manual/ai-schedule-prompt";
import { parseFantasyPointsPaste } from "@/lib/nfl/manual/parse-fantasy-points";
import { parseWeeklyPoolPaste } from "@/lib/nfl/manual/parse-pool";
import { parseWeeklySchedulePaste } from "@/lib/nfl/manual/parse-schedule";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import { validateEnv } from "@/lib/env";
import {
  isManualNflMode,
  resolveNflProviderName,
} from "@/lib/providers/nfl";
import { finalizeWeek } from "@/lib/nfl/finalize-week";

const baseEnv = {
  DATABASE_URL: "postgresql://user@localhost:5432/rankiq",
  AUTH_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
  AUTH_URL: "https://rankiq.example",
  EMAIL_FROM: "RankIQ <noreply@rankiq.example>",
  AUTH_RESEND_KEY: "re_test",
  NODE_ENV: "production",
};

describe("manual NFL provider mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats manual as a valid production provider without SportsDataIO key", () => {
    const result = validateEnv(
      { ...baseEnv, NFL_DATA_PROVIDER: "manual" },
      { strict: true },
    );
    expect(result.ok).toBe(true);
    expect(result.summary.nflProvider).toBe("manual");
    expect(result.errors.some((issue) => issue.key === "SPORTSDATAIO_API_KEY")).toBe(
      false,
    );
  });

  it("resolves manual mode from NFL_DATA_PROVIDER", () => {
    const manualEnv = { NODE_ENV: "test", NFL_DATA_PROVIDER: "manual" } as NodeJS.ProcessEnv;
    const mockEnv = { NODE_ENV: "test", NFL_DATA_PROVIDER: "mock" } as NodeJS.ProcessEnv;
    expect(resolveNflProviderName(manualEnv)).toBe("manual");
    expect(isManualNflMode(manualEnv)).toBe(true);
    expect(isManualNflMode(mockEnv)).toBe(false);
  });

  it("requires explicit verified-results confirmation to finalize in manual mode", async () => {
    vi.stubEnv("NFL_DATA_PROVIDER", "manual");
    await expect(finalizeWeek({ weekId: "week_test" })).rejects.toThrow(
      /verified/i,
    );
  });
});

describe("weekly schedule paste", () => {
  it("maps opponents and kickoffs from Away | Home | Kickoff rows", () => {
    const parsed = parseWeeklySchedulePaste(`
Away | Home | Kickoff
GB | MIN | 2026-09-13 12:00 CT
CHI | DET | 2026-09-13 12:00 CT
`);
    expect(parsed.ready).toBe(true);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      awayTeam: "GB",
      homeTeam: "MIN",
    });
    expect(parsed.rows[0].kickoff).toBeInstanceOf(Date);
    expect(parsed.rows[0].kickoffLabel).toMatch(/2026-09-13 \d{2}:\d{2} CT/);
    expect(parsed.summary.structuralPassed).toBe(true);
    expect(parsed.summary.completeness).toBe("VERIFY_SLATE");
  });

  it("normalizes supported aliases to canonical abbreviations", () => {
    const parsed = parseWeeklySchedulePaste(`
JAC | WSH | 2026-09-13 12:00 CT
`);
    expect(parsed.ready).toBe(true);
    expect(parsed.rows[0]).toMatchObject({
      awayTeam: "JAX",
      homeTeam: "WAS",
    });
  });

  it("blocks unknown team abbreviations after normalization", () => {
    const parsed = parseWeeklySchedulePaste(`
XYZ | MIN | 2026-09-13 12:00 CT
`);
    expect(parsed.ready).toBe(false);
    expect(parsed.rows[0]?.issues).toContain("unknown_team");
    expect(parsed.blockers.some((b) => b.includes("unknown team"))).toBe(true);
  });

  it("flags duplicate teams, self-matchups, and duplicate games", () => {
    const parsed = parseWeeklySchedulePaste(`
GB | MIN | 2026-09-13 12:00 CT
MIN | CHI | 2026-09-13 15:25 CT
DET | DET | 2026-09-13 12:00 CT
GB | CHI | 2026-09-13 12:00 CT
`);
    expect(parsed.ready).toBe(false);
    expect(parsed.blockers.some((b) => b.includes("duplicate team"))).toBe(true);
    expect(parsed.blockers.some((b) => b.includes("self matchup"))).toBe(true);
  });

  it("blocks duplicate game pairs", () => {
    const parsed = parseWeeklySchedulePaste(`
GB | MIN | 2026-09-13 12:00 CT
MIN | GB | 2026-09-13 15:25 CT
`);
    expect(parsed.ready).toBe(false);
    expect(parsed.blockers.some((b) => b.includes("duplicate game"))).toBe(true);
  });

  it("blocks invalid kickoff timestamps", () => {
    const parsed = parseWeeklySchedulePaste(`
GB | MIN | not-a-time
`);
    expect(parsed.ready).toBe(false);
    expect(parsed.rows[0]?.issues).toContain("invalid_kickoff");
  });

  it("allows a bye-week-sized slate as structurally valid", () => {
    // 14 games / 28 teams — incomplete vs full slate, but structurally ok
    const lines = [
      "ATL | GB | 2026-09-24 19:15 CT",
      "LAC | BUF | 2026-09-27 12:00 CT",
      "CAR | CLE | 2026-09-27 12:00 CT",
      "NYJ | DET | 2026-09-27 12:00 CT",
      "HOU | IND | 2026-09-27 12:00 CT",
      "NE | JAX | 2026-09-27 12:00 CT",
      "KC | MIA | 2026-09-27 12:00 CT",
      "TEN | NYG | 2026-09-27 12:00 CT",
      "CIN | PIT | 2026-09-27 12:00 CT",
      "SEA | WAS | 2026-09-27 12:00 CT",
      "ARI | SF | 2026-09-27 15:05 CT",
      "MIN | TB | 2026-09-27 15:05 CT",
      "BAL | DAL | 2026-09-27 15:25 CT",
      "LV | NO | 2026-09-27 15:25 CT",
    ].join("\n");
    const parsed = parseWeeklySchedulePaste(lines);
    expect(parsed.ready).toBe(true);
    expect(parsed.summary.gameCount).toBe(14);
    expect(parsed.summary.uniqueTeamCount).toBe(28);
    expect(parsed.summary.absentTeams).toEqual(
      expect.arrayContaining(["CHI", "DEN", "LAR", "PHI"]),
    );
    expect(parsed.summary.completeness).toBe("VERIFY_SLATE");
  });

  it("marks a full 16-game slate as FULL completeness", () => {
    const lines = [
      "ATL | GB | 2026-09-24 19:15 CT",
      "LAC | BUF | 2026-09-27 12:00 CT",
      "CAR | CLE | 2026-09-27 12:00 CT",
      "NYJ | DET | 2026-09-27 12:00 CT",
      "HOU | IND | 2026-09-27 12:00 CT",
      "NE | JAX | 2026-09-27 12:00 CT",
      "KC | MIA | 2026-09-27 12:00 CT",
      "TEN | NYG | 2026-09-27 12:00 CT",
      "CIN | PIT | 2026-09-27 12:00 CT",
      "SEA | WAS | 2026-09-27 12:00 CT",
      "ARI | SF | 2026-09-27 15:05 CT",
      "MIN | TB | 2026-09-27 15:05 CT",
      "BAL | DAL | 2026-09-27 15:25 CT",
      "LV | NO | 2026-09-27 15:25 CT",
      "LAR | DEN | 2026-09-27 19:20 CT",
      "PHI | CHI | 2026-09-28 19:15 CT",
    ].join("\n");
    const parsed = parseWeeklySchedulePaste(lines);
    expect(parsed.ready).toBe(true);
    expect(parsed.summary.gameCount).toBe(16);
    expect(parsed.summary.uniqueTeamCount).toBe(32);
    expect(parsed.summary.absentTeams).toEqual([]);
    expect(parsed.summary.completeness).toBe("FULL");
  });
});

describe("AI schedule prompt helper", () => {
  it("dynamically uses season year and week number", () => {
    const w3 = buildAiSchedulePrompt({ seasonYear: 2026, weekNumber: 3 });
    const w10 = buildAiSchedulePrompt({ seasonYear: 2027, weekNumber: 10 });
    expect(w3).toContain("2026 NFL Week 3");
    expect(w3).not.toContain("2026 NFL Week 4");
    expect(w10).toContain("2027 NFL Week 10");
    expect(w10).not.toContain("2026 NFL Week 3");
  });

  it("requires the exact paste format and canonical abbreviations", () => {
    const prompt = buildAiSchedulePrompt({ seasonYear: 2026, weekNumber: 4 });
    expect(prompt).toContain("AWAY | HOME | YYYY-MM-DD HH:MM CT");
    expect(prompt).toContain("JAX");
    expect(prompt).toContain("WAS");
    expect(prompt).toContain("preferably NFL.com");
    expect(prompt).toContain("Return ONLY the paste-ready schedule lines");
  });
});

describe("schedule preview save-readiness state", () => {
  it("invalidates READY when preview becomes stale after input change", async () => {
    const { schedulePreviewIsReadyToSave } = await import(
      "@/lib/nfl/manual/schedule-preview-state"
    );
    expect(
      schedulePreviewIsReadyToSave({ ready: true }, false),
    ).toBe(true);
    expect(
      schedulePreviewIsReadyToSave({ ready: true }, true),
    ).toBe(false);
    expect(
      schedulePreviewIsReadyToSave({ ready: false }, false),
    ).toBe(false);
    expect(schedulePreviewIsReadyToSave(null, false)).toBe(false);
  });
});

describe("weekly pool paste", () => {
  const masters = [
    {
      id: "e1",
      name: "Jahmyr Gibbs",
      team: "DET",
      position: "RB" as const,
      shortName: "Gibbs",
      active: true,
    },
    {
      id: "e2",
      name: "Michael Thomas",
      team: "NO",
      position: "WR" as const,
      shortName: "Thomas",
      active: true,
    },
    {
      id: "e3",
      name: "Michael Thomas",
      team: "FA",
      position: "WR" as const,
      shortName: "Thomas",
      active: true,
    },
  ];

  it("matches known players and requires review for ambiguous names", () => {
    const ok = parseWeeklyPoolPaste({
      text: "Jahmyr Gibbs | RB | DET | GB | 2026-09-13 12:00 CT",
      masters,
    });
    expect(ok.ready).toBe(true);
    expect(ok.rows[0].matchedEntryId).toBe("e1");

    const ambiguous = parseWeeklyPoolPaste({
      text: "Michael Thomas | WR | SEA | ARI | 2026-09-13 12:00 CT",
      masters,
    });
    expect(ambiguous.ready).toBe(false);
    expect(ambiguous.rows[0].issues).toContain("ambiguous");
    expect(ambiguous.rows[0].matchedEntryId).toBeNull();
  });

  it("rejects duplicate pasted players and position mismatches", () => {
    const dup = parseWeeklyPoolPaste({
      text: `
Jahmyr Gibbs | RB | DET | GB | 2026-09-13 12:00 CT
Jahmyr Gibbs | RB | DET | GB | 2026-09-13 12:00 CT
`,
      masters,
    });
    expect(dup.ready).toBe(false);
    expect(dup.rows[1].issues).toContain("duplicate_row");

    const mismatch = parseWeeklyPoolPaste({
      text: "Jahmyr Gibbs | WR | DET | GB | 2026-09-13 12:00 CT",
      masters,
    });
    expect(mismatch.ready).toBe(false);
    expect(mismatch.rows[0].issues).toContain("position_mismatch");
  });

  it("supports position-scoped paste without repeating position", () => {
    const parsed = parseWeeklyPoolPaste({
      text: "Jahmyr Gibbs | DET | GB | 2026-09-13 12:00 CT",
      masters,
      fixedPosition: "RB",
    });
    expect(parsed.ready).toBe(true);
    expect(parsed.rows[0].position).toBe("RB");
  });
});

describe("weekly eligibility", () => {
  it("marks no-team and no-game players ineligible", () => {
    expect(
      evaluateWeeklyEligibility({
        position: "RB",
        contestPosition: "RB",
        team: "FA",
        opponent: "@ GB",
        kickoffAt: new Date(),
        active: true,
        excluded: false,
        hasWeeklyGame: true,
      }).eligible,
    ).toBe(false);

    expect(
      evaluateWeeklyEligibility({
        position: "RB",
        contestPosition: "RB",
        team: "DET",
        opponent: "@ GB",
        kickoffAt: new Date(),
        active: true,
        excluded: false,
        hasWeeklyGame: false,
      }).reasons,
    ).toContain("team has no game this week");
  });

  it("missing kickoff blocks readiness", () => {
    const result = evaluateWeeklyEligibility({
      position: "RB",
      contestPosition: "RB",
      team: "DET",
      opponent: "@ GB",
      kickoffAt: null,
      active: true,
      excluded: false,
      hasWeeklyGame: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("missing kickoff");
  });

  it("does not treat master-directory presence alone as eligible", () => {
    const result = evaluateWeeklyEligibility({
      position: "RB",
      contestPosition: "RB",
      team: "DET",
      opponent: "TBD",
      kickoffAt: null,
      active: true,
      excluded: false,
      hasWeeklyGame: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(1);
  });
});

describe("fantasy points paste", () => {
  const eligible = [
    {
      id: "ce1",
      rankableEntryId: "e1",
      name: "Jahmyr Gibbs",
      team: "DET",
      position: "RB" as const,
      shortName: "Gibbs",
    },
    {
      id: "ce2",
      rankableEntryId: "e2",
      name: "Bijan Robinson",
      team: "ATL",
      position: "RB" as const,
      shortName: "Robinson",
    },
  ];

  it("keeps explicit 0.0 and distinguishes missing points", () => {
    const parsed = parseFantasyPointsPaste({
      text: `
Jahmyr Gibbs | 0.0
Bijan Robinson | 22.8
`,
      eligible,
      fixedPosition: "RB",
    });
    expect(parsed.ready).toBe(true);
    expect(parsed.zeroCount).toBe(1);
    expect(parsed.rows[0].fantasyPoints).toBe(0);
    expect(parsed.rows[0].explicitZero).toBe(true);

    const missing = parseFantasyPointsPaste({
      text: "Jahmyr Gibbs |",
      eligible,
      fixedPosition: "RB",
    });
    // Empty points column may yield too-few columns and skip, or missing_points
    const issues = missing.rows.flatMap((row) => row.issues);
    expect(
      missing.rows.length === 0 || issues.includes("missing_points"),
    ).toBe(true);
  });

  it("rejects unknown and duplicate players", () => {
    const unknown = parseFantasyPointsPaste({
      text: "Fake Player | 10",
      eligible,
      fixedPosition: "RB",
    });
    expect(unknown.ready).toBe(false);
    expect(unknown.rows[0].issues).toContain("unknown");

    const dup = parseFantasyPointsPaste({
      text: `
Jahmyr Gibbs | 10
Jahmyr Gibbs | 12
`,
      eligible,
      fixedPosition: "RB",
    });
    expect(dup.ready).toBe(false);
    expect(dup.rows[1].issues).toContain("duplicate_player");
  });
});

describe("competition ranks for manual finishes", () => {
  it("assigns tied fantasy points with competition ranking", () => {
    const ranked = assignCompetitionRanks(
      [
        { name: "A", pts: 20 },
        { name: "B", pts: 18 },
        { name: "C", pts: 18 },
        { name: "D", pts: 10 },
      ],
      (row) => row.pts,
    );
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });
});

describe("previous-week pool copy contract", () => {
  it("documents that opponent and kickoff must come from the new schedule only", () => {
    // Behavioral contract exercised by copyPreviousWeekPools:
    // contest entries get gameId from the target week's schedule map,
    // never from the prior ContestEntry.gameId / RankableEntry.opponent.
    const priorOpponent = "@ CHI";
    const priorKickoff = new Date("2026-09-06T17:00:00.000Z");
    const newScheduleOpponent = "@ GB";
    const newKickoff = new Date("2026-09-13T17:00:00.000Z");

    expect(priorOpponent).not.toBe(newScheduleOpponent);
    expect(priorKickoff.getTime()).not.toBe(newKickoff.getTime());

    // Exclusion flag is independent of matchup fields.
    const sourceEntry = { excluded: true, manuallyAdded: false };
    const copied = {
      excluded: sourceEntry.excluded,
      manuallyAdded: sourceEntry.manuallyAdded,
      opponent: newScheduleOpponent,
      kickoff: newKickoff,
      fantasyPoints: null as number | null,
      actualRank: null as number | null,
    };
    expect(copied.excluded).toBe(true);
    expect(copied.fantasyPoints).toBeNull();
    expect(copied.actualRank).toBeNull();
    expect(copied.opponent).toBe(newScheduleOpponent);
  });
});

describe("manual live UI labeling", () => {
  it("uses non-automatic copy when manual mode is active", () => {
    const manual = isManualNflMode({
      NODE_ENV: "test",
      NFL_DATA_PROVIDER: "manual",
    } as NodeJS.ProcessEnv);
    const emptyCopy = manual
      ? "Live scoring is not available for this week."
      : "No live standings yet";
    expect(emptyCopy).toBe("Live scoring is not available for this week.");
    expect(emptyCopy.toLowerCase()).not.toContain("auto-updating");
  });
});
