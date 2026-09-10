import { describe, expect, it } from "vitest";
import {
  authorizePublicUpdate,
} from "@/lib/competitor-visibility";

describe("authorizeCompetitorPublic history modes", () => {
  it("defaults to conservative from_now gate", () => {
    const update = authorizePublicUpdate({
      historyMode: "from_now",
      currentWeekId: "week-current",
    });
    expect(update.publicVisible).toBe(true);
    expect(update.competitorActive).toBe(true);
    expect(update.publicFromWeekId).toBe("week-current");
  });

  it("expose_history clears the week gate while keeping rows", () => {
    const update = authorizePublicUpdate({
      historyMode: "expose_history",
      currentWeekId: "week-current",
    });
    expect(update.publicFromWeekId).toBeNull();
    expect(update.publicVisible).toBe(true);
  });
});
