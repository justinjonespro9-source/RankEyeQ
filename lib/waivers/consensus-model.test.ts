import { describe, expect, it } from "vitest";
import {
  WAIVER_CONSENSUS_MIN_CALLING_BOARDS,
  buildWaiverConsensus,
  formatConsensusPercent,
  publishWaiverConsensus,
} from "@/lib/waivers/consensus-model";

const board = (...ids: string[]) => ({
  abstention: ids.length === 0,
  calls: ids.map((rankableEntryId, i) => ({ slot: i + 1, rankableEntryId })),
});

describe("buildWaiverConsensus", () => {
  it("counts called, WIN and top-3 shares over boards with calls only", () => {
    const consensus = buildWaiverConsensus({
      boards: [board("a", "b", "c"), board("b", "a"), board("a"), board()],
      poolOrder: ["a", "b", "c"],
    });
    expect(consensus.boardCount).toBe(4);
    expect(consensus.callingBoardCount).toBe(3);
    expect(consensus.abstentionCount).toBe(1);
    expect(consensus.rows).toEqual([
      { rankableEntryId: "a", calledCount: 3, winCount: 2, top3Count: 3 },
      { rankableEntryId: "b", calledCount: 2, winCount: 1, top3Count: 2 },
      { rankableEntryId: "c", calledCount: 1, winCount: 0, top3Count: 1 },
    ]);
    expect(formatConsensusPercent(consensus.rows[0].winCount, consensus.callingBoardCount)).toBe("67%");
  });

  it("excludes zero-call boards from the denominator", () => {
    const consensus = buildWaiverConsensus({ boards: [board("a"), board(), board(), board()], poolOrder: ["a"] });
    expect(consensus.callingBoardCount).toBe(1);
    expect(formatConsensusPercent(consensus.rows[0].calledCount, consensus.callingBoardCount)).toBe("100%");
  });

  it("tracks WR slots 4–5 outside the top 3", () => {
    const consensus = buildWaiverConsensus({ boards: [board("a", "b", "c", "d", "e")], poolOrder: ["a", "b", "c", "d", "e"] });
    const e = consensus.rows.find((row) => row.rankableEntryId === "e")!;
    expect(e).toEqual({ rankableEntryId: "e", calledCount: 1, winCount: 0, top3Count: 0 });
  });

  it("breaks ties by WIN calls, then frozen pool order — never alphabetically", () => {
    const consensus = buildWaiverConsensus({
      boards: [board("zed", "amy"), board("amy", "zed"), board("bob")],
      poolOrder: ["bob", "zed", "amy"],
    });
    expect(consensus.rows.map((row) => row.rankableEntryId)).toEqual(["zed", "amy", "bob"]);
    const tied = buildWaiverConsensus({ boards: [board("amy"), board("zed")], poolOrder: ["zed", "amy"] });
    expect(tied.rows.map((row) => row.rankableEntryId)).toEqual(["zed", "amy"]);
  });

  it("handles no boards and all-abstention boards", () => {
    expect(buildWaiverConsensus({ boards: [], poolOrder: [] })).toEqual({
      boardCount: 0,
      callingBoardCount: 0,
      abstentionCount: 0,
      rows: [],
    });
    const allOut = buildWaiverConsensus({ boards: [board(), board()], poolOrder: ["a"] });
    expect(allOut).toMatchObject({ boardCount: 2, callingBoardCount: 0, abstentionCount: 2, rows: [] });
    expect(formatConsensusPercent(0, 0)).toBe("—");
  });
});

describe("publishWaiverConsensus — V1 minimum of 3 boards with calls", () => {
  const publish = (...boards: ReturnType<typeof board>[]) =>
    publishWaiverConsensus(buildWaiverConsensus({ boards, poolOrder: ["a", "b", "c"] }));

  it("uses a threshold of 3", () => {
    expect(WAIVER_CONSENSUS_MIN_CALLING_BOARDS).toBe(3);
  });

  it("withholds everything with 0, 1, or 2 boards", () => {
    expect(publish()).toEqual({ status: "WITHHELD" });
    expect(publish(board("a"))).toEqual({ status: "WITHHELD" });
    expect(publish(board("a", "b"), board("b"))).toEqual({ status: "WITHHELD" });
  });

  it("publishes at exactly 3 boards and above", () => {
    expect(publish(board("a"), board("a", "b"), board("c"))).toMatchObject({
      status: "PUBLISHED",
      callingBoardCount: 3,
      rows: [{ rankableEntryId: "a", calledCount: 2 }, { rankableEntryId: "c", winCount: 1 }, { rankableEntryId: "b", winCount: 0 }],
    });
    expect(publish(board("a"), board("b"), board("c"), board("a"), board("b", "a"))).toMatchObject({
      status: "PUBLISHED",
      callingBoardCount: 5,
    });
  });

  it("never lets zero-call boards satisfy the threshold", () => {
    expect(publish(board("a"), board("b"), board(), board(), board())).toEqual({ status: "WITHHELD" });
    expect(publish(board(), board(), board())).toEqual({ status: "WITHHELD" });
    expect(publish(board("a"), board("b"), board("c"), board())).toMatchObject({
      status: "PUBLISHED",
      callingBoardCount: 3,
      abstentionCount: 1,
    });
  });
});
