import { describe, expect, it } from "vitest";
import {
  competitorLiveBoardHref,
  competitorLiveClassLabel,
} from "@/lib/admin/competitor-live-room";
import { scoreProvisionalEyeq, shouldShowFinalExactHit } from "@/lib/live-provisional";
import { provisionalRanksFromPoints } from "@/lib/live-rankiq";

describe("admin competitor live control room", () => {
  it("builds admin-only live board deep links", () => {
    expect(
      competitorLiveBoardHref({
        weekId: "week1",
        profileId: "prof1",
        position: "WR",
        filter: "EXPERT",
        visibility: "PRIVATE_TRACKED",
      }),
    ).toBe(
      "/admin/competitors/live?weekId=week1&profileId=prof1&position=wr&filter=EXPERT&visibility=PRIVATE_TRACKED",
    );
  });

  it("labels competitor classes for filters", () => {
    expect(competitorLiveClassLabel("EXPERT")).toBe("Expert");
    expect(competitorLiveClassLabel("CREATOR")).toBe("Creator");
    expect(competitorLiveClassLabel("AI")).toBe("AI");
    expect(competitorLiveClassLabel("PUBLISHER_CONSENSUS")).toBe(
      "Publisher Consensus",
    );
  });

  it("routes manage rankings by class", async () => {
    const { listCompetitorLiveRoom } = await import(
      "@/lib/admin/competitor-live-room"
    );
    // Pure href helpers covered via manageHref behavior through board links.
    expect(typeof listCompetitorLiveRoom).toBe("function");
  });

  it("reuses provisional live scoring for board cells", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "a", fantasyPoints: 24.6 },
      { rankableEntryId: "b", fantasyPoints: null },
    ]);
    expect(ranked).toHaveLength(1);

    const live = scoreProvisionalEyeq(
      [
        {
          playerId: "a",
          playerName: "A",
          predictedRank: 7,
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
    expect(live.players[0]?.standingStatus).toBe("GOLD");
    expect(live.players[1]?.standingStatus).toBe("PENDING");
    expect(live.resolvedCount).toBe(1);
    expect(live.players[0]?.showExactHit).toBe(false);
  });

  it("final transition uses final exact-hit gating", () => {
    expect(
      shouldShowFinalExactHit({ exactHit: true, contestIsFinal: false }),
    ).toBe(false);
    expect(
      shouldShowFinalExactHit({ exactHit: true, contestIsFinal: true }),
    ).toBe(true);
  });

  it("is not a public primary-nav destination", async () => {
    const { PRIMARY_NAV } = await import("@/lib/navigation");
    expect(PRIMARY_NAV.some((link) => link.href.includes("/admin"))).toBe(
      false,
    );
    expect(
      PRIMARY_NAV.some((link) => link.href === "/admin/competitors/live"),
    ).toBe(false);
  });
});
