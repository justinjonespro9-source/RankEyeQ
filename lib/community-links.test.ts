import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_LINKS,
  communityLinkHrefs,
} from "@/lib/community-links";

const CANONICAL = {
  x: "https://x.com/RankEyeQ",
  tiktok: "https://www.tiktok.com/@rankeyeq?lang=en",
  instagram: "https://www.instagram.com/rankeyeq/",
  discord: "https://discord.gg/tqCK4uRq4",
} as const;

describe("community links", () => {
  it("exposes exactly X, TikTok, Instagram, and Discord", () => {
    expect(COMMUNITY_LINKS.map((link) => link.id)).toEqual([
      "x",
      "tiktok",
      "instagram",
      "discord",
    ]);
  });

  it("uses the canonical public URLs", () => {
    for (const link of COMMUNITY_LINKS) {
      expect(link.href).toBe(CANONICAL[link.id]);
    }
  });

  it("does not include placeholder networks", () => {
    const blob = communityLinkHrefs().join(" ");
    expect(blob).not.toMatch(/youtube|facebook|bluesky|threads|twitter\.com/i);
  });

  it("frames Discord as community", () => {
    const discord = COMMUNITY_LINKS.find((link) => link.id === "discord");
    expect(discord?.ariaLabel.toLowerCase()).toContain("community");
  });

  it("is consumed by footer, mobile nav, and JSON-LD surfaces", () => {
    const files = [
      "components/layout/SiteFooter.tsx",
      "components/layout/MobileNav.tsx",
      "components/seo/SiteJsonLd.tsx",
      "components/layout/CommunityLinks.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toMatch(/community-links|CommunityLinks/);
    }
  });
});
