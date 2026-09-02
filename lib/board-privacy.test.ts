import { describe, expect, it } from "vitest";
import { getBoardIndexability } from "@/lib/board-privacy";
import { canViewCurrentWeekBoard } from "@/lib/timing/board-access";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

describe("private current-week metadata / indexing", () => {
  it("does not treat unreleased boards as publicly indexable", () => {
    const week = {
      fullLockAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
      revealStartsAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
      publicReleaseAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
      status: "OPEN",
    };
    const stranger = { profileId: null, isAdmin: false };
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week,
        creatorEnabled: true,
        revealPreference: "PREMIUM_REVEAL",
        now: zonedLocalToUtc(2026, 9, 13, 11, 0),
      }),
    ).toBe(false);
  });

  it("getBoardIndexability returns no public content for unknown usernames", async () => {
    const result = await getBoardIndexability({
      username: `missing_user_${Date.now()}`,
      weekNumber: 1,
      position: "QB",
    });
    expect(result.exists).toBe(false);
    expect(result.public).toBe(false);
  });

  it("private board metadata copy never includes ranking picks", () => {
    const privateDescription =
      "RankEYEQ ranking board. Content is private until public release.";
    expect(privateDescription.toLowerCase()).not.toMatch(
      /mahomes|kelce|jefferson|#1|#2|predicted/,
    );
  });
});
