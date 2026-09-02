import { describe, expect, it } from "vitest";
import { buildProfileOverview } from "@/lib/profile-modules";

describe("profile product modules", () => {
  it("reports RankEyeQ participation without fabricating other products", async () => {
    const overview = await buildProfileOverview({
      profileId: "profile_test",
      username: "tester",
      rankiqContestsPlayed: 3,
      recentHistory: [],
    });

    expect(overview.products.find((p) => p.key === "rankiq")?.participated).toBe(
      true,
    );
    expect(
      overview.products.find((p) => p.key === "handicap-hero")?.participated,
    ).toBe(false);
    expect(
      overview.products.find((p) => p.key === "fantasytrack")?.participated,
    ).toBe(false);
  });

  it("keeps products independent — no combined score", async () => {
    const overview = await buildProfileOverview({
      profileId: "profile_test",
      username: "tester",
      rankiqContestsPlayed: 10,
      recentHistory: [
        {
          weekLabel: "Week 1",
          position: "RB",
          normalizedScore: 88,
          href: "/profile/tester/rankings/1/rb",
        },
      ],
    });

    expect(overview.recentRankEyeQ).toHaveLength(1);
    expect(Object.keys(overview)).not.toContain("combinedScore");
  });
});
