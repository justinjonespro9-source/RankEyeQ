import { describe, expect, it } from "vitest";
import { mapNflComStatusToSeasonFields } from "@/lib/nfl/roster-status";
import {
  isFantasySourcePosition,
  mapSourcePositionToFantasy,
  parseNflComRosterHtml,
} from "@/lib/providers/nfl/nflcom/parse-roster";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = join(
  import.meta.dirname,
  "fixtures/minnesota-vikings-roster.html",
);

describe("NFL.com roster parser", () => {
  it("parses player rows with position and status", () => {
    const html = readFileSync(FIXTURE, "utf8");
    const rows = parseNflComRosterHtml(html);
    expect(rows.length).toBeGreaterThan(80);

    const jefferson = rows.find((row) => row.externalId === "justin-jefferson");
    expect(jefferson).toMatchObject({
      name: "Justin Jefferson",
      sourcePosition: "WR",
      sourceStatus: "ACT",
    });

    const jones = rows.find((row) => row.name === "Aaron Jones");
    expect(jones).toMatchObject({ sourcePosition: "RB", sourceStatus: "ACT" });
  });

  it("maps FB to RB fantasy position", () => {
    expect(mapSourcePositionToFantasy("FB")).toBe("RB");
    expect(isFantasySourcePosition("FB")).toBe(true);
    expect(isFantasySourcePosition("LB")).toBe(false);
  });
});

describe("NFL.com roster status mapping", () => {
  it("marks ACT as active roster", () => {
    expect(mapNflComStatusToSeasonFields("ACT")).toEqual({
      nflStatus: "ACTIVE",
      activeOnNFLRoster: true,
    });
  });

  it("marks CUT and RES as inactive", () => {
    expect(mapNflComStatusToSeasonFields("CUT").activeOnNFLRoster).toBe(false);
    expect(mapNflComStatusToSeasonFields("RES").activeOnNFLRoster).toBe(false);
    expect(mapNflComStatusToSeasonFields("RES").nflStatus).toBe("PRACTICE_SQUAD");
  });

  it("marks DEV (NFL.com practice squad / developmental) as inactive", () => {
    expect(mapNflComStatusToSeasonFields("DEV")).toEqual({
      nflStatus: "PRACTICE_SQUAD",
      activeOnNFLRoster: false,
    });
    expect(mapNflComStatusToSeasonFields("dev").activeOnNFLRoster).toBe(false);
  });

  it("marks E14 and INA as inactive roster statuses", () => {
    expect(mapNflComStatusToSeasonFields("E14")).toEqual({
      nflStatus: "PRACTICE_SQUAD",
      activeOnNFLRoster: false,
    });
    expect(mapNflComStatusToSeasonFields("INA")).toEqual({
      nflStatus: "INACTIVE",
      activeOnNFLRoster: false,
    });
  });

  it("marks RSN (non-football IR) as not on the active roster", () => {
    expect(mapNflComStatusToSeasonFields("RSN")).toEqual({
      nflStatus: "RSN",
      activeOnNFLRoster: false,
    });
  });

  it("keeps EXE (commissioner exempt) roster-affiliated for separate eligibility rules", () => {
    expect(mapNflComStatusToSeasonFields("EXE")).toEqual({
      nflStatus: "EXE",
      activeOnNFLRoster: true,
    });
  });

  it("preserves SUS and IR for eligibility rules", () => {
    expect(mapNflComStatusToSeasonFields("SUS")).toEqual({
      nflStatus: "SUSPENDED",
      activeOnNFLRoster: true,
    });
    expect(mapNflComStatusToSeasonFields("IR").activeOnNFLRoster).toBe(true);
  });
});

describe("DEV weekly eligibility", () => {
  it("excludes DEV-mapped season players from the weekly field", async () => {
    const { isSeasonPlayerEligibleForWeeklyField } = await import(
      "@/lib/nfl/eligibility-rules"
    );
    const mapped = mapNflComStatusToSeasonFields("DEV");
    expect(
      isSeasonPlayerEligibleForWeeklyField({
        activeOnNFLRoster: mapped.activeOnNFLRoster,
        nflStatus: mapped.nflStatus,
      }),
    ).toBe(false);
  });
});
