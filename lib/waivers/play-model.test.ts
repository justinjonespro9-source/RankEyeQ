import { describe, expect, it } from "vitest";
import {
  WAIVER_PLAY_STATE_COPY,
  WAIVER_VIEWER_STATUS_LABEL,
  addWaiverCall,
  formatRosteredPercent,
  formatWaiverMatchup,
  moveWaiverCall,
  parseWaiverPlayPosition,
  removeWaiverCall,
  resolveWaiverMatchupSide,
  resolveWaiverPlayState,
  resolveWaiverViewerBoardStatus,
  sameWaiverCalls,
  selectWaiverPlayWeek,
  waiverAddBlockReason,
  waiverAvailabilityLabel,
  waiverAvailableSlots,
  waiverBoardHint,
  waiverBoardSummary,
  waiverCallCountLabel,
  waiverPlayHref,
  waiverSignInHref,
  waiverSlotLabels,
  waiverSubmitFeedback,
} from "@/lib/waivers/play-model";

const NOW = new Date("2026-10-06T15:00:00.000Z");
const pool = new Set(["a", "b", "c", "d", "e", "f"]);

describe("routing", () => {
  it("parses ?position= case-insensitively and defaults to QB", () => {
    expect(parseWaiverPlayPosition("RB")).toBe("RB");
    expect(parseWaiverPlayPosition("wr")).toBe("WR");
    expect(parseWaiverPlayPosition(" def ")).toBe("DEF");
    expect(parseWaiverPlayPosition(["TE", "QB"])).toBe("TE");
    expect(parseWaiverPlayPosition("K")).toBe("QB");
    expect(parseWaiverPlayPosition(undefined)).toBe("QB");
    expect(parseWaiverPlayPosition("<script>")).toBe("QB");
  });

  it("builds position and sign-in hrefs that preserve the return route", () => {
    expect(waiverPlayHref("RB")).toBe("/waivers?position=RB");
    expect(waiverSignInHref("WR")).toBe("/signin?callbackUrl=%2Fwaivers%3Fposition%3DWR");
    expect(decodeURIComponent(waiverSignInHref("WR").split("=").slice(1).join("="))).toBe("/waivers?position=WR");
  });
});

describe("week selection", () => {
  const week = (weekNumber: number, hasWaiverActivity: boolean, kickoff: string | null) => ({
    weekId: `w${weekNumber}`,
    weekNumber,
    hasWaiverActivity,
    firstKickoffAt: kickoff ? new Date(kickoff) : null,
  });

  it("prefers the latest week with Waivers activity, even after its lock", () => {
    const selected = selectWaiverPlayWeek(
      [week(4, true, "2026-10-01T00:00:00Z"), week(5, true, "2026-10-08T00:00:00Z"), week(6, false, "2026-10-15T00:00:00Z")],
      NOW,
    );
    expect(selected).toEqual({ weekId: "w5", hasWaiverActivity: true });
  });

  it("falls back to the next week whose first kickoff is ahead (pool being prepared)", () => {
    const selected = selectWaiverPlayWeek(
      [week(4, false, "2026-10-01T00:00:00Z"), week(6, false, "2026-10-15T00:00:00Z"), week(5, false, "2026-10-08T00:00:00Z")],
      NOW,
    );
    expect(selected).toEqual({ weekId: "w5", hasWaiverActivity: false });
  });

  it("returns null with no activity and no upcoming kickoff", () => {
    expect(selectWaiverPlayWeek([week(1, false, "2026-09-10T00:00:00Z"), week(2, false, null)], NOW)).toBeNull();
    expect(selectWaiverPlayWeek([], NOW)).toBeNull();
  });
});

describe("position state", () => {
  const base = { hasWeek: true, hasCurrentSnapshot: true, snapshotEligibleAtPosition: 10, contest: null };

  it("covers every pre-contest state", () => {
    expect(resolveWaiverPlayState({ ...base, hasWeek: false })).toBe("NO_WEEK");
    expect(resolveWaiverPlayState({ ...base, hasCurrentSnapshot: false })).toBe("POOL_PREPARING");
    expect(resolveWaiverPlayState(base)).toBe("POOL_READY");
    expect(resolveWaiverPlayState({ ...base, snapshotEligibleAtPosition: 0 })).toBe("NO_PLAYERS");
  });

  it("uses the server-derived lock flag for contests", () => {
    expect(resolveWaiverPlayState({ ...base, contest: { locked: false, poolSize: 4 } })).toBe("OPEN");
    expect(resolveWaiverPlayState({ ...base, contest: { locked: true, poolSize: 4 } })).toBe("LOCKED");
    expect(resolveWaiverPlayState({ ...base, contest: { locked: false, poolSize: 0 } })).toBe("NO_PLAYERS");
    expect(resolveWaiverPlayState({ ...base, contest: { locked: true, poolSize: 0 } })).toBe("LOCKED");
  });

  it("uses product copy and never internal enum names", () => {
    expect(WAIVER_PLAY_STATE_COPY).toEqual({
      NO_WEEK: "Waivers aren't open yet.",
      POOL_PREPARING: "This week's waiver pool is being prepared.",
      POOL_READY: "This week's waiver pool is ready. Check back when Waivers opens.",
      NO_PLAYERS: "No eligible waiver players were available for this position in the official snapshot.",
    });
    for (const text of [...Object.values(WAIVER_PLAY_STATE_COPY), ...Object.values(WAIVER_VIEWER_STATUS_LABEL)]) {
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/);
      expect(text).not.toMatch(/WaiverEyeQ|Waiver IQ|Waiver Rank IQ/);
    }
  });
});

describe("viewer board status", () => {
  it("distinguishes draft, submitted, and submitted-with-no-calls before lock", () => {
    expect(resolveWaiverViewerBoardStatus({ locked: false, board: null })).toBe("NONE");
    expect(resolveWaiverViewerBoardStatus({ locked: false, board: { competitive: false, callCount: 2 } })).toBe("DRAFT");
    expect(resolveWaiverViewerBoardStatus({ locked: false, board: { competitive: false, callCount: 0 } })).toBe("NONE");
    expect(resolveWaiverViewerBoardStatus({ locked: false, board: { competitive: true, callCount: 2 } })).toBe("SUBMITTED");
    expect(resolveWaiverViewerBoardStatus({ locked: false, board: { competitive: true, callCount: 0 } })).toBe("ABSTAINED");
  });

  it("after lock: drafts and no board are a missed lock; competitive boards are locked in", () => {
    expect(resolveWaiverViewerBoardStatus({ locked: true, board: null })).toBe("MISSED");
    expect(resolveWaiverViewerBoardStatus({ locked: true, board: { competitive: false, callCount: 3 } })).toBe("MISSED");
    expect(resolveWaiverViewerBoardStatus({ locked: true, board: { competitive: true, callCount: 3 } })).toBe("LOCKED_IN");
    expect(resolveWaiverViewerBoardStatus({ locked: true, board: { competitive: true, callCount: 0 } })).toBe("LOCKED_ABSTAINED");
  });
});

describe("board shapes and slot labels", () => {
  it("uses WIN / PLACE / SHOW, plus #4 / #5 for WR", () => {
    expect(waiverSlotLabels(waiverAvailableSlots("QB", 30))).toEqual(["WIN", "PLACE", "SHOW"]);
    expect(waiverSlotLabels(waiverAvailableSlots("RB", 30))).toEqual(["WIN", "PLACE", "SHOW"]);
    expect(waiverSlotLabels(waiverAvailableSlots("TE", 30))).toEqual(["WIN", "PLACE", "SHOW"]);
    expect(waiverSlotLabels(waiverAvailableSlots("DEF", 30))).toEqual(["WIN", "PLACE", "SHOW"]);
    expect(waiverSlotLabels(waiverAvailableSlots("WR", 30))).toEqual(["WIN", "PLACE", "SHOW", "#4", "#5"]);
  });

  it("caps depth by the eligible pool", () => {
    expect(waiverAvailableSlots("WR", 2)).toBe(2);
    expect(waiverAvailableSlots("QB", 0)).toBe(0);
    expect(waiverSlotLabels(0)).toEqual([]);
  });
});

describe("board editing", () => {
  const opts = { availableSlots: 3, poolIds: pool };

  it("adds contiguously, prevents duplicates, enforces the max and the pool", () => {
    let calls: string[] = [];
    for (const id of ["a", "b", "c"]) {
      const result = addWaiverCall(calls, id, opts);
      expect(result.ok).toBe(true);
      if (result.ok) calls = result.calls;
    }
    expect(calls).toEqual(["a", "b", "c"]);
    expect(addWaiverCall(calls, "d", opts)).toEqual({ ok: false, reason: "FULL" });
    expect(addWaiverCall(["a"], "a", opts)).toEqual({ ok: false, reason: "DUPLICATE" });
    expect(addWaiverCall(["a"], "zzz", opts)).toEqual({ ok: false, reason: "NOT_IN_POOL" });
  });

  it("WR boards hold five calls", () => {
    let calls: string[] = [];
    for (const id of ["a", "b", "c", "d", "e"]) {
      const result = addWaiverCall(calls, id, { availableSlots: 5, poolIds: pool });
      if (result.ok) calls = result.calls;
    }
    expect(calls).toHaveLength(5);
    expect(addWaiverCall(calls, "f", { availableSlots: 5, poolIds: pool })).toEqual({ ok: false, reason: "FULL" });
  });

  it("removal closes the gap so calls stay contiguous", () => {
    expect(removeWaiverCall(["a", "b", "c"], 0)).toEqual({ ok: true, calls: ["b", "c"] });
    expect(removeWaiverCall(["a", "b", "c"], 1)).toEqual({ ok: true, calls: ["a", "c"] });
    expect(removeWaiverCall(["a"], 0)).toEqual({ ok: true, calls: [] });
    expect(removeWaiverCall(["a"], 3)).toEqual({ ok: false, reason: "OUT_OF_RANGE" });
  });

  it("reorders with up/down and refuses moves off the board", () => {
    expect(moveWaiverCall(["a", "b", "c"], 2, -1)).toEqual({ ok: true, calls: ["a", "c", "b"] });
    expect(moveWaiverCall(["a", "b", "c"], 0, 1)).toEqual({ ok: true, calls: ["b", "a", "c"] });
    expect(moveWaiverCall(["a", "b"], 0, -1)).toEqual({ ok: false, reason: "OUT_OF_RANGE" });
    expect(moveWaiverCall(["a", "b"], 1, 1)).toEqual({ ok: false, reason: "OUT_OF_RANGE" });
  });

  it("explains why a pool player cannot be added", () => {
    expect(waiverAddBlockReason({ playerId: "a", calls: ["a"], availableSlots: 3 })).toBe("ON_BOARD");
    expect(waiverAddBlockReason({ playerId: "d", calls: ["a", "b", "c"], availableSlots: 3 })).toBe("FULL");
    expect(waiverAddBlockReason({ playerId: "d", calls: ["a"], availableSlots: 3 })).toBeNull();
  });

  it("compares boards by order", () => {
    expect(sameWaiverCalls(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameWaiverCalls(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameWaiverCalls([], [])).toBe(true);
  });
});

describe("partial-board copy", () => {
  it("counts calls without exposing the coverage formula", () => {
    expect(waiverCallCountLabel(1, 3)).toBe("1 of 3 calls");
    expect(waiverCallCountLabel(0, 5)).toBe("0 of 5 calls");
    expect(waiverCallCountLabel(1, 1)).toBe("1 of 1 call");
    for (const [count, max] of [
      [0, 3],
      [1, 3],
      [3, 3],
    ]) {
      const hint = waiverBoardHint(count, max);
      expect(hint).not.toMatch(/\d+\s*%|×|\bfloor\b|coverage modifier|70|30/i);
    }
    expect(waiverBoardHint(1, 3)).toMatch(/Fewer calls are allowed/);
    expect(waiverBoardHint(0, 3)).toMatch(/no calls/);
  });
});

describe("board summary line", () => {
  const open = {
    signedIn: true,
    locked: false,
    boardStatus: null,
    editable: true,
    revising: false,
    draftSave: "idle",
    callCount: 0,
    availableSlots: 3,
  } as const;
  const locked = { ...open, locked: true, editable: false };

  it("shows a signed-out visitor only 'Locked' on a locked position — no board progress", () => {
    expect(waiverBoardSummary({ ...locked, signedIn: false })).toBe("Locked");
    expect(waiverBoardSummary({ ...locked, signedIn: false, availableSlots: 5, callCount: 2 })).not.toMatch(/calls/);
  });

  it("after lock, a signed-in user without a competitive board sees no submission — draft calls are not progress", () => {
    expect(waiverBoardSummary({ ...locked, boardStatus: "MISSED", callCount: 1 })).toBe("No submission · Locked");
    expect(waiverBoardSummary({ ...locked, boardStatus: "MISSED", callCount: 0 })).toBe("No submission · Locked");
    expect(waiverBoardSummary({ ...locked, boardStatus: null })).toBe("No submission · Locked");
  });

  it("after lock, a competitive board keeps its progress", () => {
    expect(waiverBoardSummary({ ...locked, boardStatus: "LOCKED_IN", callCount: 2 })).toBe("2 of 3 calls · Locked");
    expect(waiverBoardSummary({ ...locked, boardStatus: "LOCKED_ABSTAINED" })).toBe("0 of 3 calls · Locked");
  });

  it("an empty open board reads 'Not submitted'; draft wording starts once calls exist", () => {
    expect(waiverBoardSummary(open)).toBe("0 of 3 calls · Not submitted");
    expect(waiverBoardSummary({ ...open, draftSave: "saved" })).toBe("0 of 3 calls · Not submitted");
    expect(waiverBoardSummary({ ...open, callCount: 1 })).toBe("1 of 3 calls · Draft · not submitted");
    expect(waiverBoardSummary({ ...open, callCount: 1, draftSave: "saving" })).toBe("1 of 3 calls · Saving draft…");
    expect(waiverBoardSummary({ ...open, callCount: 2, draftSave: "saved" })).toBe("2 of 3 calls · Draft saved · not submitted");
    expect(waiverBoardSummary({ ...open, callCount: 2, draftSave: "error" })).toBe("2 of 3 calls · Draft not saved");
  });

  it("submitted boards read 'Submitted' with no revision number; zero-call submissions stay distinct", () => {
    const submitted = waiverBoardSummary({ ...open, editable: false, boardStatus: "SUBMITTED", callCount: 2 });
    expect(submitted).toBe("2 of 3 calls · Submitted");
    expect(submitted).not.toMatch(/revision/i);
    const abstained = waiverBoardSummary({ ...open, editable: false, boardStatus: "ABSTAINED" });
    expect(abstained).toBe("0 of 3 calls · Submitted with no calls");
    expect(abstained).not.toBe(waiverBoardSummary(open));
    expect(waiverBoardSummary({ ...open, boardStatus: "SUBMITTED", revising: true, callCount: 2 })).toBe(
      "2 of 3 calls · Revising — not yet submitted",
    );
  });

  it("signed-out and view-only open boards show only the count", () => {
    expect(waiverBoardSummary({ ...open, signedIn: false, editable: false, availableSlots: 5 })).toBe("0 of 5 calls");
  });
});

describe("submit feedback", () => {
  const base = { position: "QB", changed: true, callCount: 2, revised: false };

  it("never exposes revision numbers", () => {
    expect(waiverSubmitFeedback(base)).toBe("Picks submitted.");
    expect(waiverSubmitFeedback({ ...base, revised: true })).toBe("Picks updated.");
    expect(waiverSubmitFeedback({ ...base, changed: false, revised: true })).toBe("No changes. Your submitted picks are unchanged.");
    expect(waiverSubmitFeedback({ ...base, callCount: 0 })).toMatch(/^Submitted with no calls\. You're sitting out QB/);
    for (const changed of [true, false]) {
      for (const revised of [true, false]) {
        for (const callCount of [0, 2]) {
          const text = waiverSubmitFeedback({ ...base, changed, revised, callCount });
          expect(text).not.toMatch(/revision|\d/i);
        }
      }
    }
  });
});

describe("matchup orientation", () => {
  const game = { homeTeam: "DET", awayTeam: "GB" };

  it("reads home/away from the pinned game only when it matches the frozen team and opponent", () => {
    expect(resolveWaiverMatchupSide({ teamAtFreeze: "DET", opponentAtFreeze: "GB", pinnedGame: game })).toBe("HOME");
    expect(resolveWaiverMatchupSide({ teamAtFreeze: "GB", opponentAtFreeze: "DET", pinnedGame: game })).toBe("AWAY");
  });

  it("falls back to unknown instead of guessing", () => {
    expect(resolveWaiverMatchupSide({ teamAtFreeze: "GB", opponentAtFreeze: "DET", pinnedGame: null })).toBeNull();
    expect(resolveWaiverMatchupSide({ teamAtFreeze: "GB", opponentAtFreeze: "CHI", pinnedGame: game })).toBeNull();
    expect(resolveWaiverMatchupSide({ teamAtFreeze: "MIN", opponentAtFreeze: "DET", pinnedGame: game })).toBeNull();
    expect(resolveWaiverMatchupSide({ teamAtFreeze: null, opponentAtFreeze: "DET", pinnedGame: game })).toBeNull();
    expect(resolveWaiverMatchupSide({ teamAtFreeze: "GB", opponentAtFreeze: null, pinnedGame: game })).toBeNull();
    expect(resolveWaiverMatchupSide({ teamAtFreeze: "DET", opponentAtFreeze: "DET", pinnedGame: { homeTeam: "DET", awayTeam: "DET" } })).toBeNull();
  });

  it("formats '@ DET' away, 'vs DET' home, and a neutral label when unknown", () => {
    expect(formatWaiverMatchup("DET", "AWAY")).toBe("@ DET");
    expect(formatWaiverMatchup("DET", "HOME")).toBe("vs DET");
    expect(formatWaiverMatchup("DET", null)).toBe("Opp DET");
    expect(formatWaiverMatchup(null, "HOME")).toBeNull();
  });
});

describe("frozen ownership display", () => {
  it("formats basis points as rostered %, truncating so nothing rounds up to the threshold", () => {
    expect(formatRosteredPercent(1100)).toBe("11%");
    expect(formatRosteredPercent(1150)).toBe("11.5%");
    expect(formatRosteredPercent(1159)).toBe("11.5%");
    expect(formatRosteredPercent(4999)).toBe("49.9%");
    expect(formatRosteredPercent(5)).toBe("<0.1%");
    expect(formatRosteredPercent(0)).toBe("0%");
  });

  it("labels only meaningful availability designations", () => {
    expect(waiverAvailabilityLabel("QUESTIONABLE")).toBe("Questionable");
    expect(waiverAvailabilityLabel("DOUBTFUL")).toBe("Doubtful");
    expect(waiverAvailabilityLabel("AVAILABLE")).toBeNull();
    expect(waiverAvailabilityLabel("UNKNOWN")).toBeNull();
    expect(waiverAvailabilityLabel(null)).toBeNull();
  });
});
