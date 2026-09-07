import { describe, expect, it } from "vitest";
import { OFFICIAL_BENCHMARK_SOURCES } from "@/lib/benchmark-sources";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  SITEMAP_STATIC_PATHS,
  isSitemapExcludedPath,
} from "@/lib/seo";
import {
  buildPlayerSitemapEntries,
  shouldIncludeProfileInSitemap,
} from "@/lib/sitemap-data";

describe("sitemap profile inclusion", () => {
  it("keeps humans, creators, AI, and active analyst experts", () => {
    expect(
      shouldIncludeProfileInSitemap({
        username: "grid_fan",
        updatedAt: new Date(),
        profileType: "HUMAN",
        competitorActive: true,
        expertSourceKind: null,
      }),
    ).toBe(true);
    expect(
      shouldIncludeProfileInSitemap({
        username: "tyler_cohen",
        updatedAt: new Date(),
        profileType: "CREATOR",
        competitorActive: true,
        expertSourceKind: null,
      }),
    ).toBe(true);
    expect(
      shouldIncludeProfileInSitemap({
        username: "gpt",
        updatedAt: new Date(),
        profileType: "AI",
        competitorActive: true,
        expertSourceKind: null,
      }),
    ).toBe(true);
    expect(
      shouldIncludeProfileInSitemap({
        username: "matt_harmon",
        updatedAt: new Date(),
        profileType: "BENCHMARK",
        competitorActive: true,
        expertSourceKind: "ANALYST",
      }),
    ).toBe(true);
  });

  it("excludes inactive legacy publisher shells", () => {
    for (const shell of OFFICIAL_BENCHMARK_SOURCES) {
      expect(
        shouldIncludeProfileInSitemap({
          username: shell.username,
          updatedAt: new Date(),
          profileType: "BENCHMARK",
          competitorActive: false,
          expertSourceKind: "PUBLISHER",
        }),
      ).toBe(false);
    }
    expect(
      shouldIncludeProfileInSitemap({
        username: "yahoo-fantasy",
        updatedAt: new Date(),
        profileType: "BENCHMARK",
        competitorActive: true,
        expertSourceKind: "PUBLISHER",
      }),
    ).toBe(false);
    expect(
      shouldIncludeProfileInSitemap({
        username: "expert-snap-test",
        updatedAt: new Date(),
        profileType: "BENCHMARK",
        competitorActive: true,
        expertSourceKind: null,
      }),
    ).toBe(false);
  });
});

describe("sitemap player entries", () => {
  it("emits canonical nflcom-bootstrap player and DEF URLs without duplicates", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.rankeyeq.com";
    const entries = buildPlayerSitemapEntries([
      {
        id: "cuid-1",
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "justin-jefferson",
        updatedAt: new Date("2026-09-01"),
        type: "PLAYER",
        active: true,
      },
      {
        id: "cuid-dup",
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "justin-jefferson",
        updatedAt: new Date("2026-09-02"),
        type: "PLAYER",
        active: true,
      },
      {
        id: "cuid-def",
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "def-MIN",
        updatedAt: new Date("2026-09-01"),
        type: "DEFENSE",
        active: true,
      },
      {
        id: "cuid-manual",
        provider: "manual",
        externalId: "manual-jj",
        updatedAt: new Date("2026-09-01"),
        type: "PLAYER",
        active: true,
      },
      {
        id: "cuid-inactive",
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "retired-player",
        updatedAt: new Date("2026-09-01"),
        type: "PLAYER",
        active: false,
      },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((row) => row.url)).toEqual([
      "https://www.rankeyeq.com/players/justin-jefferson",
      "https://www.rankeyeq.com/players/def-MIN",
    ]);
  });
});

describe("sitemap static exclusions", () => {
  it("keeps durable public landings and excludes receipts + private paths", () => {
    expect(SITEMAP_STATIC_PATHS).toContain("/players");
    expect(SITEMAP_STATIC_PATHS).toContain("/rankers");
    expect(SITEMAP_STATIC_PATHS).not.toContain("/receipts");
    expect(isSitemapExcludedPath("/receipts")).toBe(true);
    expect(isSitemapExcludedPath("/rank/qb")).toBe(true);
    expect(isSitemapExcludedPath("/profile/yahoo-fantasy")).toBe(false);
  });
});
