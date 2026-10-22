import { describe, expect, it } from "vitest";
import {
  collectRankEyeQIdentityAliasesApplied,
  formatRankEyeQIdentityAliasAppliedDetail,
  formatRankEyeQIdentityAliasCitation,
  RANKEYEQ_IDENTITY_ALIAS_REGISTRY,
  RANKEYEQ_IDENTITY_ALIAS_REGISTRY_VERSION,
  resolveRankEyeQResultsIdentityAlias,
  type RankEyeQIdentityAliasEntry,
} from "@/lib/waivers/rankeyeq-results/identity-alias";

const EKELER = RANKEYEQ_IDENTITY_ALIAS_REGISTRY.find((row) => row.id === "ekeler-manual-to-austin-ekeler")!;

describe("resolveRankEyeQResultsIdentityAlias", () => {
  it("applies the Ekeler registry entry for the exact rankableEntryId + historical identity", () => {
    const resolved = resolveRankEyeQResultsIdentityAlias({
      rankableEntryId: EKELER.rankableEntryId,
      historical: { ...EKELER.from },
      weekId: "cmv7egzsb000006l7axfb8mvx",
    });
    expect(resolved).toMatchObject({
      kind: "applied",
      identity: { provider: "nflcom-bootstrap", externalId: "austin-ekeler" },
      alias: { id: EKELER.id, status: "ACTIVE" },
    });
  });

  it("does not apply when the rankableEntryId differs", () => {
    const resolved = resolveRankEyeQResultsIdentityAlias({
      rankableEntryId: "some-other-player",
      historical: { ...EKELER.from },
    });
    expect(resolved.kind).toBe("none");
  });

  it("does not apply when the historical externalId differs", () => {
    const resolved = resolveRankEyeQResultsIdentityAlias({
      rankableEntryId: EKELER.rankableEntryId,
      historical: { provider: "manual", externalId: "manual-someone-else" },
    });
    expect(resolved.kind).toBe("none");
  });

  it("rejects SUPERSEDED and INVALID aliases", () => {
    const superseded: RankEyeQIdentityAliasEntry = { ...EKELER, status: "SUPERSEDED" };
    const invalid: RankEyeQIdentityAliasEntry = { ...EKELER, id: "ekeler-invalid", status: "INVALID" };
    expect(
      resolveRankEyeQResultsIdentityAlias({
        rankableEntryId: EKELER.rankableEntryId,
        historical: { ...EKELER.from },
        registry: [superseded],
      }),
    ).toMatchObject({ kind: "rejected", code: "ALIAS_SUPERSEDED" });
    expect(
      resolveRankEyeQResultsIdentityAlias({
        rankableEntryId: EKELER.rankableEntryId,
        historical: { ...EKELER.from },
        registry: [invalid],
      }),
    ).toMatchObject({ kind: "rejected", code: "ALIAS_INVALID" });
  });

  it("rejects ambiguous ACTIVE duplicates", () => {
    const dup: RankEyeQIdentityAliasEntry = { ...EKELER, id: "ekeler-dup" };
    expect(
      resolveRankEyeQResultsIdentityAlias({
        rankableEntryId: EKELER.rankableEntryId,
        historical: { ...EKELER.from },
        registry: [EKELER, dup],
      }),
    ).toMatchObject({ kind: "rejected", code: "ALIAS_AMBIGUOUS" });
  });

  it("honors weekIds scope", () => {
    const scoped: RankEyeQIdentityAliasEntry = { ...EKELER, weekIds: ["week-only"] };
    expect(
      resolveRankEyeQResultsIdentityAlias({
        rankableEntryId: EKELER.rankableEntryId,
        historical: { ...EKELER.from },
        weekId: "other-week",
        registry: [scoped],
      }).kind,
    ).toBe("none");
    expect(
      resolveRankEyeQResultsIdentityAlias({
        rankableEntryId: EKELER.rankableEntryId,
        historical: { ...EKELER.from },
        weekId: "week-only",
        registry: [scoped],
      }).kind,
    ).toBe("applied");
  });
});

describe("alias provenance helpers", () => {
  it("round-trips applied detail into citations", () => {
    const detail = formatRankEyeQIdentityAliasAppliedDetail({
      label: "Austin Ekeler (cmv7hvah3000006jsasy6xvkc)",
      alias: EKELER,
      historical: EKELER.from,
      canonical: EKELER.to,
    });
    const collected = collectRankEyeQIdentityAliasesApplied([
      {
        rankableEntryId: EKELER.rankableEntryId,
        evidence: { issues: [{ code: "IDENTITY_ALIAS_APPLIED", detail }] },
      },
    ]);
    expect(collected).toEqual([
      {
        aliasId: EKELER.id,
        rankableEntryId: EKELER.rankableEntryId,
        from: EKELER.from,
        to: EKELER.to,
      },
    ]);
    expect(formatRankEyeQIdentityAliasCitation(collected)).toContain(RANKEYEQ_IDENTITY_ALIAS_REGISTRY_VERSION);
    expect(formatRankEyeQIdentityAliasCitation(collected)).toContain(EKELER.id);
  });
});
