import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_SITE_HOST,
  CANONICAL_SITE_ORIGIN,
  NO_INDEX,
  PUBLIC_INDEX,
  ROBOTS_DISALLOW_PATHS,
  SITEMAP_STATIC_PATHS,
  absoluteUrl,
  buildRobotsRules,
  canonicalizePath,
  getCanonicalSiteOrigin,
  isSitemapExcludedPath,
  publicPageMetadata,
  rankPositionCanonicalPath,
} from "@/lib/seo";

const ORIGINAL_AUTH = process.env.AUTH_URL;
const ORIGINAL_SITE = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (ORIGINAL_AUTH === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH;
  if (ORIGINAL_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE;
});

describe("canonical host + paths", () => {
  it("normalizes bare rankeyeq.com to www", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.AUTH_URL = "https://rankeyeq.com";
    expect(getCanonicalSiteOrigin()).toBe(CANONICAL_SITE_ORIGIN);
    expect(getCanonicalSiteOrigin()).toContain(CANONICAL_SITE_HOST);
  });

  it("keeps localhost origins for local AUTH_URL", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.AUTH_URL = "http://localhost:3000";
    expect(getCanonicalSiteOrigin()).toBe("http://localhost:3000");
  });

  it("builds absolute canonical URLs without trailing slash noise", () => {
    delete process.env.AUTH_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.rankeyeq.com";
    expect(absoluteUrl("/leaderboards")).toBe(
      "https://www.rankeyeq.com/leaderboards",
    );
    expect(absoluteUrl("/")).toBe("https://www.rankeyeq.com/");
  });

  it("strips query strings from canonical paths", () => {
    expect(canonicalizePath("/leaderboards?filter=AI&weekId=x")).toBe(
      "/leaderboards",
    );
    expect(canonicalizePath("/results?contestId=abc")).toBe("/results");
  });

  it("lowercases rank position canonical routes", () => {
    expect(rankPositionCanonicalPath("QB")).toBe("/rank/qb");
    expect(rankPositionCanonicalPath("Rb")).toBe("/rank/rb");
    expect(rankPositionCanonicalPath("DEF")).toBe("/rank/def");
  });
});

describe("robots allow/disallow", () => {
  it("disallows private/admin/api/go/rank workspaces without blocking /rankers", () => {
    const rules = buildRobotsRules("https://www.rankeyeq.com");
    expect(rules.sitemap).toBe("https://www.rankeyeq.com/sitemap.xml");
    expect(rules.host).toBe("www.rankeyeq.com");
    expect(rules.rules[0]?.allow).toContain("/");
    expect(ROBOTS_DISALLOW_PATHS).toEqual(
      expect.arrayContaining([
        "/admin",
        "/account",
        "/api/",
        "/go",
        "/signin",
        "/rank$",
        "/rank/",
        "/leaderboards/live",
      ]),
    );
    expect(ROBOTS_DISALLOW_PATHS).not.toContain("/rankers");
    expect(ROBOTS_DISALLOW_PATHS).not.toContain("/players");
  });
});

describe("sitemap inclusion rules", () => {
  it("includes expected public static routes", () => {
    expect(SITEMAP_STATIC_PATHS).toEqual(
      expect.arrayContaining([
        "/",
        "/how-it-works",
        "/results",
        "/leaderboards",
        "/players",
        "/rankers",
        "/legal",
        "/privacy",
        "/terms",
      ]),
    );
  });

  it("excludes private, interactive, and query variants", () => {
    expect(isSitemapExcludedPath("/admin")).toBe(true);
    expect(isSitemapExcludedPath("/account")).toBe(true);
    expect(isSitemapExcludedPath("/api/auth/session")).toBe(true);
    expect(isSitemapExcludedPath("/go")).toBe(true);
    expect(isSitemapExcludedPath("/rank")).toBe(true);
    expect(isSitemapExcludedPath("/rank/qb")).toBe(true);
    expect(isSitemapExcludedPath("/leaderboards/live")).toBe(true);
    expect(isSitemapExcludedPath("/leaderboards?filter=AI")).toBe(true);
    expect(isSitemapExcludedPath("/rankers")).toBe(false);
    expect(isSitemapExcludedPath("/players")).toBe(false);
    expect(isSitemapExcludedPath("/profile/someone")).toBe(false);
  });
});

describe("index metadata helpers", () => {
  it("marks private pages noindex and public pages indexable with canonical", () => {
    delete process.env.AUTH_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.rankeyeq.com";
    expect(NO_INDEX.robots).toEqual({ index: false, follow: false });
    expect(PUBLIC_INDEX.robots).toEqual({ index: true, follow: true });

    const meta = publicPageMetadata({
      title: "Leaderboards",
      description: "EYEQ boards",
      path: "/leaderboards?filter=AI",
    });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe(
      "https://www.rankeyeq.com/leaderboards",
    );
    expect(JSON.stringify(meta)).not.toMatch(/password|session|secret/i);
  });
});
