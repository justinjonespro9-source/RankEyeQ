import { describe, expect, it } from "vitest";
import { summarizeBotCoverage } from "@/lib/admin/bot-coverage";

describe("bot coverage", () => {
  it("counts submitted/locked/graded boards and missing positions", () => {
    const summary = summarizeBotCoverage({
      bots: [
        { id: "gpt", username: "gpt", displayName: "GPT" },
        { id: "claude", username: "claude", displayName: "Claude" },
      ],
      positions: ["QB", "RB", "WR", "TE", "DEF"],
      submissions: [
        { universalProfileId: "gpt", position: "QB", status: "SUBMITTED" },
        { universalProfileId: "gpt", position: "RB", status: "SUBMITTED" },
        { universalProfileId: "gpt", position: "WR", status: "LOCKED" },
        { universalProfileId: "gpt", position: "TE", status: "GRADED" },
        { universalProfileId: "gpt", position: "DEF", status: "SUBMITTED" },
        { universalProfileId: "claude", position: "QB", status: "SUBMITTED" },
        { universalProfileId: "claude", position: "RB", status: "DRAFT" },
        { universalProfileId: "claude", position: "WR", status: "SUBMITTED" },
        { universalProfileId: "claude", position: "TE", status: "SUBMITTED" },
      ],
    });

    expect(summary.expectedBoards).toBe(10);
    expect(summary.submittedBoards).toBe(8);
    expect(summary.lockedBoards).toBe(2);
    expect(summary.gradedBoards).toBe(1);
    expect(summary.allBotsComplete).toBe(false);
    expect(summary.rows.find((row) => row.username === "gpt")?.submittedCount).toBe(5);
    expect(summary.rows.find((row) => row.username === "claude")?.submittedCount).toBe(3);
    expect(
      summary.missing.find((row) => row.username === "Claude")?.positions,
    ).toEqual(["DEF"]);
  });
});
