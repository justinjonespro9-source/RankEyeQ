import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  committedPicksForKickoff,
  summarizeReceiptCommitments,
} from "@/lib/timing/thursday-receipts";

const kickoff = zonedLocalToUtc(2026, 9, 10, 19, 15);

describe("Thursday receipt commitments", () => {
  it("uses only pre-kickoff commitments", () => {
    const committed = committedPicksForKickoff({
      rankableEntryId: "swift",
      kickoff,
      eligibleBoards: [
        {
          username: "jonesy",
          displayName: "Jonesy",
          picks: [
            {
              rankableEntryId: "swift",
              predictedRank: 1,
              lockedRank: 1,
              slotLocked: true,
              committedAt: zonedLocalToUtc(2026, 9, 10, 18, 0),
              lockedAt: kickoff,
            },
          ],
        },
        {
          username: "late",
          displayName: "Late",
          picks: [
            {
              rankableEntryId: "swift",
              predictedRank: 1,
              lockedRank: 1,
              slotLocked: true,
              committedAt: zonedLocalToUtc(2026, 9, 10, 19, 30),
              lockedAt: zonedLocalToUtc(2026, 9, 10, 19, 30),
            },
          ],
        },
        {
          username: "other",
          displayName: "Other",
          picks: [
            {
              rankableEntryId: "bijan",
              predictedRank: 1,
              lockedRank: 1,
              slotLocked: true,
              committedAt: zonedLocalToUtc(2026, 9, 10, 18, 0),
              lockedAt: kickoff,
            },
          ],
        },
      ],
    });

    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({
      username: "jonesy",
      rank: 1,
    });

    const summary = summarizeReceiptCommitments(committed, 2);
    expect(summary.boardsIncluding).toBe(1);
    expect(summary.percentRankedOne).toBe(0.5);
    expect(summary.numberOneCallers[0]?.username).toBe("jonesy");
  });
});
