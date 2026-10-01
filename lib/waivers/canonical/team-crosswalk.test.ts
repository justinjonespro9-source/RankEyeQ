import { describe, expect, it } from "vitest";
import { NFL_TEAMS } from "@/lib/nfl-schedule";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { NFL_COM_TEAM_SLUGS } from "@/lib/providers/nfl/nflcom/teams";
import { RANKEYEQ_PLAYER_IDENTITY_PROVIDER } from "@/lib/waivers/canonical/contract";
import {
  RANKEYEQ_SNG_TEAM_CROSSWALK,
  rankEyeQDefenseTeamFromExternalId,
  rankEyeQTeamForSngTeamKey,
  sngTeamForRankEyeQTeam,
} from "@/lib/waivers/canonical/team-crosswalk";

describe("RankEyeQ ↔ SNG team crosswalk", () => {
  it("holds exactly the 32 RankEyeQ teams with unique SNG codes and keys", () => {
    expect(RANKEYEQ_SNG_TEAM_CROSSWALK).toHaveLength(32);
    expect(RANKEYEQ_SNG_TEAM_CROSSWALK.map((r) => r.rankeyeqTeam).sort()).toEqual(NFL_TEAMS.map((t) => t.abbr).sort());
    expect(new Set(RANKEYEQ_SNG_TEAM_CROSSWALK.map((r) => r.sngAbbreviation)).size).toBe(32);
    expect(new Set(RANKEYEQ_SNG_TEAM_CROSSWALK.map((r) => r.sngTeamKey)).size).toBe(32);
  });

  it("uses SNG stable keys that agree with the NFL.com team slugs RankEyeQ already pins", () => {
    for (const [slug, abbr] of Object.entries(NFL_COM_TEAM_SLUGS)) {
      expect(sngTeamForRankEyeQTeam(abbr)?.sngTeamKey).toBe(slug);
    }
  });

  it("maps Washington WAS ↔ SNG WSH / washington-commanders", () => {
    expect(sngTeamForRankEyeQTeam("WAS")).toEqual({ rankeyeqTeam: "WAS", sngAbbreviation: "WSH", sngTeamKey: "washington-commanders" });
    expect(rankEyeQTeamForSngTeamKey("washington-commanders")?.rankeyeqTeam).toBe("WAS");
  });

  it("confirms the Rams as LAR on both sides", () => {
    expect(sngTeamForRankEyeQTeam("LAR")).toEqual({ rankeyeqTeam: "LAR", sngAbbreviation: "LAR", sngTeamKey: "los-angeles-rams" });
  });

  it("never guesses abbreviations, aliases or case", () => {
    for (const code of ["WSH", "LA", "STL", "was", " WAS", "JAC", "OAK", "SD"]) expect(sngTeamForRankEyeQTeam(code)).toBeNull();
    expect(rankEyeQTeamForSngTeamKey("WSH")).toBeNull();
    expect(rankEyeQTeamForSngTeamKey("Washington Commanders")).toBeNull();
  });

  it("parses only strict RankEyeQ DEF identities", () => {
    expect(rankEyeQDefenseTeamFromExternalId("def-WAS")).toBe("WAS");
    expect(rankEyeQDefenseTeamFromExternalId("def-GB")).toBe("GB");
    for (const id of ["def-was", "DEF-WAS", "def-WASH", "def-", "wsh", "def-WAS "]) expect(rankEyeQDefenseTeamFromExternalId(id)).toBeNull();
  });

  it("pins the player provider to the roster bootstrap provider", () => {
    expect(RANKEYEQ_PLAYER_IDENTITY_PROVIDER).toBe(NFL_COM_BOOTSTRAP_PROVIDER);
  });
});
