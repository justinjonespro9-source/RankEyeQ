import { describe, expect, it } from "vitest";
import {
  finalExactHitRowClass,
  provisionalStandingStatus,
  scoreProvisionalEyeq,
  shouldShowFinalExactHit,
} from "@/lib/live-provisional";
import { provisionalRanksFromPoints } from "@/lib/live-rankiq";
import { getTheoreticalMaxScore, scorePlayerPick } from "@/lib/scoring";

describe("provisional standing visuals", () => {
  it("maps current #1/#2/#3 to gold/silver/bronze", () => {
    expect(provisionalStandingStatus(1, 10)).toBe("GOLD");
    expect(provisionalStandingStatus(2, 10)).toBe("SILVER");
    expect(provisionalStandingStatus(3, 10)).toBe("BRONZE");
  });

  it("maps Top 10 / Top 15 in-field to green and outside to neutral", () => {
    expect(provisionalStandingStatus(7, 10)).toBe("IN_FIELD");
    expect(provisionalStandingStatus(10, 10)).toBe("IN_FIELD");
    expect(provisionalStandingStatus(11, 10)).toBe("OUTSIDE_FIELD");
    expect(provisionalStandingStatus(15, 15)).toBe("IN_FIELD");
    expect(provisionalStandingStatus(16, 15)).toBe("OUTSIDE_FIELD");
  });

  it("treats null/unplayed as pending", () => {
    expect(provisionalStandingStatus(null, 10)).toBe("PENDING");
    expect(provisionalStandingStatus(undefined, 10)).toBe("PENDING");
  });
});

describe("scoreProvisionalEyeq — partial week / unresolved", () => {
  it("does not score unresolved players as misses", () => {
    const summary = scoreProvisionalEyeq(
      [
        {
          playerId: "a",
          playerName: "A",
          predictedRank: 1,
          provisionalActualRank: 1,
        },
        {
          playerId: "b",
          playerName: "B",
          predictedRank: 2,
          provisionalActualRank: null,
        },
      ],
      10,
    );

    expect(summary.resolvedCount).toBe(1);
    expect(summary.totalPicks).toBe(2);
    expect(summary.players[1]?.resolved).toBe(false);
    expect(summary.players[1]?.standingStatus).toBe("PENDING");
    expect(summary.players[1]?.breakdown).toBeNull();

    const onlyResolved = scorePlayerPick(
      {
        playerId: "a",
        playerName: "A",
        predictedRank: 1,
        actualRank: 1,
      },
      10,
    );
    expect(summary.rawPoints).toBe(onlyResolved.totalPoints);
    expect(summary.maxPoints).toBe(getTheoreticalMaxScore(10));
    expect(summary.liveEyeqScore).toBeGreaterThan(0);
    expect(summary.liveEyeqScore).toBeLessThan(100);
  });

  it("updates provisional EYEQ as more live ranks resolve", () => {
    const early = scoreProvisionalEyeq(
      [
        {
          playerId: "a",
          playerName: "A",
          predictedRank: 1,
          provisionalActualRank: 2,
        },
        {
          playerId: "b",
          playerName: "B",
          predictedRank: 2,
          provisionalActualRank: null,
        },
      ],
      10,
    );
    const later = scoreProvisionalEyeq(
      [
        {
          playerId: "a",
          playerName: "A",
          predictedRank: 1,
          provisionalActualRank: 2,
        },
        {
          playerId: "b",
          playerName: "B",
          predictedRank: 2,
          provisionalActualRank: 2,
        },
      ],
      10,
    );
    expect(later.resolvedCount).toBe(2);
    expect(later.rawPoints).toBeGreaterThan(early.rawPoints);
    expect(later.liveEyeqScore).toBeGreaterThan(early.liveEyeqScore);
  });

  it("never exposes showExactHit on live provisional rows", () => {
    const summary = scoreProvisionalEyeq(
      [
        {
          playerId: "a",
          playerName: "A",
          predictedRank: 1,
          provisionalActualRank: 1,
        },
      ],
      10,
    );
    expect(summary.players[0]?.breakdown?.exactHit).toBe(true);
    expect(summary.players[0]?.showExactHit).toBe(false);
    expect(summary.exactHitsInternal).toBe(1);
  });

  it("does not write a final normalizedScore (in-memory only)", () => {
    const summary = scoreProvisionalEyeq(
      [
        {
          playerId: "a",
          playerName: "A",
          predictedRank: 1,
          provisionalActualRank: 1,
        },
      ],
      10,
    );
    expect(summary).not.toHaveProperty("normalizedScore");
    expect(typeof summary.liveEyeqScore).toBe("number");
  });
});

describe("exact-hit celebration gating", () => {
  it("is absent while live and present after final grading", () => {
    expect(
      shouldShowFinalExactHit({ exactHit: true, contestIsFinal: false }),
    ).toBe(false);
    expect(
      shouldShowFinalExactHit({ exactHit: true, contestIsFinal: true }),
    ).toBe(true);
    expect(
      shouldShowFinalExactHit({ exactHit: false, contestIsFinal: true }),
    ).toBe(false);
    expect(finalExactHitRowClass(true)).toContain("ring-2");
    expect(finalExactHitRowClass(false)).toBe("");
  });
});

describe("live rank propagation from fantasy points", () => {
  it("Save-like fantasy point changes shift provisional ranks", () => {
    const before = provisionalRanksFromPoints([
      { rankableEntryId: "maye", fantasyPoints: 12 },
      { rankableEntryId: "allen", fantasyPoints: 18 },
      { rankableEntryId: "bench", fantasyPoints: null },
    ]);
    expect(before.map((row) => [row.item.rankableEntryId, row.rank])).toEqual([
      ["allen", 1],
      ["maye", 2],
    ]);

    const after = provisionalRanksFromPoints([
      { rankableEntryId: "maye", fantasyPoints: 28 },
      { rankableEntryId: "allen", fantasyPoints: 18 },
      { rankableEntryId: "bench", fantasyPoints: null },
    ]);
    expect(after.map((row) => [row.item.rankableEntryId, row.rank])).toEqual([
      ["maye", 1],
      ["allen", 2],
    ]);
  });

  it("Clear (null FP) removes player from provisional ranks", () => {
    const cleared = provisionalRanksFromPoints([
      { rankableEntryId: "maye", fantasyPoints: null },
      { rankableEntryId: "allen", fantasyPoints: 18 },
    ]);
    expect(cleared.map((row) => row.item.rankableEntryId)).toEqual(["allen"]);
  });

  it("changed player rank updates multiple user boards via shared provisional map", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "maye", fantasyPoints: 28 },
      { rankableEntryId: "allen", fantasyPoints: 18 },
    ]);
    const byId = new Map(
      ranked.map((row) => [row.item.rankableEntryId, row.rank]),
    );

    const boardA = scoreProvisionalEyeq(
      [
        {
          playerId: "maye",
          playerName: "Maye",
          predictedRank: 7,
          provisionalActualRank: byId.get("maye") ?? null,
        },
      ],
      10,
    );
    const boardB = scoreProvisionalEyeq(
      [
        {
          playerId: "maye",
          playerName: "Maye",
          predictedRank: 1,
          provisionalActualRank: byId.get("maye") ?? null,
        },
      ],
      10,
    );

    expect(boardA.players[0]?.standingStatus).toBe("GOLD");
    expect(boardA.players[0]?.provisionalActualRank).toBe(1);
    expect(boardB.players[0]?.standingStatus).toBe("GOLD");
    expect(boardB.players[0]?.provisionalActualRank).toBe(1);
  });

  it("after Clear, affected board slots return to pending", () => {
    const byId = new Map(
      provisionalRanksFromPoints([
        { rankableEntryId: "maye", fantasyPoints: null },
      ]).map((row) => [row.item.rankableEntryId, row.rank]),
    );
    const summary = scoreProvisionalEyeq(
      [
        {
          playerId: "maye",
          playerName: "Maye",
          predictedRank: 4,
          provisionalActualRank: byId.get("maye") ?? null,
        },
      ],
      10,
    );
    expect(summary.players[0]?.standingStatus).toBe("PENDING");
    expect(summary.resolvedCount).toBe(0);
  });
});
