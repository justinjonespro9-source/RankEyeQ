import { describe, expect, it } from "vitest";
import {
  isSyntheticBootstrapExternalId,
  shouldIncludeInPublicPlayerListings,
} from "@/lib/nfl/public-player-identity";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

const base = {
  provider: NFL_COM_BOOTSTRAP_PROVIDER,
  position: "WR",
  type: "PLAYER",
  team: "NE",
  active: true,
} as const;

describe("isSyntheticBootstrapExternalId", () => {
  it("flags dup-test and test-player prefixes", () => {
    expect(isSyntheticBootstrapExternalId("dup-test-pool1790173106663")).toBe(
      true,
    );
    expect(isSyntheticBootstrapExternalId("test-player-trade")).toBe(true);
  });

  it("flags merge artifacts", () => {
    expect(
      isSyntheticBootstrapExternalId("brian-robinson-br-merge-123"),
    ).toBe(true);
  });

  it("allows real roster slugs", () => {
    expect(isSyntheticBootstrapExternalId("aaron-jones")).toBe(false);
    expect(isSyntheticBootstrapExternalId("def-NE")).toBe(false);
  });
});

describe("shouldIncludeInPublicPlayerListings", () => {
  it("includes active nflcom-bootstrap roster players", () => {
    expect(
      shouldIncludeInPublicPlayerListings({
        ...base,
        externalId: "stephon-diggs",
      }),
    ).toBe(true);
  });

  it("excludes Pool Dup / Trade Test fixture slugs even when bootstrap + active", () => {
    expect(
      shouldIncludeInPublicPlayerListings({
        ...base,
        externalId: "dup-test-pool1790173106663",
      }),
    ).toBe(false);
    expect(
      shouldIncludeInPublicPlayerListings({
        ...base,
        externalId: "test-player-trade",
      }),
    ).toBe(false);
  });

  it("excludes mock and inactive identities", () => {
    expect(
      shouldIncludeInPublicPlayerListings({
        ...base,
        provider: "mock",
        externalId: "aaron-jones",
      }),
    ).toBe(false);
    expect(
      shouldIncludeInPublicPlayerListings({
        ...base,
        externalId: "aaron-jones",
        active: false,
      }),
    ).toBe(false);
  });

  it("includes canonical defenses", () => {
    expect(
      shouldIncludeInPublicPlayerListings({
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "def-NE",
        position: "DEF",
        type: "DEFENSE",
        team: "NE",
        active: true,
      }),
    ).toBe(true);
  });
});
