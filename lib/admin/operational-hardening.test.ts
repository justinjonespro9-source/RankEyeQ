import { describe, expect, it } from "vitest";
import {
  getWeekTimingWarnings,
  buildWeekTimingDisplay,
} from "@/lib/admin/week-timing-validation";
import { formatLeagueDepthMessage } from "@/lib/nfl/league-result-depth";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import { rankableEntryToRankingPlayer } from "@/lib/rankable-mappers";
import type { RankableEntry } from "@/lib/generated/prisma/client";

describe("week timing validation", () => {
  it("warns when contests are OPEN before rankingsOpenAt", () => {
    const warnings = getWeekTimingWarnings({
      rankingsOpenAt: new Date("2099-01-10T12:00:00Z"),
      fullLockAt: new Date("2099-01-12T15:00:00Z"),
      revealStartsAt: new Date("2099-01-12T15:00:00Z"),
      publicReleaseAt: new Date("2099-01-12T18:00:00Z"),
      contestStatuses: ["OPEN"],
      now: new Date("2099-01-09T12:00:00Z"),
    });
    expect(warnings.some((w) => w.code === "open_before_rankings_open")).toBe(
      true,
    );
  });

  it("flags rankings open after lock", () => {
    const display = buildWeekTimingDisplay({
      rankingsOpenAt: new Date("2099-01-12T16:00:00Z"),
      fullLockAt: new Date("2099-01-12T15:00:00Z"),
      revealStartsAt: new Date("2099-01-12T15:00:00Z"),
      publicReleaseAt: new Date("2099-01-12T18:00:00Z"),
    });
    expect(
      display.warnings.some((w) => w.code === "rankings_open_after_lock"),
    ).toBe(true);
  });
});

describe("league result depth messages", () => {
  it("formats DEF depth operator message", () => {
    expect(formatLeagueDepthMessage("DEF", 10, 8)).toBe(
      "DEF requires at least 10 valid weekly defensive results; 8 were found.",
    );
  });

  it("formats offensive position depth message", () => {
    expect(formatLeagueDepthMessage("RB", 10, 6)).toContain(
      "RB requires at least 10 valid weekly player results; 6 were found.",
    );
  });
});

describe("admin test preview", () => {
  it("excludes test weeks for non-admins", () => {
    expect(
      resolveIncludeTestWeeks({
        isAdmin: false,
        adminTestPreview: true,
      }),
    ).toBe(false);
  });

  it("includes test weeks for admins with adminTest=1", () => {
    expect(
      resolveIncludeTestWeeks({
        isAdmin: true,
        adminTestPreview: isAdminTestPreviewRequested({ adminTest: "1" }),
      }),
    ).toBe(true);
  });
});

describe("seedRank public contract", () => {
  it("does not expose seedRank on ranking players", () => {
    const player = rankableEntryToRankingPlayer({
      id: "p1",
      provider: "test",
      externalId: "ext",
      type: "PLAYER",
      name: "Test Player",
      shortName: "Test",
      team: "MIN",
      opponent: "@ DET",
      position: "RB",
      active: true,
      gameStartsAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      gameId: null,
      headshotUrl: null,
      availability: "ACTIVE",
    } as RankableEntry);
    expect(player).not.toHaveProperty("seedRank");
    expect(JSON.stringify(player)).not.toContain("seedRank");
  });
});
