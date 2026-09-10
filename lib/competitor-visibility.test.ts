import { describe, expect, it } from "vitest";
import {
  authorizePublicUpdate,
  competitorVisibilityBadgeLabel,
  demoteToPrivateTracked,
  profileAppearsOnPublicSurfaces,
  profileContributesToPublicConsensus,
  resolveCompetitorVisibility,
  setInactiveVisibility,
  supportsPrivateTracking,
  weekIsPubliclyVisibleForProfile,
} from "@/lib/competitor-visibility";
import { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";

const week1 = {
  id: "w1",
  seasonId: "s1",
  weekNumber: 1,
  startsAt: new Date("2026-09-01"),
};
const week3 = {
  id: "w3",
  seasonId: "s1",
  weekNumber: 3,
  startsAt: new Date("2026-09-15"),
};

describe("competitor visibility state model", () => {
  it("maps existing flags to PRIVATE_TRACKED / AUTHORIZED_PUBLIC / INACTIVE", () => {
    expect(
      resolveCompetitorVisibility({
        profileType: "BENCHMARK",
        competitorActive: true,
        publicVisible: false,
      }),
    ).toBe("PRIVATE_TRACKED");
    expect(
      resolveCompetitorVisibility({
        profileType: "CREATOR",
        competitorActive: true,
        publicVisible: true,
      }),
    ).toBe("AUTHORIZED_PUBLIC");
    expect(
      resolveCompetitorVisibility({
        profileType: "CREATOR",
        competitorActive: false,
        publicVisible: false,
      }),
    ).toBe("INACTIVE");
  });

  it("labels badges for admin UI", () => {
    expect(competitorVisibilityBadgeLabel("PRIVATE_TRACKED")).toBe(
      "PRIVATE TRACKED",
    );
    expect(competitorVisibilityBadgeLabel("AUTHORIZED_PUBLIC")).toBe("PUBLIC");
    expect(competitorVisibilityBadgeLabel("INACTIVE")).toBe("INACTIVE");
  });

  it("supports private tracking only for Experts and Creators", () => {
    expect(supportsPrivateTracking("BENCHMARK")).toBe(true);
    expect(supportsPrivateTracking("CREATOR")).toBe(true);
    expect(supportsPrivateTracking("AI")).toBe(false);
    expect(supportsPrivateTracking("HUMAN")).toBe(false);
  });

  it("keeps private tracked off every public surface", () => {
    const privateExpert = {
      profileType: "BENCHMARK" as const,
      competitorActive: true,
      publicVisible: false,
    };
    const privateCreator = {
      profileType: "CREATOR" as const,
      competitorActive: true,
      publicVisible: false,
    };
    expect(profileAppearsOnPublicSurfaces(privateExpert)).toBe(false);
    expect(profileAppearsOnPublicSurfaces(privateCreator)).toBe(false);
    expect(profileContributesToPublicConsensus(privateExpert)).toBe(false);
    expect(profileContributesToPublicConsensus(privateCreator)).toBe(false);
  });

  it("authorization from_now gates prior weeks; expose_history clears gate", () => {
    const fromNow = authorizePublicUpdate({
      historyMode: "from_now",
      currentWeekId: "w3",
    });
    expect(fromNow).toEqual({
      publicVisible: true,
      competitorActive: true,
      publicFromWeekId: "w3",
    });

    const expose = authorizePublicUpdate({
      historyMode: "expose_history",
      currentWeekId: "w3",
    });
    expect(expose.publicFromWeekId).toBeNull();
    expect(expose.publicVisible).toBe(true);
  });

  it("public-from-now keeps prior weeks hidden and later weeks visible", () => {
    const profile = {
      profileType: "CREATOR" as const,
      competitorActive: true,
      publicVisible: true,
      publicFromWeekId: "w3",
      publicFromWeek: week3,
    };
    expect(weekIsPubliclyVisibleForProfile(profile, week1)).toBe(false);
    expect(weekIsPubliclyVisibleForProfile(profile, week3)).toBe(true);
  });

  it("expose-history reveals prior authorized history", () => {
    const profile = {
      profileType: "BENCHMARK" as const,
      competitorActive: true,
      publicVisible: true,
      publicFromWeekId: null,
      publicFromWeek: null,
    };
    expect(weekIsPubliclyVisibleForProfile(profile, week1)).toBe(true);
    expect(weekIsPubliclyVisibleForProfile(profile, week3)).toBe(true);
  });

  it("inactive preserves ability to demote without deleting history flags", () => {
    expect(setInactiveVisibility()).toEqual({
      competitorActive: false,
      publicVisible: false,
      publicFromWeekId: null,
    });
    expect(demoteToPrivateTracked()).toEqual({
      publicVisible: false,
      competitorActive: true,
      publicFromWeekId: null,
    });
  });
});

describe("private competitors excluded from public consensus", () => {
  const ballots = [
    {
      id: "private-expert",
      status: "SUBMITTED" as const,
      profileType: "BENCHMARK" as const,
      sourceKind: "ANALYST",
      competitorActive: true,
      publicVisible: false,
      picks: [{ rankableEntryId: "p1", predictedRank: 1 }],
    },
    {
      id: "public-expert",
      status: "SUBMITTED" as const,
      profileType: "BENCHMARK" as const,
      sourceKind: "ANALYST",
      competitorActive: true,
      publicVisible: true,
      picks: [{ rankableEntryId: "p1", predictedRank: 2 }],
    },
    {
      id: "private-creator",
      status: "LOCKED" as const,
      profileType: "CREATOR" as const,
      competitorActive: true,
      publicVisible: false,
      picks: [{ rankableEntryId: "p1", predictedRank: 3 }],
    },
    {
      id: "public-creator",
      status: "LOCKED" as const,
      profileType: "CREATOR" as const,
      competitorActive: true,
      publicVisible: true,
      picks: [{ rankableEntryId: "p1", predictedRank: 4 }],
    },
  ];

  it("excludes private Expert and Creator from every public consensus segment", () => {
    expect(
      filterEligibleConsensusSubmissions(ballots, "EXPERT").map((b) => b.id),
    ).toEqual(["public-expert"]);
    expect(
      filterEligibleConsensusSubmissions(ballots, "CREATOR").map((b) => b.id),
    ).toEqual(["public-creator"]);
    expect(
      filterEligibleConsensusSubmissions(ballots, "ALL").map((b) => b.id),
    ).toEqual([]);
  });

  it("excludes gated pre-authorization weeks even when publicVisible", () => {
    const gated = [
      {
        id: "pre",
        status: "GRADED" as const,
        profileType: "CREATOR" as const,
        competitorActive: true,
        publicVisible: true,
        publicFromWeekId: "w3",
        publicFromWeek: week3,
        week: week1,
        picks: [{ rankableEntryId: "p1", predictedRank: 1 }],
      },
      {
        id: "post",
        status: "GRADED" as const,
        profileType: "CREATOR" as const,
        competitorActive: true,
        publicVisible: true,
        publicFromWeekId: "w3",
        publicFromWeek: week3,
        week: week3,
        picks: [{ rankableEntryId: "p1", predictedRank: 2 }],
      },
    ];
    expect(
      filterEligibleConsensusSubmissions(gated, "CREATOR").map((b) => b.id),
    ).toEqual(["post"]);
  });
});
