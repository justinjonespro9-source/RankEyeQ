import { describe, expect, it } from "vitest";
import { isProductionWeeklyPoolIdentity } from "@/lib/nfl/pool-source";
import { poolEntryIdentityKey } from "@/lib/nfl/pool-identity";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

describe("production weekly pool source guards", () => {
  it("accepts nflcom-bootstrap offensive players", () => {
    expect(
      isProductionWeeklyPoolIdentity({
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "aaron-jones",
        position: "RB",
        type: "PLAYER",
        team: "MIN",
        active: true,
      }),
    ).toBe(true);
  });

  it("rejects legacy manual offensive identities", () => {
    expect(
      isProductionWeeklyPoolIdentity({
        provider: "manual",
        externalId: "manual-aaron-jones",
        position: "RB",
        type: "PLAYER",
        team: "MIN",
        active: true,
      }),
    ).toBe(false);
  });

  it("treats merge-test nflcom external IDs as distinct identity keys", () => {
    const canonical = poolEntryIdentityKey({
      name: "Brian Robinson",
      position: "RB",
      provider: NFL_COM_BOOTSTRAP_PROVIDER,
      externalId: "brian-robinson",
      team: "ATL",
      type: "PLAYER",
    });
    const artifact = poolEntryIdentityKey({
      name: "Brian Robinson",
      position: "RB",
      provider: NFL_COM_BOOTSTRAP_PROVIDER,
      externalId: "brian-robinson-br-merge-123",
      team: "ATL",
      type: "PLAYER",
    });
    expect(canonical).not.toBe(artifact);
  });
});
