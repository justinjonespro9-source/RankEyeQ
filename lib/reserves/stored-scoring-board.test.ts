import { describe, expect, it } from "vitest";
import {
  buildOriginalBoardAudit,
  pickWasScoredInStoredGrade,
  reconstructStoredScoringBoard,
} from "@/lib/reserves/stored-scoring-board";

describe("stored scoring board reconstruction", () => {
  it("treats totalPoints 0 as scored and null as excluded", () => {
    expect(pickWasScoredInStoredGrade({ totalPoints: 0 })).toBe(true);
    expect(pickWasScoredInStoredGrade({ totalPoints: null })).toBe(false);
  });

  it("returns null when nothing was graded yet", () => {
    expect(
      reconstructStoredScoringBoard({
        picks: [
          {
            rankableEntryId: "a",
            predictedRank: 1,
            totalPoints: null,
          },
        ],
        scoringDepth: 15,
      }),
    ).toBeNull();
  });

  it("compacts scored actives then reserves by original predictedRank", () => {
    const board = reconstructStoredScoringBoard({
      picks: [
        {
          rankableEntryId: "puka",
          predictedRank: 1,
          totalPoints: null,
          name: "Puka",
        },
        {
          rankableEntryId: "arsb",
          predictedRank: 2,
          totalPoints: 10,
          name: "ARSB",
        },
        {
          rankableEntryId: "rice",
          predictedRank: 17,
          totalPoints: 0,
          name: "Rice",
        },
      ],
      scoringDepth: 15,
    });
    expect(board?.map((r) => r.rankableEntryId)).toEqual(["arsb", "rice"]);
    expect(board?.[1]?.fromReserve).toBe(true);
    expect(board?.[1]?.scoringRank).toBe(2);
  });

  it("labels unavailable originals without mutating ranks", () => {
    const audit = buildOriginalBoardAudit({
      picks: [
        {
          rankableEntryId: "puka",
          predictedRank: 1,
          totalPoints: null,
          wasUnavailableAtKickoff: true,
          name: "Puka",
          team: "LAR",
        },
        {
          rankableEntryId: "arsb",
          predictedRank: 2,
          totalPoints: 5,
          wasUnavailableAtKickoff: false,
          name: "ARSB",
          team: "DET",
        },
      ],
      scoringDepth: 15,
    });
    expect(audit[0]?.predictedRank).toBe(1);
    expect(audit[0]?.note).toMatch(/removed/i);
    expect(audit[1]?.note).toBeNull();
  });
});
