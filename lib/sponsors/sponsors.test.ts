import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHouseCampaigns,
  buildTrackedHref,
  getCampaignById,
  getHandicapHeroUrl,
  getStadiumSlopUrl,
  getTeamM8tesUrl,
  HOUSE_ASSET_PATHS,
  HOUSE_PLACEMENT_ROTATION,
  isAllowedSponsorDestination,
  PAID_PLACEMENT_OVERRIDES,
  PLACEMENT_KEYS,
  presentedByLabel,
  resolveAllPlacements,
  resolvePlacement,
  sponsorLabelText,
  usesProductHouseTheme,
} from "@/lib/sponsors";
import type { PlacementKey, SponsorCampaign } from "@/lib/sponsors";

describe("sponsor catalog + placements", () => {
  it("defines all required placement keys", () => {
    expect(PLACEMENT_KEYS).toEqual([
      "home_primary",
      "rank_sidebar",
      "consensus_inline",
      "leaderboard_inline",
      "player_performance_inline",
      "profile_footer",
    ]);
  });

  it("uses the official Handicap Hero www destination", () => {
    expect(getHandicapHeroUrl()).toBe("https://www.handicap-hero.com/");
    expect(isAllowedSponsorDestination("https://www.handicap-hero.com/play")).toBe(
      true,
    );
    expect(isAllowedSponsorDestination("https://handicap-hero.com/")).toBe(true);
  });

  it("seeds three branded SNG LABS house campaigns", () => {
    const campaigns = buildHouseCampaigns();
    expect(campaigns).toHaveLength(3);

    const hh = getCampaignById("handicap-hero")!;
    expect(hh.headline).toBe("Prove It.");
    expect(hh.subheadline).toBe("The Free Verified Handicapping Market");
    expect(hh.body).toContain("confidence-ranked parlay");
    expect(hh.ctaLabel).toBe("Play Handicap Hero");
    expect(hh.destinationUrl).toBe("https://www.handicap-hero.com/");
    expect(hh.theme).toBe("handicap-hero");
    expect(hh.logoUrl).toBe(HOUSE_ASSET_PATHS.handicapHero.badge);
    expect(hh.imageUrl).toBe(HOUSE_ASSET_PATHS.handicapHero.wordmark);
    expect(usesProductHouseTheme(hh)).toBe(true);
    expect(sponsorLabelText(hh)).toBe("An SNG LABS product");
    expect(hh.accessibilityLabel.toLowerCase()).not.toContain("sponsored");

    const ss = getCampaignById("stadium-slop")!;
    expect(ss.headline).toBe("Know the score before you order.");
    expect(ss.body).toContain("Crowd-powered food rankings");
    expect(ss.ctaLabel).toBe("Explore Stadium Slop");
    expect(ss.destinationUrl).toBe(getStadiumSlopUrl());
    expect(ss.destinationUrl).toBe("https://www.stadiumslop.com/");
    expect(ss.theme).toBe("stadium-slop");
    expect(ss.backgroundImageUrl).toBe(HOUSE_ASSET_PATHS.stadiumSlop.heroBanner);
    expect(ss.imageUrl).toBeNull();
    expect(sponsorLabelText(ss)).toBe("From SNG LABS");

    const tm = getCampaignById("team-m8tes")!;
    expect(tm.headline).toBe("Fandom is the filter.");
    expect(tm.body).toBe("Meet sports fans who already speak your language.");
    expect(tm.ctaLabel).toBe("Join Team-M8tes");
    expect(tm.destinationUrl).toBe(getTeamM8tesUrl());
    expect(tm.destinationUrl).toBe("https://www.team-m8tes.com/");
    expect(tm.theme).toBe("team-m8tes");
    expect(tm.logoUrl).toBe(HOUSE_ASSET_PATHS.teamM8tes.logo);
    expect(tm.backgroundImageUrl).toBe(
      HOUSE_ASSET_PATHS.teamM8tes.fandomFilter,
    );
    expect(tm.ctaClassName).toMatch(/pink|purple|fuchsia|gradient/i);
  });

  it("ships real HOUSE creative files under public/sponsors", () => {
    const root = process.cwd();
    const required = [
      "public/sponsors/handicap-hero/hh-badge-gold.png",
      "public/sponsors/handicap-hero/wordmark.png",
      "public/sponsors/stadium-slop/wordmark.png",
      "public/sponsors/stadium-slop/hero-bg.png",
      "public/sponsors/stadium-slop/hero-banner.png",
      "public/sponsors/team-m8tes/fandom-filter.png",
      "public/sponsors/team-m8tes/logo.png",
    ];
    for (const relative of required) {
      expect(existsSync(join(root, relative))).toBe(true);
    }
    expect(
      existsSync(join(root, "public/sponsors/stadium-slop/food-creative.png")),
    ).toBe(false);
    expect(
      existsSync(join(root, "public/sponsors/handicap-hero/hh-mark-gold.svg")),
    ).toBe(false);
  });

  it("labels house ads as SNG LABS and paid as Sponsored / Presented by", () => {
    expect(
      sponsorLabelText({
        sponsorType: "HOUSE",
        sponsorName: "Handicap Hero",
        houseAttribution: "sng_labs_product",
      }),
    ).toBe("An SNG LABS product");
    expect(
      sponsorLabelText({
        sponsorType: "PAID",
        sponsorName: "Acme Analytics",
      }),
    ).toBe("Sponsored · Presented by Acme Analytics");
    expect(presentedByLabel("Acme Analytics")).toBe(
      "Presented by Acme Analytics",
    );
  });

  it("rotates house ads deterministically by placement (one creative each)", () => {
    const resolved = resolveAllPlacements();
    expect(resolved).toHaveLength(PLACEMENT_KEYS.length);

    const byPlacement = Object.fromEntries(
      resolved.map((row) => [row.placementKey, row.campaign.id]),
    );
    expect(byPlacement).toEqual(HOUSE_PLACEMENT_ROTATION);

    const unique = new Set(Object.values(HOUSE_PLACEMENT_ROTATION));
    expect(unique.size).toBe(3);

    for (const key of PLACEMENT_KEYS) {
      const a = resolvePlacement(key);
      const b = resolvePlacement(key);
      expect(a?.campaign.id).toBe(b?.campaign.id);
      expect(a?.campaign.id).toBe(HOUSE_PLACEMENT_ROTATION[key]);
    }
  });

  it("builds tracked CTA hrefs with placement + campaign metadata", () => {
    const placement = resolvePlacement("home_primary")!;
    const href = buildTrackedHref({
      placementKey: placement.placementKey,
      campaign: placement.campaign,
    });
    expect(href.startsWith("/go?")).toBe(true);
    const params = new URLSearchParams(href.slice(4));
    expect(params.get("p")).toBe("home_primary");
    expect(params.get("c")).toBe(placement.campaign.trackingSlug);
    expect(params.get("id")).toBe(placement.campaign.id);
    expect(params.get("u")).toBe(placement.campaign.destinationUrl);
    expect(placement.trackedHref).toBe(href);
  });

  it("keeps paid sponsor rendering on the generic RankEyeQ shell", () => {
    const paid: SponsorCampaign = {
      id: "paid-acme",
      sponsorName: "Acme Analytics",
      sponsorType: "PAID",
      headline: "Precision rankings for teams that practice.",
      body: "Enterprise board tooling for competitive fantasy desks.",
      ctaLabel: "Learn more",
      destinationUrl: "https://example.com/acme",
      trackingSlug: "acme-paid-v1",
      accessibilityLabel: "Sponsored by Acme Analytics",
    };
    expect(usesProductHouseTheme(paid)).toBe(false);

    const campaigns = [...buildHouseCampaigns(), paid];
    const resolved = resolvePlacement("consensus_inline", {
      campaigns,
      paidOverrides: { consensus_inline: "paid-acme" },
    });
    expect(resolved?.campaign.id).toBe("paid-acme");
    expect(resolved?.labelText).toContain("Sponsored");
    expect(usesProductHouseTheme(resolved!.campaign)).toBe(false);
    expect(PAID_PLACEMENT_OVERRIDES).toEqual({});
  });
});

describe("sponsor UI wiring + safety", () => {
  const root = process.cwd();

  function read(path: string) {
    return readFileSync(join(root, path), "utf8");
  }

  it("supports product theme classes and creative fields on SponsorCard", () => {
    const card = read("components/sponsors/SponsorCard.tsx");
    expect(card).toContain("usesProductHouseTheme");
    expect(card).toContain("HouseProductCard");
    expect(card).toContain("PaidOrGenericCard");
    expect(card).toContain("data-sponsor-theme");
    expect(card).toContain("backgroundImageUrl");
    expect(card).toContain("ctaClassName");
    // HH wordmark is desktop-right only; SS has no creative inset branch.
    expect(card).toMatch(
      /campaign\.imageUrl && theme === "handicap-hero"/,
    );
    expect(card).not.toContain('theme === "stadium-slop" ? (');
    expect(card).not.toContain("food-creative");
    expect(card).toContain("h-16 w-auto max-w-[min(100%,16rem)]");
    expect(card).toContain("sm:h-[5.25rem] sm:max-w-[20rem]");
    expect(card).toContain("h-[4.5rem] w-[4.5rem]");
    expect(card).toContain("sm:h-24 sm:w-24");
    const globals = read("app/globals.css");
    expect(globals).toContain(".sponsor-theme-hh");
    expect(globals).toContain(".sponsor-theme-ss");
    expect(globals).toContain(".sponsor-theme-tm");
  });

  it("wires each placement key into the intended surfaces", () => {
    const expectations: Record<PlacementKey, string> = {
      home_primary: "app/page.tsx",
      rank_sidebar: "app/rank/[position]/page.tsx",
      consensus_inline: "app/consensus/page.tsx",
      leaderboard_inline: "app/leaderboards/page.tsx",
      player_performance_inline: "app/players/page.tsx",
      profile_footer: "app/profile/[username]/page.tsx",
    };
    for (const [key, file] of Object.entries(expectations)) {
      const source = read(file);
      expect(source).toContain(`placementKey="${key}"`);
      expect(source).toContain("AdPlacement");
    }
  });

  it("does not place ads inside ranking slots or table row mappers", () => {
    const workspace = read("components/rank/RankingWorkspace.tsx");
    expect(workspace).not.toContain("AdPlacement");
    expect(workspace).not.toContain("SponsorCard");

    const boardTable = read("app/leaderboards/page.tsx");
    const tableStart = boardTable.indexOf("function BoardTable");
    const tableEnd = boardTable.indexOf(
      "\n}",
      boardTable.indexOf("rows.map", tableStart),
    );
    const tableBody = boardTable.slice(tableStart, tableEnd + 2);
    expect(tableBody).not.toContain("AdPlacement");
    expect(tableBody).not.toContain("SponsorCard");
    expect(boardTable).toContain('placementKey="leaderboard_inline"');

    const playerTable = read("components/players/PlayerPerformanceTable.tsx");
    expect(playerTable).not.toContain("AdPlacement");
    expect(playerTable).not.toContain("SponsorCard");
  });

  it("keeps rank ads outside RankingWorkspace (below the builder)", () => {
    const rankPage = read("app/rank/[position]/page.tsx");
    const workspaceIndex = rankPage.indexOf("<RankingWorkspace");
    const adIndex = rankPage.indexOf('placementKey="rank_sidebar"');
    expect(workspaceIndex).toBeGreaterThan(-1);
    expect(adIndex).toBeGreaterThan(workspaceIndex);
  });

  it("keeps profile ads below header / boards / product sections", () => {
    const profile = read("app/profile/[username]/page.tsx");
    const header = profile.indexOf("<ProfileHeader");
    const boards = profile.indexOf("<CurrentWeekBoardsSection");
    const products = profile.indexOf("<ProfileProductSections");
    const ad = profile.indexOf('placementKey="profile_footer"');
    expect(ad).toBeGreaterThan(header);
    expect(ad).toBeGreaterThan(boards);
    expect(ad).toBeGreaterThan(products);
  });
});
