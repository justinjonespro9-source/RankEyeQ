import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/social-actions", () => ({
  followProfileAction: vi.fn(),
  unfollowProfileAction: vi.fn(),
}));

import { LeaderboardIdentity, type LeaderboardIdentityProfile } from "@/components/leaderboards/LeaderboardIdentity";
import { LeaderboardRowMetrics } from "@/components/leaderboards/LeaderboardRowMetrics";
import { WaiverRowMetrics } from "@/components/leaderboards/WaiverRowMetrics";
import type { ProfileType } from "@/lib/generated/prisma/client";
import { leaderboardHref } from "@/lib/leaderboard-url";
import { followControlFor, type FollowViewer } from "@/lib/social/follow-eligibility";

const ROOT = process.cwd();
const VIEWER: FollowViewer = { signedIn: true, profileId: "viewer", profileType: "HUMAN", status: "ACTIVE" };

function profile(id: string, profileType: ProfileType, extra: Partial<LeaderboardIdentityProfile> = {}): LeaderboardIdentityProfile {
  return {
    universalProfileId: id,
    username: `${id}_handle`,
    displayName: `${id} name`,
    avatarUrl: null,
    profileType,
    expertPublisher: null,
    expertSourceKind: null,
    creatorBrand: null,
    ...extra,
  };
}

function renderIdentity(target: LeaderboardIdentityProfile, viewer: FollowViewer = VIEWER) {
  const control = followControlFor({
    viewer,
    target: { profileId: target.universalProfileId, profileType: target.profileType, expertSourceKind: target.expertSourceKind },
  });
  return {
    control,
    html: renderToStaticMarkup(
      createElement(LeaderboardIdentity, { profile: target, follow: { control, initialFollowing: false } }),
    ),
  };
}

const TARGETS: Array<[string, LeaderboardIdentityProfile, string]> = [
  ["1: HUMAN", profile("human", "HUMAN"), "PUBLIC"],
  ["2: CREATOR", profile("creator", "CREATOR", { creatorBrand: "Fantasy Show" }), "CREATOR"],
  ["3: EXPERT", profile("expert", "BENCHMARK", { expertSourceKind: "ANALYST", expertPublisher: "FantasyPros" }), "EXPERT"],
  ["4: AI", profile("ai", "AI"), "AI"],
];

describe("Follow in the leaderboard identity block", () => {
  for (const [name, target, chip] of TARGETS) {
    it(`${name} profiles show Follow next to the identity chip`, () => {
      const { control, html } = renderIdentity(target);
      expect(control).toBe("follow");
      expect(html).toContain(`@${target.username}`);
      expect(html).toContain(chip);
      expect(html).toMatch(/<button[^>]*>Follow<\/button>/);
      expect(html.indexOf(chip)).toBeLessThan(html.indexOf(">Follow<"));
    });
  }

  it("Publisher / site consensus, legacy publisher shells and unclassified benchmarks are never followable", () => {
    for (const expertSourceKind of ["PUBLISHER_CONSENSUS", "SITE_CONSENSUS", "PUBLISHER", null]) {
      const consensus = profile("pc", "BENCHMARK", { expertSourceKind, expertPublisher: "FantasyPros ECR" });
      const signedIn = renderIdentity(consensus);
      expect(signedIn.control, String(expertSourceKind)).toBe("hidden");
      expect(signedIn.html).not.toContain(">Follow<");
      const signedOut = renderIdentity(consensus, { signedIn: false, profileId: null, profileType: null });
      expect(signedOut.control).toBe("hidden");
      expect(signedOut.html).not.toContain("Sign in to follow");
    }
  });

  it("identifiable Experts are distinguished by their ANALYST source, not by name or handle", () => {
    for (const [name, publication] of [
      ["Hayden Winks", "Yahoo Fantasy"],
      ["Pat Fitzmaurice", "FantasyPros"],
      ["Justin Boone", "Yahoo Fantasy"],
    ]) {
      const expert = profile("x", "BENCHMARK", { displayName: name, expertSourceKind: "ANALYST", expertPublisher: publication });
      expect(renderIdentity(expert).control).toBe("follow");
      expect(renderIdentity({ ...expert, expertSourceKind: "PUBLISHER_CONSENSUS" }).control).toBe("hidden");
    }
  });

  it("5: Follow is hidden on the viewer's own profile row", () => {
    const own = profile("viewer", "HUMAN");
    const { control, html } = renderIdentity(own);
    expect(control).toBe("hidden");
    expect(html).not.toContain(">Follow<");
    expect(html).not.toContain("Sign in to follow");
  });

  it("signed-out viewers keep the existing Sign in to follow convention", () => {
    const { control, html } = renderIdentity(profile("expert", "BENCHMARK", { expertSourceKind: "ANALYST" }), {
      signedIn: false,
      profileId: null,
      profileType: null,
    });
    expect(control).toBe("sign-in");
    expect(html).toContain("Sign in to follow");
    expect(html).toContain("/signin?callbackUrl=/following");
  });

  it("non-human or suspended viewers, and suspended targets, never get a Follow control", () => {
    const target = { profileId: "t", profileType: "HUMAN" as const, expertSourceKind: null };
    expect(followControlFor({ viewer: VIEWER, target })).toBe("follow");
    expect(followControlFor({ viewer: { ...VIEWER, profileType: "AI" }, target })).toBe("hidden");
    expect(followControlFor({ viewer: { ...VIEWER, profileType: "BENCHMARK" }, target })).toBe("hidden");
    expect(followControlFor({ viewer: { ...VIEWER, status: "SUSPENDED" }, target })).toBe("hidden");
    expect(followControlFor({ viewer: { ...VIEWER, profileId: null }, target })).toBe("hidden");
    expect(followControlFor({ viewer: VIEWER, target: { ...target, status: "SUSPENDED" } })).toBe("hidden");
  });
});

describe("leaderboard row layout", () => {
  const page = readFileSync(path.join(ROOT, "app/leaderboards/page.tsx"), "utf8");
  const tables = readFileSync(path.join(ROOT, "components/leaderboards/LeaderboardTables.tsx"), "utf8");

  it("6: no right-side Follow column — Follow renders only inside the identity block", () => {
    expect(page).not.toMatch(/FollowButton/);
    expect(tables).not.toMatch(/FollowButton/);
    const rankingsMetrics = renderToStaticMarkup(
      createElement(LeaderboardRowMetrics, {
        row: { averageScore: 71.2, bestScore: 80, topNHitRate: 0.5, exactHits: 2, numberOneHits: 1, contestsPlayed: 3 },
      }),
    );
    const waiverMetrics = renderToStaticMarkup(
      createElement(WaiverRowMetrics, {
        row: {
          universalProfileId: "p",
          rank: 1,
          played: 1,
          calls: 3,
          avgEyeqHundredths: 6500,
          fpPerCallHundredths: 1200,
          fpPerAvailableSlotHundredths: 1200,
          perfectCalls: 1,
        },
      }),
    );
    for (const html of [rankingsMetrics, waiverMetrics]) {
      expect(html).not.toMatch(/Follow/);
      expect(html).toContain("sm:w-[30rem]");
      expect(html).toContain("sm:grid-cols-6");
    }
    for (const table of ["function BoardTable", "function WaiverBoardTable"]) {
      const start = tables.indexOf(table);
      expect(start).toBeGreaterThan(-1);
      const body = tables.slice(start, tables.indexOf("\n}\n", start));
      const identityAt = body.indexOf("<LeaderboardIdentity");
      const metricsAt = body.search(/<(LeaderboardRowMetrics|WaiverRowMetrics)/);
      expect(identityAt).toBeGreaterThan(-1);
      expect(metricsAt).toBeGreaterThan(identityAt);
      expect(body.slice(metricsAt)).not.toMatch(/Follow/);
    }
  });

  it("7: Rankings leaderboard URLs and metrics are unchanged", () => {
    expect(leaderboardHref({ discipline: "rankings", scope: "weekly", position: "QB", filter: "ALL", week: 4 })).toBe(
      "/leaderboards?scope=weekly&position=QB&filter=ALL&week=4",
    );
    expect(leaderboardHref({ discipline: "rankings", scope: "season", position: "ALL", filter: "EXPERT" })).toBe(
      "/leaderboards?scope=season&position=ALL&filter=EXPERT",
    );
    const html = renderToStaticMarkup(
      createElement(LeaderboardRowMetrics, {
        row: { averageScore: 71.2, bestScore: 80, topNHitRate: 0.5, exactHits: 2, numberOneHits: 1, contestsPlayed: 3 },
      }),
    );
    const labels = [...html.matchAll(/uppercase[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Avg EYEQ", "Top-N", "Exact", "Best", "Winners", "Played"]);
    expect(page).toMatch(/getWeeklyLeaderboard\(/);
    expect(page).toMatch(/getSeasonLeaderboard\(/);
  });

  it("16: Rankings and Waivers rows share one follow relationship and control", () => {
    expect(page.match(/getFollowingIdSet\(/g)).toHaveLength(1);
    expect(page.match(/followControlFor\(/g)).toHaveLength(1);
    expect(page).toMatch(/<BoardTable[^>]*follow=\{follow\}/);
    expect(page).toMatch(/<WaiverBoardTable[^>]*follow=\{follow\}/);
    const button = readFileSync(path.join(ROOT, "components/social/FollowButton.tsx"), "utf8");
    expect(button).toMatch(/followProfileAction\(targetProfileId\)/);
    expect(button).not.toMatch(/discipline|waiver/i);
  });
});
