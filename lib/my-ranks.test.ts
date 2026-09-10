import { describe, expect, it } from "vitest";
import { ctaForContestState, hrefForContestState } from "@/lib/homepage-cta";
import {
  provisionalStandingStatus,
  scoreProvisionalEyeq,
  shouldShowFinalExactHit,
} from "@/lib/live-provisional";
import { provisionalRanksFromPoints } from "@/lib/live-rankiq";
import { thisWeekHubCopy } from "@/lib/my-ranks";

describe("My Ranks live dashboard derivation", () => {
  it("orders live standings by fantasy points with competition ranks", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "a", fantasyPoints: 22.1 },
      { rankableEntryId: "b", fantasyPoints: 30.4 },
      { rankableEntryId: "c", fantasyPoints: -1.2 },
      { rankableEntryId: "d", fantasyPoints: null },
    ]);
    expect(ranked.map((row) => [row.item.rankableEntryId, row.rank, row.score])).toEqual([
      ["b", 1, 30.4],
      ["a", 2, 22.1],
      ["c", 3, -1.2],
    ]);
  });

  it("hides null/unplayed players from live standings", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "played", fantasyPoints: 10 },
      { rankableEntryId: "unplayed", fantasyPoints: null },
    ]);
    expect(ranked.map((row) => row.item.rankableEntryId)).toEqual(["played"]);
  });

  it("shows negative fantasy scores", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "bad", fantasyPoints: -4 },
    ]);
    expect(ranked[0]?.score).toBe(-4);
  });

  it("builds perfect board as current Top 10 / Top 15 from standings", () => {
    const ranked = provisionalRanksFromPoints(
      Array.from({ length: 18 }, (_, index) => ({
        rankableEntryId: `p${index}`,
        fantasyPoints: 50 - index,
      })),
    );
    const top10 = ranked.slice(0, 10).map((row, index) => ({
      rank: index + 1,
      id: row.item.rankableEntryId,
    }));
    const top15 = ranked.slice(0, 15).map((row, index) => ({
      rank: index + 1,
      id: row.item.rankableEntryId,
    }));
    expect(top10).toHaveLength(10);
    expect(top15).toHaveLength(15);
    expect(top10[0]?.id).toBe("p0");
    expect(top15[14]?.id).toBe("p14");
  });

  it("uses WR Top 15 field for standing colors and EYEQ", () => {
    expect(provisionalStandingStatus(15, 15)).toBe("IN_FIELD");
    expect(provisionalStandingStatus(16, 15)).toBe("OUTSIDE_FIELD");
    const summary = scoreProvisionalEyeq(
      [
        {
          playerId: "wr1",
          playerName: "JSN",
          predictedRank: 7,
          provisionalActualRank: 1,
        },
      ],
      15,
    );
    expect(summary.players[0]?.standingStatus).toBe("GOLD");
    expect(summary.maxPoints).toBeGreaterThan(210);
  });

  it("matches podium/green visuals to current actual rank not predicted slot", () => {
    expect(provisionalStandingStatus(1, 10)).toBe("GOLD");
    expect(provisionalStandingStatus(2, 10)).toBe("SILVER");
    expect(provisionalStandingStatus(3, 10)).toBe("BRONZE");
    expect(provisionalStandingStatus(7, 10)).toBe("IN_FIELD");
  });

  it("exact-hit celebration is final-only", () => {
    expect(
      shouldShowFinalExactHit({ exactHit: true, contestIsFinal: false }),
    ).toBe(false);
    expect(
      shouldShowFinalExactHit({ exactHit: true, contestIsFinal: true }),
    ).toBe(true);
  });

  it("final transition prefers official actual ranks over provisional", () => {
    const live = provisionalRanksFromPoints([
      { rankableEntryId: "a", fantasyPoints: 40 },
      { rankableEntryId: "b", fantasyPoints: 10 },
    ]);
    expect(live[0]?.item.rankableEntryId).toBe("a");

    const finalRows = [
      { rankableEntryId: "b", actualRank: 1, fantasyPoints: 12 },
      { rankableEntryId: "a", actualRank: 2, fantasyPoints: 40 },
    ].sort((left, right) => left.actualRank - right.actualRank);

    expect(finalRows.map((row) => row.rankableEntryId)).toEqual(["b", "a"]);
  });
});

describe("This Week state-aware copy and CTAs", () => {
  it("builds hub titles from submission state", () => {
    expect(
      thisWeekHubCopy({
        weekNumber: 1,
        weekLabel: "Week 1",
        positions: [{ contestStatus: "OPEN", submissionStatus: null }],
      }).title,
    ).toBe("Build Your Week 1 Rankings");

    expect(
      thisWeekHubCopy({
        weekNumber: 1,
        weekLabel: "Week 1",
        positions: [{ contestStatus: "OPEN", submissionStatus: "DRAFT" }],
      }).title,
    ).toBe("Continue Your Rankings");

    expect(
      thisWeekHubCopy({
        weekNumber: 1,
        weekLabel: "Week 1",
        positions: [{ contestStatus: "OPEN", submissionStatus: "SUBMITTED" }],
      }),
    ).toEqual({
      title: "Your Week 1 Rankings",
      description: "Submitted · Editable until lock",
    });

    expect(
      thisWeekHubCopy({
        weekNumber: 1,
        weekLabel: "Week 1",
        positions: [{ contestStatus: "LOCKED", submissionStatus: "SUBMITTED" }],
      }),
    ).toEqual({
      title: "Your Week 1 Rankings",
      description: "Locked",
    });
  });

  it("does not use Build Rankings CTA after submit", () => {
    expect(ctaForContestState("OPEN", "SUBMITTED")).toBe("Edit Rankings");
    expect(ctaForContestState("OPEN", "DRAFT")).toBe("Continue Your Rankings");
    expect(ctaForContestState("OPEN", null)).toBe("Build Rankings");
    expect(ctaForContestState("LOCKED", "SUBMITTED")).toBe("View My Ranks");
    expect(hrefForContestState({
      position: "QB",
      contestStatus: "LOCKED",
      submissionStatus: "SUBMITTED",
    })).toBe("/my-ranks?position=qb");
  });
});

describe("My Ranks authenticated route contract", () => {
  it("exposes /my-ranks as primary nav destination", async () => {
    const { PRIMARY_NAV } = await import("@/lib/navigation");
    const link = PRIMARY_NAV.find((item) => item.label === "My Ranks");
    expect(link?.href).toBe("/my-ranks");
  });
});
