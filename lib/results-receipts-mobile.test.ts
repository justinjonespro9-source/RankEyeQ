import { describe, expect, it } from "vitest";
import { classifyReceiptOutcome } from "@/lib/profile-receipt";
import { scorePlayerPick } from "@/lib/scoring";

/**
 * Mobile Results / Receipts pick cards must surface a single primary outcome
 * chip (Exact → Podium Call → Top field hit → Miss) without inventing labels.
 */
describe("results/receipts mobile outcome chips", () => {
  it("maps graded pick outcomes to the public chip labels", () => {
    const exact = classifyReceiptOutcome(
      scorePlayerPick(
        {
          playerId: "1",
          playerName: "A",
          predictedRank: 5,
          actualRank: 5,
        },
        10,
      ),
      10,
    );
    expect(exact.label).toBe("EXACT");

    const podium = classifyReceiptOutcome(
      scorePlayerPick(
        {
          playerId: "2",
          playerName: "B",
          predictedRank: 1,
          actualRank: 2,
        },
        10,
      ),
      10,
    );
    expect(podium.label).toBe("PODIUM CALL");

    const top10 = classifyReceiptOutcome(
      scorePlayerPick(
        {
          playerId: "3",
          playerName: "C",
          predictedRank: 8,
          actualRank: 6,
        },
        10,
      ),
      10,
    );
    expect(top10.label).toBe("Top 10 Hit");

    const miss = classifyReceiptOutcome(
      scorePlayerPick(
        {
          playerId: "4",
          playerName: "D",
          predictedRank: 4,
          actualRank: 22,
        },
        10,
      ),
      10,
    );
    expect(miss.label).toBe("Miss");
  });
});
