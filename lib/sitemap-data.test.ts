import { describe, expect, it } from "vitest";
import { OFFICIAL_BENCHMARK_SOURCES } from "@/lib/benchmark-sources";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  SITEMAP_STATIC_PATHS,
  isSitemapExcludedPath,
} from "@/lib/seo";
import {
  PLAYER_SITEMAP_LIMIT,
  SITEMAP_POSITION_CAPS,
  buildPlayerSitemapEntries,
  compareSitemapPlayerPriority,
  countSitemapPlayersByPosition,
  selectBalancedSitemapPlayers,
  shouldIncludeProfileInSitemap,
  type SitemapPlayerCandidate,
} from "@/lib/sitemap-data";

function candidate(
  partial: Partial<SitemapPlayerCandidate> &
    Pick<SitemapPlayerCandidate, "externalId" | "position">,
): SitemapPlayerCandidate {
  return {
    id: partial.id ?? `id-${partial.externalId}`,
    provider: partial.provider ?? NFL_COM_BOOTSTRAP_PROVIDER,
    externalId: partial.externalId,
    name: partial.name ?? partial.externalId,
    updatedAt: partial.updatedAt ?? new Date("2026-09-01"),
    type: partial.type ?? (partial.position === "DEF" ? "DEFENSE" : "PLAYER"),
    position: partial.position,
    active: partial.active ?? true,
    inContestPool: partial.inContestPool ?? false,
    inSeasonRoster: partial.inSeasonRoster ?? true,
  };
}

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
  });

  it("includes active publisher consensus benchmarks", () => {
    expect(
      shouldIncludeProfileInSitemap({
        username: "yahoo-consensus",
        updatedAt: new Date(),
        profileType: "BENCHMARK",
        competitorActive: true,
        expertSourceKind: "PUBLISHER_CONSENSUS",
      }),
    ).toBe(true);
    expect(
      shouldIncludeProfileInSitemap({
        username: "fantasypros-ecr-board",
        updatedAt: new Date(),
        profileType: "BENCHMARK",
        competitorActive: true,
        expertSourceKind: "SITE_CONSENSUS",
      }),
    ).toBe(true);
  });

  it("excludes private-tracked Experts and Creators", () => {
    expect(
      shouldIncludeProfileInSitemap({
        username: "private_expert",
        updatedAt: new Date(),
        profileType: "BENCHMARK",
        competitorActive: true,
        publicVisible: false,
        expertSourceKind: "ANALYST",
      }),
    ).toBe(false);
    expect(
      shouldIncludeProfileInSitemap({
        username: "private_creator",
        updatedAt: new Date(),
        profileType: "CREATOR",
        competitorActive: true,
        publicVisible: false,
        expertSourceKind: null,
      }),
    ).toBe(false);
  });
});

describe("position-balanced player sitemap selection", () => {
  it("caps total at 200 and represents every position without one position dominating", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.rankeyeq.com";

    const pool: SitemapPlayerCandidate[] = [];
    const inflate = (position: ContestPosition, count: number) => {
      for (let i = 0; i < count; i += 1) {
        pool.push(
          candidate({
            externalId:
              position === "DEF"
                ? `def-${String(i).padStart(2, "0")}`
                : `${position.toLowerCase()}-player-${String(i).padStart(3, "0")}`,
            position,
            name: `${position} Player ${String(i).padStart(3, "0")}`,
            inContestPool: i % 5 === 0,
            inSeasonRoster: true,
          }),
        );
      }
    };

    // Intentionally flood QB/RB so an unordered cap would starve WR/TE.
    inflate("QB", 120);
    inflate("RB", 120);
    inflate("WR", 120);
    inflate("TE", 80);
    inflate("DEF", 32);

    const selected = selectBalancedSitemapPlayers(pool);
    const counts = countSitemapPlayersByPosition(selected);
    const pathIds = selected.map((row) => row.externalId);

    expect(selected.length).toBeLessThanOrEqual(PLAYER_SITEMAP_LIMIT);
    expect(selected.length).toBe(200);
    expect(counts.QB).toBe(SITEMAP_POSITION_CAPS.QB);
    expect(counts.RB).toBe(SITEMAP_POSITION_CAPS.RB);
    expect(counts.WR).toBe(SITEMAP_POSITION_CAPS.WR);
    expect(counts.TE).toBe(SITEMAP_POSITION_CAPS.TE);
    expect(counts.DEF).toBe(32);
    expect(counts.QB).toBeLessThan(PLAYER_SITEMAP_LIMIT);
    expect(counts.RB).toBeLessThan(PLAYER_SITEMAP_LIMIT);
    expect(new Set(pathIds).size).toBe(pathIds.length);

    const again = selectBalancedSitemapPlayers(pool);
    expect(again.map((row) => row.externalId)).toEqual(pathIds);
  });

  it("prefers contest-pool players over roster-only within a position", () => {
    const selected = selectBalancedSitemapPlayers([
      candidate({
        externalId: "roster-only-wr",
        position: "WR",
        inContestPool: false,
        inSeasonRoster: true,
      }),
      candidate({
        externalId: "pool-wr",
        position: "WR",
        inContestPool: true,
        inSeasonRoster: false,
      }),
    ]);
    expect(selected[0]?.externalId).toBe("pool-wr");
  });

  it("sorts ties deterministically by name then externalId", () => {
    expect(
      compareSitemapPlayerPriority(
        candidate({ externalId: "b", name: "Alpha", position: "QB" }),
        candidate({ externalId: "a", name: "Alpha", position: "QB" }),
      ),
    ).toBeGreaterThan(0);
  });

  it("emits canonical URLs and drops manual/inactive duplicates", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.rankeyeq.com";
    const entries = buildPlayerSitemapEntries([
      {
        id: "cuid-1",
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "justin-jefferson",
        updatedAt: new Date("2026-09-01"),
        type: "PLAYER",
        active: true,
        position: "WR",
        name: "Justin Jefferson",
      },
      {
        id: "cuid-dup",
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "justin-jefferson",
        updatedAt: new Date("2026-09-02"),
        type: "PLAYER",
        active: true,
        position: "WR",
        name: "Justin Jefferson",
      },
      {
        id: "cuid-def",
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "def-MIN",
        updatedAt: new Date("2026-09-01"),
        type: "DEFENSE",
        active: true,
        position: "DEF",
      },
      {
        id: "cuid-manual",
        provider: "manual",
        externalId: "manual-jj",
        updatedAt: new Date("2026-09-01"),
        type: "PLAYER",
        active: true,
        position: "WR",
      },
    ]);

    expect(entries.map((row) => row.url)).toEqual([
      "https://www.rankeyeq.com/players/justin-jefferson",
      "https://www.rankeyeq.com/players/def-MIN",
    ]);
  });
});

describe("sitemap static exclusions", () => {
  it("keeps durable public landings and excludes receipts + private paths", () => {
    expect(SITEMAP_STATIC_PATHS).toContain("/players");
    expect(SITEMAP_STATIC_PATHS).not.toContain("/receipts");
    expect(isSitemapExcludedPath("/receipts")).toBe(true);
  });
});
