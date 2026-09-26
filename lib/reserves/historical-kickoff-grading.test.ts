import { describe, expect, it } from "vitest";
import { buildContestWeekKickoffMap } from "@/lib/reserves/contest-week-kickoffs";
import {
  deriveEffectiveBoardFromPicks,
  scoreableEffectivePicks,
} from "@/lib/reserves/from-submission";
import {
  buildOriginalBoardAudit,
  reconstructStoredScoringBoard,
} from "@/lib/reserves/stored-scoring-board";
import { scoreContest } from "@/lib/scoring";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const week2Id = "week-2";
const week3Id = "week-3";
const week2MondayKickoff = zonedLocalToUtc(2026, 9, 21, 19, 15); // Mon night CT-ish
const week3Kickoff = zonedLocalToUtc(2026, 9, 27, 19, 20);

const PUKA = "puka";
const ARSB = "arsb";
const CHASE = "chase";
const FLOWERS = "flowers";
const RICE = "rice";

function fifteenPlusReserves(overrides?: {
  pukaFreeze?: boolean | null;
  flowersFreeze?: boolean | null;
}) {
  const actives = [
    { id: PUKA, name: "Puka Nacua" },
    { id: ARSB, name: "Amon-Ra St. Brown" },
    { id: CHASE, name: "Ja'Marr Chase" },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `wr${i + 4}`,
      name: `WR ${i + 4}`,
    })),
  ];
  const picks = [
    ...actives.map((player, index) => ({
      rankableEntryId: player.id,
      predictedRank: index + 1,
      wasUnavailableAtKickoff:
        player.id === PUKA ? (overrides?.pukaFreeze ?? true) : false,
      rankableEntry: {
        name: player.name,
        availability: "ACTIVE",
        // Poison: RankableEntry already restamped to Week 3.
        gameStartsAt: week3Kickoff,
        game: { startsAt: week3Kickoff },
      },
    })),
    {
      rankableEntryId: FLOWERS,
      predictedRank: 16,
      wasUnavailableAtKickoff: overrides?.flowersFreeze ?? true,
      reserveEligiblePredecessorIds: [PUKA],
      rankableEntry: {
        name: "Zay Flowers",
        availability: "OUT",
        gameStartsAt: week3Kickoff,
        game: { startsAt: week3Kickoff },
      },
    },
    {
      rankableEntryId: RICE,
      predictedRank: 17,
      wasUnavailableAtKickoff: false,
      reserveEligiblePredecessorIds: [PUKA],
      rankableEntry: {
        name: "Rashee Rice",
        availability: "ACTIVE",
        gameStartsAt: week3Kickoff,
        game: { startsAt: week3Kickoff },
      },
    },
  ];
  return picks;
}

describe("contest-week historical kickoff grading", () => {
  it("1. uses ContestEntry.game kickoff, not RankableEntry.gameStartsAt", () => {
    const map = buildContestWeekKickoffMap({
      weekId: week2Id,
      entries: [
        {
          rankableEntryId: PUKA,
          game: {
            id: "g1",
            weekId: week2Id,
            homeTeam: "NYG",
            awayTeam: "LAR",
            startsAt: week2MondayKickoff,
          },
        },
      ],
    });
    expect(map.get(PUKA)?.toISOString()).toBe(week2MondayKickoff.toISOString());
  });

  it("10. missing / wrong-week ContestEntry.game yields null (never another week)", () => {
    const map = buildContestWeekKickoffMap({
      weekId: week2Id,
      entries: [
        { rankableEntryId: "a", game: null },
        {
          rankableEntryId: "b",
          game: {
            id: "g3",
            weekId: week3Id,
            homeTeam: "SEA",
            awayTeam: "LAR",
            startsAt: week3Kickoff,
          },
        },
      ],
    });
    expect(map.get("a")).toBeNull();
    expect(map.get("b")).toBeNull();
  });

  it("2+3. RankableEntry Week+1 restamp cannot reinsert Puka on regrade", () => {
    const picks = fifteenPlusReserves({ pukaFreeze: true, flowersFreeze: true });
    const kickoffByEntryId = buildContestWeekKickoffMap({
      weekId: week2Id,
      entries: picks.map((pick) => ({
        rankableEntryId: pick.rankableEntryId,
        game: {
          id: `g-${pick.rankableEntryId}`,
          weekId: week2Id,
          homeTeam: "HOM",
          awayTeam: "AWY",
          startsAt: week2MondayKickoff,
        },
      })),
    });

    const nowAfterWeek2 = zonedLocalToUtc(2026, 9, 24, 12, 0);
    const initial = scoreableEffectivePicks({
      picks,
      scoringDepth: 15,
      kickoffByEntryId,
      now: nowAfterWeek2,
    });
    expect(initial.map((p) => p.playerId)).not.toContain(PUKA);
    expect(initial.map((p) => p.playerId).at(-1)).toBe(RICE);

    // Without week-scoped map, RankableEntry Week 3 future kickoff would keep Puka.
    const poisoned = scoreableEffectivePicks({
      picks,
      scoringDepth: 15,
      now: nowAfterWeek2,
    });
    expect(poisoned.map((p) => p.playerId)).toContain(PUKA);

    // Re-grade with same week-scoped map after restamp → identical board.
    const regrade = scoreableEffectivePicks({
      picks,
      scoringDepth: 15,
      kickoffByEntryId,
      now: zonedLocalToUtc(2026, 9, 26, 12, 0),
    });
    expect(regrade.map((p) => p.playerId)).toEqual(
      initial.map((p) => p.playerId),
    );

    const actualById = new Map(
      initial.map((pick, index) => [pick.playerId, index + 1]),
    );
    const scoreOnce = (board: typeof initial) =>
      scoreContest(
        board.map((pick) => ({
          playerId: pick.playerId,
          playerName: pick.playerId,
          predictedRank: pick.predictedRank,
          actualRank: actualById.get(pick.playerId) ?? 100,
        })),
        15,
      ).rankIqScore;

    expect(scoreOnce(regrade)).toBe(scoreOnce(initial));
  });

  it("4. reserve promotion uses week-scoped kickoff", () => {
    const picks = fifteenPlusReserves({ pukaFreeze: true, flowersFreeze: true });
    const kickoffByEntryId = new Map(
      picks.map((p) => [p.rankableEntryId, week2MondayKickoff as Date | null]),
    );
    const board = deriveEffectiveBoardFromPicks({
      picks,
      scoringDepth: 15,
      kickoffByEntryId,
      now: zonedLocalToUtc(2026, 9, 24, 12, 0),
    });
    expect(board.displaced.map((d) => d.rankableEntryId)).toEqual([PUKA]);
    expect(board.activations).toHaveLength(1);
    expect(board.activations[0]?.reserveEntryId).toBe(RICE);
    expect(board.effective.at(-1)?.rankableEntryId).toBe(RICE);
  });

  it("7+8+9. stored scoring board reconstructs historical EyeQ representation", () => {
    // Simulate gradeContest persistence: scored picks have totalPoints set.
    const storedPicks = [
      {
        rankableEntryId: PUKA,
        predictedRank: 1,
        totalPoints: null as number | null,
        wasUnavailableAtKickoff: true,
        name: "Puka Nacua",
        team: "LAR",
      },
      {
        rankableEntryId: ARSB,
        predictedRank: 2,
        totalPoints: 10,
        wasUnavailableAtKickoff: false,
        name: "Amon-Ra St. Brown",
        team: "DET",
        actualRank: 4,
      },
      {
        rankableEntryId: CHASE,
        predictedRank: 3,
        totalPoints: 10,
        wasUnavailableAtKickoff: false,
        name: "Ja'Marr Chase",
        team: "CIN",
        actualRank: 7,
      },
      ...Array.from({ length: 12 }, (_, i) => ({
        rankableEntryId: `wr${i + 4}`,
        predictedRank: i + 4,
        totalPoints: 0,
        wasUnavailableAtKickoff: false,
        name: `WR ${i + 4}`,
        team: "XX",
        actualRank: 20 + i,
      })),
      {
        rankableEntryId: FLOWERS,
        predictedRank: 16,
        totalPoints: null as number | null,
        wasUnavailableAtKickoff: true,
        name: "Zay Flowers",
        team: "BAL",
      },
      {
        rankableEntryId: RICE,
        predictedRank: 17,
        totalPoints: 0,
        wasUnavailableAtKickoff: false,
        name: "Rashee Rice",
        team: "KC",
        actualRank: 24,
      },
    ];

    const scoring = reconstructStoredScoringBoard({
      picks: storedPicks,
      scoringDepth: 15,
    });
    expect(scoring).not.toBeNull();
    expect(scoring!.map((r) => r.rankableEntryId)).not.toContain(PUKA);
    expect(scoring!.at(-1)?.rankableEntryId).toBe(RICE);
    expect(scoring!.at(-1)?.fromReserve).toBe(true);
    expect(scoring![0]?.name).toBe("Amon-Ra St. Brown");

    const audit = buildOriginalBoardAudit({
      picks: storedPicks,
      scoringDepth: 15,
    });
    const pukaAudit = audit.find((r) => r.rankableEntryId === PUKA);
    expect(pukaAudit?.scored).toBe(false);
    expect(pukaAudit?.note).toMatch(/Unavailable at kickoff/i);
    expect(audit.find((r) => r.rankableEntryId === RICE)?.note).toMatch(
      /Promoted/,
    );
  });
});
