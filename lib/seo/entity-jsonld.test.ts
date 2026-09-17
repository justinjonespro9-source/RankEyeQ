import { describe, expect, it } from "vitest";
import {
  BRAND_LOGO_PATH,
  PUBLIC_BRAND_DEFINITION,
  PUBLIC_BRAND_NAME,
  PUBLIC_BRAND_SPOKEN_NAME,
} from "@/lib/brand";
import { CANONICAL_COMPANY_ORIGIN, COMPANY_LEGAL_NAME } from "@/lib/company";
import { communityLinkHrefs } from "@/lib/community-links";
import { ABOUT_FAQS } from "@/lib/seo/about-content";
import {
  buildFaqPageJsonLd,
  buildRankEyeQEntityGraph,
} from "@/lib/seo/entity-jsonld";
import { SITEMAP_STATIC_PATHS } from "@/lib/seo";
import nextConfig from "../../next.config";

describe("RankEyeQ entity JSON-LD", () => {
  it("builds WebSite, Brand, WebApplication, and SNG LABS Organization", () => {
    const graph = buildRankEyeQEntityGraph({
      origin: "https://www.rankeyeq.com",
      companyUrl: CANONICAL_COMPANY_ORIGIN,
      brandSameAs: communityLinkHrefs(),
    });

    const byId = new Map(
      graph["@graph"].map((node) => [String(node["@id"]), node]),
    );

    const website = byId.get("https://www.rankeyeq.com/#website");
    const brand = byId.get("https://www.rankeyeq.com/#brand");
    const app = byId.get("https://www.rankeyeq.com/#app");
    const org = byId.get(`${CANONICAL_COMPANY_ORIGIN}/#organization`);

    expect(website?.["@type"]).toBe("WebSite");
    expect(website?.name).toBe(PUBLIC_BRAND_NAME);
    expect(website?.about).toEqual({
      "@id": "https://www.rankeyeq.com/#brand",
    });
    expect(website?.publisher).toEqual({
      "@id": `${CANONICAL_COMPANY_ORIGIN}/#organization`,
    });

    expect(brand?.["@type"]).toBe("Brand");
    expect(brand?.alternateName).toBe(PUBLIC_BRAND_SPOKEN_NAME);
    expect(brand?.description).toBe(PUBLIC_BRAND_DEFINITION);
    expect(brand?.logo).toBe(`https://www.rankeyeq.com${BRAND_LOGO_PATH}`);
    expect(brand?.sameAs).toEqual(communityLinkHrefs());

    expect(app?.["@type"]).toBe("WebApplication");
    expect(app?.brand).toEqual({ "@id": "https://www.rankeyeq.com/#brand" });

    expect(org?.["@type"]).toBe("Organization");
    expect(org?.name).toBe(COMPANY_LEGAL_NAME);
    expect(org?.brand).toEqual({ "@id": "https://www.rankeyeq.com/#brand" });
    expect(org?.sameAs).toBeUndefined();
  });

  it("keeps RankEyeQ socials off the SNG LABS Organization node", () => {
    const graph = buildRankEyeQEntityGraph({
      origin: "https://www.rankeyeq.com",
    });
    const org = graph["@graph"].find(
      (node) => node["@type"] === "Organization",
    );
    const serialized = JSON.stringify(org);
    for (const href of communityLinkHrefs()) {
      expect(serialized).not.toContain(href);
    }
  });
});

describe("About FAQ JSON-LD", () => {
  it("mirrors visible FAQ answers and clarifies Rank Equity is unrelated", () => {
    expect(ABOUT_FAQS.length).toBeGreaterThanOrEqual(6);
    const equity = ABOUT_FAQS.find((item) =>
      /Rank Equity|investment/i.test(item.question),
    );
    expect(equity?.answer).toMatch(/unrelated/i);
    expect(equity?.answer).toMatch(/fantasy-football/i);

    const ld = buildFaqPageJsonLd({
      pageUrl: "https://www.rankeyeq.com/about",
      items: ABOUT_FAQS,
    });
    expect(ld["@type"]).toBe("FAQPage");
    expect(Array.isArray(ld.mainEntity)).toBe(true);
    expect((ld.mainEntity as unknown[]).length).toBe(ABOUT_FAQS.length);
  });
});

describe("SEO static routes and apex redirect", () => {
  it("includes /about in the sitemap static paths", () => {
    expect(SITEMAP_STATIC_PATHS).toContain("/about");
  });

  it("configures permanent apex → www redirect", async () => {
    const redirects =
      typeof nextConfig.redirects === "function"
        ? await nextConfig.redirects()
        : [];
    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          has: [{ type: "host", value: "rankeyeq.com" }],
          destination: "https://www.rankeyeq.com/:path*",
          permanent: true,
        }),
      ]),
    );
  });
});
