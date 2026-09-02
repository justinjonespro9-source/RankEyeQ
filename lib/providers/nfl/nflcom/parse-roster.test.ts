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

  it("preserves SUS and IR for eligibility rules", () => {
    expect(mapNflComStatusToSeasonFields("SUS")).toEqual({
      nflStatus: "SUSPENDED",
      activeOnNFLRoster: true,
    });
    expect(mapNflComStatusToSeasonFields("IR").activeOnNFLRoster).toBe(true);
  });
});
