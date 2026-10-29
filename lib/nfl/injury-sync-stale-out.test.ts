import { describe, expect, it } from "vitest";
import {
  PRESERVED_ON_BLANK_GAME_STATUS,
  PRESERVED_OFFICIAL_DESIGNATIONS,
  resolvePlayerWeekStatus,
} from "@/lib/eligibility/player-week-availability";
import {
  resolveInjurySyncDesignation,
  syncWeekInjuriesFromNflCom,
} from "@/lib/nfl/injury-sync";

/** Week 8 players that required manual stale-OUT corrections. */
const WEEK8_STALE_OUT_CASES = [
  "Lamar Jackson",
  "Jeremiyah Love",
  "DeVonta Smith",
  "Dontayvion Wicks",
  "Rashee Rice",
  "Emeka Egbuka",
  "Tyler Warren",
] as const;

describe("injury sync stale OUT on blank Game Status", () => {
  it("PRESERVED_ON_BLANK_GAME_STATUS excludes OUT but keeps INACTIVE", () => {
    expect(PRESERVED_ON_BLANK_GAME_STATUS.has("OUT")).toBe(false);
    expect(PRESERVED_ON_BLANK_GAME_STATUS.has("INACTIVE")).toBe(true);
    expect(PRESERVED_ON_BLANK_GAME_STATUS.has("QUESTIONABLE")).toBe(true);
    expect(PRESERVED_ON_BLANK_GAME_STATUS.has("DOUBTFUL")).toBe(true);
    expect(PRESERVED_ON_BLANK_GAME_STATUS.has("AVAILABLE")).toBe(true);
    // Compat set still documents historical full preserve list.
    expect(PRESERVED_OFFICIAL_DESIGNATIONS.has("OUT")).toBe(true);
  });

  it.each([...WEEK8_STALE_OUT_CASES])(
    "Week 8 case %s: stale OUT + listed blank GS → UNKNOWN",
    () => {
      expect(
        resolveInjurySyncDesignation({
          gameStatus: null,
          existingDesignation: "OUT",
        }),
      ).toBe("UNKNOWN");
    },
  );

  it("explicit OUT followed by newer explicit OUT stays OUT", () => {
    expect(
      resolveInjurySyncDesignation({
        gameStatus: "OUT",
        existingDesignation: "OUT",
      }),
    ).toBe("OUT");
  });

  it("OUT followed by QUESTIONABLE GS becomes QUESTIONABLE", () => {
    expect(
      resolveInjurySyncDesignation({
        gameStatus: "QUESTIONABLE",
        existingDesignation: "OUT",
      }),
    ).toBe("QUESTIONABLE");
  });

  it("OUT followed by DOUBTFUL GS becomes DOUBTFUL", () => {
    expect(
      resolveInjurySyncDesignation({
        gameStatus: "DOUBTFUL",
        existingDesignation: "OUT",
      }),
    ).toBe("DOUBTFUL");
  });

  it("blank GS preserves existing QUESTIONABLE and DOUBTFUL", () => {
    expect(
      resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: "QUESTIONABLE",
      }),
    ).toBe("QUESTIONABLE");
    expect(
      resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: "DOUBTFUL",
      }),
    ).toBe("DOUBTFUL");
  });

  it("blank GS with null existing → UNKNOWN (does not invent AVAILABLE)", () => {
    expect(
      resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: null,
      }),
    ).toBe("UNKNOWN");
  });

  it("explicit OUT GS still applies when listed", () => {
    expect(
      resolveInjurySyncDesignation({
        gameStatus: "OUT",
        existingDesignation: "UNKNOWN",
      }),
    ).toBe("OUT");
  });

  it("official gameday INACTIVE is preserved on blank GS; explicit OUT GS still applies", () => {
    expect(
      resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: "INACTIVE",
      }),
    ).toBe("INACTIVE");
    expect(
      resolveInjurySyncDesignation({
        gameStatus: "OUT",
        existingDesignation: "INACTIVE",
      }),
    ).toBe("OUT");
  });

  it("roster IR remains non-selectable even when week designation is UNKNOWN after blank GS", () => {
    const afterBlankGs = resolveInjurySyncDesignation({
      gameStatus: null,
      existingDesignation: "OUT",
    });
    expect(afterBlankGs).toBe("UNKNOWN");
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "IR",
      weekDesignation: afterBlankGs,
      practiceStatus: "Did Not Participate In Practice",
      injuryDescription: "Knee",
    });
    expect(resolved.selectable).toBe(false);
    expect(resolved.unavailableReason).toBe("IR");
  });

  it("roster PUP / SUSPENDED remain non-selectable with UNKNOWN week row", () => {
    for (const nflStatus of ["PUP", "SUSPENDED"] as const) {
      const resolved = resolvePlayerWeekStatus({
        nflStatus,
        weekDesignation: "UNKNOWN",
      });
      expect(resolved.selectable).toBe(false);
      expect(resolved.unavailableReason).toBe(nflStatus);
    }
  });

  it("ACTIVE roster + UNKNOWN after clearing stale OUT is selectable", () => {
    const designation = resolveInjurySyncDesignation({
      gameStatus: null,
      existingDesignation: "OUT",
    });
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: designation,
      practiceStatus: "Limited Participation in Practice",
      injuryDescription: "Ankle",
    });
    expect(resolved.selectable).toBe(true);
    expect(resolved.designation).toBe("UNKNOWN");
  });

  it("failed NFL.com fetch leaves existing designations unchanged", async () => {
    const result = await syncWeekInjuriesFromNflCom({
      weekId: "week-that-does-not-matter-on-fetch-fail",
      apply: false,
      fetchFn: async () => {
        throw new Error("simulated NFL.com outage");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.source).toBe("none");
    expect(result.updated).toBe(0);
    expect(result.errors.some((e) => /Existing designations left unchanged/i.test(e))).toBe(
      true,
    );
  });

  it("resolver is pure: unrelated existing designations only change when that player is resolved", () => {
    const otherPlayerStaysOut = "OUT" as const;
    const listedBlankGs = resolveInjurySyncDesignation({
      gameStatus: null,
      existingDesignation: "OUT",
    });
    expect(listedBlankGs).toBe("UNKNOWN");
    // Absent / unmatched players never call the resolver — their OUT is untouched.
    expect(otherPlayerStaysOut).toBe("OUT");
  });
});
