import { describe, expect, it } from "vitest";
import { rqBuiltContent, rqResolvedContent } from "@/lib/waivers/__fixtures__/rankeyeq-results";
import {
  classifyRankEyeQParticipant,
  indexRankEyeQResultsLedger,
  matchRankEyeQResultsIdentity,
  projectRankEyeQResultsSource,
  type RankEyeQResultsIdentity,
} from "@/lib/waivers/rankeyeq-results/ledger";
import { verifyRankEyeQFinalWeekStatsSnapshot } from "@/lib/waivers/rankeyeq-results/verify";

const verified = () => {
  const result = verifyRankEyeQFinalWeekStatsSnapshot(rqResolvedContent());
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.verified;
};
const identity = (overrides: Partial<RankEyeQResultsIdentity> = {}): RankEyeQResultsIdentity => ({
  rankableEntryId: "q-pos",
  position: "QB",
  provider: "nflcom-bootstrap",
  externalId: "nfl-q-pos",
  team: "KC",
  name: "Name q-pos",
  ...overrides,
});

describe("projectRankEyeQResultsSource", () => {
  it("projects a verified snapshot as a RankEyeQ-native source (not an SNG artifact)", () => {
    const source = projectRankEyeQResultsSource(verified(), { snapshotRowId: "row-1", revision: 1 });
    expect(source).toMatchObject({
      sourceKind: "RANKEYEQ_FINAL_WEEK_STATS",
      schemaVersion: "rankeyeq-final-week-stats/1",
      scoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
      provenance: { snapshotRowId: "row-1", revision: 1, authorityBasis: "RANKEYEQ_OPERATOR_ATTESTED" },
    });
    expect(source.participants).toHaveLength(6);
    expect(source.ledger.size).toBe(6);
  });

  it("refuses to project a snapshot that still has unresolved participants", () => {
    const pre = verifyRankEyeQFinalWeekStatsSnapshot(rqBuiltContent(), { allowUnresolved: true });
    expect(pre.ok).toBe(true);
    if (pre.ok) expect(() => projectRankEyeQResultsSource(pre.verified)).toThrow(/unresolved/);
  });
});

describe("matchRankEyeQResultsIdentity", () => {
  const index = projectRankEyeQResultsSource(verified()).ledger;

  it("matches players by frozen nflcom-bootstrap provider + externalId", () => {
    const match = matchRankEyeQResultsIdentity(identity(), index);
    expect(match.issues).toEqual([]);
    expect(match.participant).toMatchObject({ rankableEntryId: "q-pos", pointsHundredths: 1854 });
  });

  it("matches DEF by def-{TEAM} with no SNG team crosswalk", () => {
    const match = matchRankEyeQResultsIdentity(identity({ rankableEntryId: "d-kc", position: "DEF", externalId: "def-KC", team: "KC", name: "Chiefs D/ST" }), index);
    expect(match.issues).toEqual([]);
    expect(match.participant).toMatchObject({ kind: "TEAM_DEFENSE", pointsHundredths: 700 });
  });

  it("never matches by name and reports a missing participant", () => {
    const match = matchRankEyeQResultsIdentity(identity({ externalId: "nfl-someone-else", name: "Name q-pos" }), index);
    expect(match.participant).toBeNull();
    expect(match.issues.map((i) => i.code)).toEqual(["PARTICIPANT_NOT_IN_LEDGER"]);
  });

  it("rejects a non-contract provider and a malformed DEF identity", () => {
    expect(matchRankEyeQResultsIdentity(identity({ provider: "mock" }), index).issues.map((i) => i.code)).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);
    expect(
      matchRankEyeQResultsIdentity(identity({ rankableEntryId: "d-kc", position: "DEF", externalId: "def-KC", team: "BUF" }), index).issues.map((i) => i.code),
    ).toEqual(["DEF_IDENTITY_MALFORMED"]);
  });

  it("matches a frozen manual identity through the audited Ekeler alias onto the ledger key", () => {
    const ekelerParticipant = {
      ...verified().content.participants[0],
      rankableEntryId: "cmv7hvah3000006jsasy6xvkc",
      provider: "nflcom-bootstrap",
      externalId: "austin-ekeler",
      position: "RB" as const,
      pointsHundredths: 170,
    };
    const ekelerIndex = indexRankEyeQResultsLedger([ekelerParticipant]);
    const match = matchRankEyeQResultsIdentity(
      {
        rankableEntryId: "cmv7hvah3000006jsasy6xvkc",
        position: "RB",
        provider: "manual",
        externalId: "manual-austin-ekeler-was-rb-mv7hvagx",
        team: "WAS",
        name: "Austin Ekeler",
        weekId: "cmv7egzsb000006l7axfb8mvx",
      },
      ekelerIndex,
    );
    expect(match.issues).toEqual([]);
    expect(match.participant).toMatchObject({ rankableEntryId: "cmv7hvah3000006jsasy6xvkc", pointsHundredths: 170 });
  });

  it("requires the rankableEntryId to agree with the identity", () => {
    const match = matchRankEyeQResultsIdentity(identity({ rankableEntryId: "someone-else" }), index);
    expect(match.participant).toBeNull();
    expect(match.issues.map((i) => i.code)).toEqual(["RANKABLE_ENTRY_MISMATCH"]);
  });

  it("reports duplicate ledger matches instead of picking one", () => {
    const [first] = verified().content.participants;
    const dup = indexRankEyeQResultsLedger([first, { ...first, rankableEntryId: "other" }]);
    const match = matchRankEyeQResultsIdentity(identity({ rankableEntryId: first.rankableEntryId, externalId: first.externalId, position: first.position }), dup);
    expect(match.issues.map((i) => i.code)).toEqual(["DUPLICATE_LEDGER_MATCH"]);
  });
});

describe("classifyRankEyeQParticipant", () => {
  it("maps participation into the Waivers handling classes", () => {
    const by = new Map(verified().content.participants.map((p) => [p.rankableEntryId, classifyRankEyeQParticipant(p).cls]));
    expect(by.get("q-pos")).toBe("RANKED");
    expect(by.get("q-zero")).toBe("RANKED"); // PARTICIPATED_ZERO: zero is a real score only after operator review
    expect(by.get("d-buf")).toBe("NON_PARTICIPANT");
    const unresolved = rqBuiltContent().participants.map((p) => classifyRankEyeQParticipant(p).cls);
    expect(unresolved.filter((cls) => cls === "BLOCKED")).toHaveLength(3);
  });
});
