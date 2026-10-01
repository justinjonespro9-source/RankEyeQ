import { describe, expect, it } from "vitest";
import {
  buildSyntheticCanonicalArtifact,
  SYNTHETIC_PARTICIPANTS,
  syntheticPlayerExternalId,
} from "@/lib/waivers/__fixtures__/canonical-artifact";
import type { SngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-types";
import { indexCanonicalLedger, matchRankEyeQIdentity, rankEyeQIdentityRisks, type RankEyeQIdentity } from "@/lib/waivers/canonical/identity";
import { rankEyeQTeamForSngTeamKey } from "@/lib/waivers/canonical/team-crosswalk";

const artifact = buildSyntheticCanonicalArtifact().artifact as unknown as SngCanonicalArtifact;
const index = indexCanonicalLedger(artifact);

const player = (overrides: Partial<RankEyeQIdentity> = {}): RankEyeQIdentity => ({
  rankableEntryId: "re-1",
  position: "RB",
  provider: "nflcom-bootstrap",
  externalId: syntheticPlayerExternalId("rb-a"),
  team: "SF",
  active: true,
  adminNotes: null,
  name: "Riley Alpha",
  ...overrides,
});
const defense = (team: string, overrides: Partial<RankEyeQIdentity> = {}) =>
  player({ position: "DEF", externalId: `def-${team}`, team, name: `${team} D/ST`, ...overrides });
const codes = (identity: RankEyeQIdentity) => matchRankEyeQIdentity(identity, index).issues.map((i) => i.code);

describe("matchRankEyeQIdentity — players", () => {
  it("matches exactly on nflcom-bootstrap + externalId", () => {
    const match = matchRankEyeQIdentity(player(), index);
    expect(match.issues).toEqual([]);
    expect(match.participant?.participantId).toBe("rb-a");
    expect(match.consumerKey).toEqual({ kind: "PLAYER", provider: "nflcom-bootstrap", externalId: "nfl-rb-a" });
  });

  it("matches a verified non-participant (identity is independent of participation)", () => {
    expect(matchRankEyeQIdentity(player({ externalId: syntheticPlayerExternalId("qb-dnp") }), index).participant?.state).toBe("VERIFIED_NON_PARTICIPANT");
  });

  it("reports a missing ledger participant and never falls back to the name", () => {
    const sameName = player({ externalId: "nfl-unknown", name: "Riley Alpha" });
    const match = matchRankEyeQIdentity(sameName, index);
    expect(match.participant).toBeNull();
    expect(match.issues.map((i) => i.code)).toEqual(["PARTICIPANT_NOT_IN_LEDGER"]);
  });

  it("rejects a non-contract provider without attempting any other match", () => {
    expect(codes(player({ provider: "manual" }))).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);
    expect(codes(player({ provider: "waivers-test" }))).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);
    expect(matchRankEyeQIdentity(player({ provider: "manual" }), index).participant).toBeNull();
  });

  it("surfaces inactive and merged entries even when the key matches", () => {
    expect(codes(player({ active: false }))).toEqual(["IDENTITY_ENTRY_INACTIVE"]);
    expect(codes(player({ active: false, adminNotes: "Merged into ck123: duplicate" }))).toEqual(["IDENTITY_ENTRY_MERGED"]);
    expect(codes(player({ active: false, adminNotes: "Superseded by nflcom-bootstrap:def-WAS" }))).toEqual(["IDENTITY_ENTRY_MERGED"]);
    expect(matchRankEyeQIdentity(player({ active: false }), index).participant?.participantId).toBe("rb-a");
  });

  it("detects multiple ledger participants for one key (defensive; the verifier also rejects it)", () => {
    const duplicated = structuredClone(artifact);
    const extra = structuredClone(duplicated.payload.participationLedger.find((row) => row.participantId === "rb-a")!);
    duplicated.payload.participationLedger.push({ ...extra, participantId: "rb-a-copy" });
    expect(matchRankEyeQIdentity(player(), indexCanonicalLedger(duplicated)).issues.map((i) => i.code)).toEqual(["DUPLICATE_LEDGER_MATCH"]);
  });
});

describe("matchRankEyeQIdentity — DEF crosswalk", () => {
  it("matches RankEyeQ def-WAS to SNG washington-commanders (WSH)", () => {
    const match = matchRankEyeQIdentity(defense("WAS"), index);
    expect(match.issues).toEqual([]);
    expect(match.consumerKey).toEqual({ kind: "TEAM_DEFENSE", provider: "sng-team", externalId: "washington-commanders" });
    expect(match.participant?.participantId).toBe("def-was");
  });

  it("matches LAR", () => {
    expect(matchRankEyeQIdentity(defense("LAR"), index).participant?.participantId).toBe("def-lar");
  });

  it("reports an unknown DEF team as crosswalk-missing, never guessed", () => {
    expect(codes(defense("WSH"))).toEqual(["DEF_CROSSWALK_MISSING"]);
    expect(codes(defense("LA"))).toEqual(["DEF_CROSSWALK_MISSING"]);
  });

  it("requires a strict def-{TEAM} identity consistent with the entry team", () => {
    expect(codes(defense("WAS", { externalId: "def-was" }))).toEqual(["DEF_IDENTITY_MALFORMED"]);
    expect(codes(defense("WAS", { team: "SF" }))).toEqual(["DEF_IDENTITY_MALFORMED"]);
  });

  it("reports a mapped team whose defense is absent from the ledger", () => {
    expect(codes(defense("GB"))).toEqual(["PARTICIPANT_NOT_IN_LEDGER"]);
  });

  it("evaluates identity risks without any artifact", () => {
    expect(rankEyeQIdentityRisks(defense("WAS")).consumerKey?.externalId).toBe("washington-commanders");
    expect(rankEyeQIdentityRisks(player({ provider: "manual" })).issues.map((i) => i.code)).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);
  });

  it("round-trips every synthetic DEF through the crosswalk", () => {
    const defs = SYNTHETIC_PARTICIPANTS.filter((p) => p.position === "DEF");
    expect(defs).toHaveLength(6);
    for (const spec of defs) {
      const team = rankEyeQTeamForSngTeamKey(spec.teamKey)!.rankeyeqTeam;
      expect(matchRankEyeQIdentity(defense(team), index).participant?.participantId).toBe(spec.id);
    }
  });
});
