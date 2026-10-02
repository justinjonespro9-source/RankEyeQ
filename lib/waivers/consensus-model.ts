/**
 * Post-lock Waiver consensus from competitive (locked) boards only. Boards
 * with zero calls are counted as abstentions and excluded from the player
 * percentage denominator. Pure: callers must only pass revealable boards.
 */

export type WaiverConsensusBoard = {
  abstention: boolean;
  calls: ReadonlyArray<{ slot: number; rankableEntryId: string }>;
};

export type WaiverConsensusRow = {
  rankableEntryId: string;
  /** Boards that called the player in any slot. */
  calledCount: number;
  winCount: number;
  /** Boards that called the player in slots 1–3. */
  top3Count: number;
};

export type WaiverConsensus = {
  /** Competitive boards, including abstentions. */
  boardCount: number;
  /** Denominator for every player percentage: boards with at least one call. */
  callingBoardCount: number;
  abstentionCount: number;
  rows: WaiverConsensusRow[];
};

/**
 * Rows sort by most called, then most WIN calls, then frozen pool order —
 * never alphabetically. Players outside `poolOrder` sort after it, by id.
 */
export function buildWaiverConsensus(input: {
  boards: ReadonlyArray<WaiverConsensusBoard>;
  poolOrder: ReadonlyArray<string>;
}): WaiverConsensus {
  const rank = new Map(input.poolOrder.map((id, index) => [id, index]));
  const byPlayer = new Map<string, WaiverConsensusRow>();
  let callingBoardCount = 0;
  let abstentionCount = 0;

  for (const board of input.boards) {
    if (board.abstention || board.calls.length === 0) {
      abstentionCount += 1;
      continue;
    }
    callingBoardCount += 1;
    const seen = new Set<string>();
    for (const call of board.calls) {
      if (seen.has(call.rankableEntryId)) continue;
      seen.add(call.rankableEntryId);
      const row = byPlayer.get(call.rankableEntryId) ?? {
        rankableEntryId: call.rankableEntryId,
        calledCount: 0,
        winCount: 0,
        top3Count: 0,
      };
      row.calledCount += 1;
      if (call.slot === 1) row.winCount += 1;
      if (call.slot <= 3) row.top3Count += 1;
      byPlayer.set(call.rankableEntryId, row);
    }
  }

  const rows = [...byPlayer.values()].sort((a, b) => {
    if (b.calledCount !== a.calledCount) return b.calledCount - a.calledCount;
    if (b.winCount !== a.winCount) return b.winCount - a.winCount;
    const ra = rank.get(a.rankableEntryId) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.rankableEntryId) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.rankableEntryId < b.rankableEntryId ? -1 : a.rankableEntryId > b.rankableEntryId ? 1 : 0;
  });

  return {
    boardCount: callingBoardCount + abstentionCount,
    callingBoardCount,
    abstentionCount,
    rows,
  };
}

/**
 * V1 privacy floor: consensus is shown only once this many competitive boards
 * with at least one call exist. Zero-call boards never count toward it.
 */
export const WAIVER_CONSENSUS_MIN_CALLING_BOARDS = 3;

export type PublishedWaiverConsensus =
  | { status: "WITHHELD" }
  | ({ status: "PUBLISHED" } & WaiverConsensus);

/**
 * Below the floor nothing derived from individual boards is returned — no
 * rows, percentages, selection counts, or board counts.
 */
export function publishWaiverConsensus(consensus: WaiverConsensus): PublishedWaiverConsensus {
  if (consensus.callingBoardCount < WAIVER_CONSENSUS_MIN_CALLING_BOARDS) return { status: "WITHHELD" };
  return { status: "PUBLISHED", ...consensus };
}

/** Whole-number percentage of calling boards; "—" when there are none. */
export function formatConsensusPercent(count: number, callingBoardCount: number): string {
  if (callingBoardCount <= 0) return "—";
  return `${Math.round((count * 100) / callingBoardCount)}%`;
}
