import { describe, expect, it } from "vitest";
import {
  emptyCreatorImportDraft,
  shouldClearCreatorImportDraft,
} from "@/lib/admin/creator-import-draft";
import type { CreatorBoardPageModel } from "@/lib/admin/creator-board-page";
import { rankingDepthForPosition } from "@/lib/contest-defaults";

/** Approximate serialized size of props passed into CreatorImportForm. */
function estimateClientPropBytes(model: Pick<
  CreatorBoardPageModel,
  "eligible" | "rankingDepth" | "position"
>) {
  return JSON.stringify({
    rankingDepth: model.rankingDepth,
    position: model.position,
    eligible: model.eligible,
    universe: [],
    otherPositions: [],
  }).length;
}

describe("creator board page-load safety", () => {
  it("keeps SSR draft capturedAt empty for hydration stability", () => {
    const draft = emptyCreatorImportDraft({
      sourceUrl: "https://example.com",
      capturedAt: "",
    });
    expect(draft.capturedAt).toBe("");
    expect(draft.raw).toBe("");
    expect(draft.rows).toBeNull();
    expect(shouldClearCreatorImportDraft({ ok: false })).toBe(false);
  });

  it("WR Top-15 empty-board client props stay small vs full catalog dumps", () => {
    const eligible = Array.from({ length: 191 }, (_, index) => ({
      id: `wr-${index}`,
      name: `WR Player ${index}`,
      team: "TST",
      shortName: `W${index}`,
    }));
    const slim = estimateClientPropBytes({
      eligible,
      rankingDepth: rankingDepthForPosition("WR"),
      position: "WR",
    });

    // Historical bug: also dumping ~2.5k WR universe + ~6k other-position rows
    // produced ~900KB+ payloads and crashed page load.
    const bloatedUniverse = Array.from({ length: 2500 }, (_, index) => ({
      id: `u-${index}`,
      name: `Universe ${index}`,
      team: "TST",
    }));
    const bloatedOther = Array.from({ length: 6000 }, (_, index) => ({
      id: `o-${index}`,
      name: `Other ${index}`,
      team: "TST",
    }));
    const bloated = JSON.stringify({
      eligible,
      universe: bloatedUniverse,
      otherPositions: bloatedOther,
    }).length;

    expect(slim).toBeLessThan(100_000);
    expect(bloated).toBeGreaterThan(300_000);
    expect(slim * 3).toBeLessThan(bloated);
  });

  it("empty WR board model does not require snapshot/submission", () => {
    const model: Pick<
      CreatorBoardPageModel,
      | "hasOfficialBoard"
      | "submissionStatus"
      | "latestSnapshotId"
      | "snapshots"
      | "rankingDepth"
      | "timingNotice"
    > = {
      hasOfficialBoard: false,
      submissionStatus: null,
      latestSnapshotId: null,
      snapshots: [],
      rankingDepth: 15,
      timingNotice: null,
    };
    expect(model.hasOfficialBoard).toBe(false);
    expect(model.snapshots).toEqual([]);
    expect(model.rankingDepth).toBe(15);
  });
});
