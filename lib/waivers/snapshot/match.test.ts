import { describe, expect, it } from "vitest";
import { buildWaiverMatchIndex, matchWaiverRow, type WaiverMatchCandidate } from "@/lib/waivers/snapshot/match";

const player = (id: string, name: string, position: WaiverMatchCandidate["position"], team: string | null, adminNotes: string | null = null) =>
  ({ id, name, position, canonicalTeam: team, adminNotes, type: position === "DEF" ? "DEFENSE" : "PLAYER", onSeasonRoster: true }) satisfies WaiverMatchCandidate;

const universe = [
  player("br", "Brian Robinson", "RB", "WAS"),
  player("brjr", "Brian Robinson Jr.", "RB", "SF"),
  player("aj_sr", "Aaron Jones Sr.", "RB", "MIN"),
  player("mw_lac", "Mike Williams", "WR", "LAC"),
  player("mw_pit", "Mike Williams", "WR", "PIT"),
  player("dup1", "Duplicate Guy", "TE", "KC"),
  player("dup2", "Duplicate Guy", "TE", "KC"),
  player("alias", "Gabriel Davis", "WR", "BUF", "@aliases:Gabe Davis"),
  player("tt", "Taysom Hill", "TE", "NO"),
  player("def_sf", "49ers", "DEF", "SF"),
  player("def_sea", "Seahawks", "DEF", "SEA"),
];
const index = buildWaiverMatchIndex(universe, [player("inactive", "Old Timer", "QB", "NYG")]);
const match = (playerName: string, position: "QB" | "RB" | "WR" | "TE" | "DEF", team: string, rankEyeQId: string | null = null) =>
  matchWaiverRow({ playerName, position, team, rankEyeQId }, index);

describe("matchWaiverRow — strict ladder", () => {
  it("matches exact identity with the team", () => {
    expect(match("Mike Williams", "WR", "PIT")).toEqual({ status: "MATCHED", rankableEntryId: "mw_pit", method: "EXACT_NAME_TEAM", teamConflict: false });
  });

  it("is suffix-safe: Robinson ≠ Robinson Jr.; only Sr. may be omitted", () => {
    expect(match("Brian Robinson Jr.", "RB", "SF")).toMatchObject({ rankableEntryId: "brjr" });
    expect(match("Brian Robinson", "RB", "WAS")).toMatchObject({ rankableEntryId: "br" });
    expect(match("Aaron Jones", "RB", "MIN")).toMatchObject({ rankableEntryId: "aj_sr" });
  });

  it("matches a unique name on another team with a team-conflict flag (never picks the source team)", () => {
    expect(match("Brian Robinson Jr.", "RB", "WAS")).toEqual({
      status: "MATCHED",
      rankableEntryId: "brjr",
      method: "EXACT_NAME_TEAM",
      teamConflict: true,
    });
  });

  it("marks same-name records AMBIGUOUS when the team does not settle them (legacy duplicates never auto-picked)", () => {
    const sameTeamDupes = match("Duplicate Guy", "TE", "KC");
    expect(sameTeamDupes.status).toBe("AMBIGUOUS");
    expect(sameTeamDupes.status === "AMBIGUOUS" && sameTeamDupes.candidates.map((c) => c.id)).toEqual(["dup1", "dup2"]);
    expect(match("Mike Williams", "WR", "NYJ").status).toBe("AMBIGUOUS");
  });

  it("uses admin aliases as ALIAS_TEAM", () => {
    expect(match("Gabe Davis", "WR", "BUF")).toEqual({ status: "MATCHED", rankableEntryId: "alias", method: "ALIAS_TEAM", teamConflict: false });
  });

  it("reports POSITION_MISMATCH when the name exists only at another position", () => {
    expect(match("Taysom Hill", "QB", "NO")).toMatchObject({ status: "INVALID", reason: "POSITION_MISMATCH" });
  });

  it("does no fuzzy matching", () => {
    expect(match("Mike William", "WR", "PIT").status).toBe("UNMATCHED");
    expect(match("Williams", "WR", "PIT").status).toBe("UNMATCHED");
    expect(match("M. Williams", "WR", "PIT").status).toBe("UNMATCHED");
  });

  it("matches DEF by team only", () => {
    expect(match("San Francisco D/ST", "DEF", "SF")).toMatchObject({ status: "MATCHED", rankableEntryId: "def_sf" });
    expect(match("Anything", "DEF", "KC").status).toBe("UNMATCHED");
  });

  it("DEF prefers the season-rostered defense; otherwise several team defenses are AMBIGUOUS", () => {
    const legacy = { ...player("def_sf_legacy", "SF Defense", "DEF", "SF"), onSeasonRoster: false };
    expect(matchWaiverRow({ playerName: "49ers", position: "DEF", team: "SF", rankEyeQId: null }, buildWaiverMatchIndex([...universe, legacy]))).toMatchObject({
      status: "MATCHED",
      rankableEntryId: "def_sf",
    });
    const unrostered = [legacy, { ...legacy, id: "def_sf_legacy2" }];
    expect(matchWaiverRow({ playerName: "49ers", position: "DEF", team: "SF", rankEyeQId: null }, buildWaiverMatchIndex(unrostered)).status).toBe(
      "AMBIGUOUS",
    );
  });

  it("resolves ambiguity through the RankEyeQ ID column, with name and position checks", () => {
    expect(match("Duplicate Guy", "TE", "KC", "dup2")).toEqual({
      status: "MATCHED",
      rankableEntryId: "dup2",
      method: "ADMIN_CONFIRMED",
      teamConflict: false,
    });
    expect(match("Old Timer", "QB", "NYG", "inactive")).toMatchObject({ status: "MATCHED", rankableEntryId: "inactive" });
    expect(match("Someone Else", "TE", "KC", "dup2")).toMatchObject({ status: "INVALID", reason: "ID_NAME_MISMATCH" });
    expect(match("Duplicate Guy", "WR", "KC", "dup2")).toMatchObject({ status: "INVALID", reason: "ID_POSITION_MISMATCH" });
    expect(match("Duplicate Guy", "TE", "KC", "nope")).toMatchObject({ status: "INVALID", reason: "ID_NOT_FOUND" });
    expect(match("Niners", "DEF", "SF", "def_sf")).toMatchObject({ status: "MATCHED", rankableEntryId: "def_sf" });
  });
});
