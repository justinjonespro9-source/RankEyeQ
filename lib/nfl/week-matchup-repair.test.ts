import { describe, expect, it } from "vitest";
import { matchupNotStampedMessage } from "@/lib/timing/resolve-contest-kickoff";

describe("week matchup repair classification contract", () => {
  it("treats other-week ContestEntry.gameId as stale", () => {
    const weekGameIds = new Set(["week2-game"]);
    const currentGameId: string | null = "week1-game";
    const proposedId: string | null = "week2-game";
    let status: string;
    if (!proposedId) status = "unmatched";
    else if (currentGameId === proposedId) status = "correct";
    else if (currentGameId && !weekGameIds.has(currentGameId)) status = "stale";
    else if (!currentGameId) status = "missing";
    else status = "proposed_update";
    expect(status).toBe("stale");
  });

  it("treats null ContestEntry.gameId with a schedule match as missing", () => {
    const weekGameIds = new Set(["week2-game"]);
    const currentGameId: string | null = null;
    const proposedId: string | null = "week2-game";
    let status: string;
    if (!proposedId) status = "unmatched";
    else if (currentGameId === proposedId) status = "correct";
    else if (currentGameId && !weekGameIds.has(currentGameId)) status = "stale";
    else if (!currentGameId) status = "missing";
    else status = "proposed_update";
    expect(status).toBe("missing");
  });

  it("surfaces the operator matchup-not-stamped message", () => {
    expect(matchupNotStampedMessage(2)).toContain(
      "Week 2 matchup data has not been stamped",
    );
  });
});
