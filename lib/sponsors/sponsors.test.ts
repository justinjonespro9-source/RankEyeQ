import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHouseCampaigns,
  buildTrackedHref,
  getCampaignById,
  getHandicapHeroUrl,
  HOUSE_PLACEMENT_ROTATION,
  isAllowedSponsorDestination,
  PAID_PLACEMENT_OVERRIDES,
  PLACEMENT_KEYS,
  presentedByLabel,
  resolveAllPlacements,
  resolvePlacement,
  sponsorLabelText,
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

  it("seeds three SNG LABS house campaigns with CTAs and destinations", () => {
    const campaigns = buildHouseCampaigns();
    expect(campaigns).toHaveLength(3);
    expect(campaigns.map((c) => c.id)).toEqual([
      "handicap-hero",
      "stadium-slop",
      "team-m8tes",
    ]);
    for (const campaign of campaigns) {
      expect(campaign.sponsorType).toBe("HOUSE");
      expect(campaign.headline.length).toBeGreaterThan(10);
      expect(campaign.body.length).toBeGreaterThan(10);
      expect(campaign.ctaLabel.length).toBeGreaterThan(3);
      expect(campaign.destinationUrl.startsWith("http")).toBe(true);
      expect(campaign.trackingSlug.length).toBeGreaterThan(0);
      expect(campaign.accessibilityLabel.toLowerCase()).toContain("sng");
    }

    const hh = getCampaignById("handicap-hero")!;
    expect(hh.ctaLabel).toBe("Play Handicap Hero");
    expect(hh.destinationUrl).toBe(getHandicapHeroUrl());
    expect(hh.headline).toContain("confidence");
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
        sponsorType: "HOUSE",
        sponsorName: "Stadium Slop",
        houseAttribution: "from_sng_labs",
      }),
    ).toBe("From SNG LABS");
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

  it("allows paid placement overrides when an active PAID campaign is configured", () => {
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
    const campaigns = [...buildHouseCampaigns(), paid];
    const resolved = resolvePlacement("consensus_inline", {
      campaigns,
      paidOverrides: { consensus_inline: "paid-acme" },
    });
    expect(resolved?.campaign.id).toBe("paid-acme");
    expect(resolved?.labelText).toContain("Sponsored");
    expect(PAID_PLACEMENT_OVERRIDES).toEqual({});
  });

  it("allowlists sponsor destinations for /go redirects", () => {
    expect(isAllowedSponsorDestination(getHandicapHeroUrl())).toBe(true);
    expect(isAllowedSponsorDestination("https://evil.example/phish")).toBe(
      false,
    );
  });
});

describe("sponsor UI wiring + safety", () => {
  const root = process.cwd();

  function read(path: string) {
    return readFileSync(join(root, path), "utf8");
  }

  it("exports AdPlacement, SponsorCard, and PresentedBy", () => {
    expect(read("components/sponsors/AdPlacement.tsx")).toContain(
      "resolvePlacement",
    );
    expect(read("components/sponsors/SponsorCard.tsx")).toContain(
      "data-sponsor-type",
    );
    expect(read("components/sponsors/SponsorCard.tsx")).toContain(
      "sm:flex-row",
    );
    expect(read("components/sponsors/PresentedBy.tsx")).toContain(
      "presentedByLabel",
    );
    expect(read("components/sponsors/PresentedBy.tsx")).toContain(
      "data-presented-by",
    );
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
