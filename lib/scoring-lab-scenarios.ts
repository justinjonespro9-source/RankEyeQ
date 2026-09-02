import { scoreContest, type ScoreablePick } from "@/lib/scoring";
import type { ContestScoreSummary } from "@/types/scoring";

/** Fixed actual finishing order for the scoring lab (Top-10 + outsiders). */
export const LAB_FIELD_SIZE = 10;

export const LAB_ACTUAL_ORDER = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
] as const;

export type LabPlayerId = (typeof LAB_ACTUAL_ORDER)[number];

const ACTUAL_RANK = new Map<LabPlayerId, number>(
  LAB_ACTUAL_ORDER.map((id, index) => [id, index + 1]),
);

export function getLabActualRank(playerId: string): number {
  return ACTUAL_RANK.get(playerId as LabPlayerId) ?? 99;
}

export type LabScenario = {
  id: string;
  letter: string;
  name: string;
  description: string;
  /** Predicted order, length 10. */
  predicted: LabPlayerId[];
};

export const LAB_SCENARIOS: LabScenario[] = [
  {
    id: "perfect",
    letter: "A",
    name: "Perfect board",
    description: "Exact 1–10 order. Maximum 210 raw / 100 EYEQ.",
    predicted: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
  },
  {
    id: "shuffled-podium",
    letter: "B",
    name: "Perfect podium, shuffled Top 3",
    description:
      "Podium pool calls all three actual podium finishers despite internal reorder.",
    predicted: ["B", "A", "C", "D", "E", "F", "G", "H", "I", "J"],
  },
  {
    id: "field-strong-podium",
    letter: "C",
    name: "8/10 field hits, strong podium",
    description: "Misses two outsiders but nails the actual podium pool.",
    predicted: ["A", "B", "C", "D", "E", "F", "G", "H", "K", "L"],
  },
  {
    id: "field-strong-weak-order",
    letter: "D",
    name: "8/10 field hits, poor ordering",
    description: "Finds eight Top-10 players but scrambles precision slots.",
    predicted: ["J", "I", "H", "A", "B", "C", "D", "E", "K", "L"],
  },
  {
    id: "precision-strong",
    letter: "E",
    name: "Strong precision, weak podium",
    description: "Exact on many field picks; podium pool misses two of three.",
    predicted: ["D", "E", "F", "A", "B", "C", "G", "H", "I", "J"],
  },
  {
    id: "contrarian-podium",
    letter: "F",
    name: "Contrarian breakout on podium",
    description: "Calls actual #1 from slot 3; strong field identification.",
    predicted: ["B", "C", "A", "D", "E", "F", "G", "H", "I", "K"],
  },
  {
    id: "favorites-missed-podium",
    letter: "G",
    name: "Obvious favorites included, podium missed",
    description: "Has actual Top 3 in field but not in Podium slots 1–3.",
    predicted: ["D", "E", "F", "A", "B", "C", "G", "H", "I", "J"],
  },
  {
    id: "poor",
    letter: "H",
    name: "Poor board",
    description: "Only four actual Top-10 players identified.",
    predicted: ["J", "I", "H", "G", "K", "L", "M", "N", "O", "P"],
  },
];

export function predictedToPicks(predicted: string[]): ScoreablePick[] {
  return predicted.map((playerId, index) => ({
    playerId,
    playerName: `Player ${playerId}`,
    predictedRank: index + 1,
    actualRank: getLabActualRank(playerId),
  }));
}

export type LabScenarioResult = LabScenario & {
  summary: ContestScoreSummary;
};

export function evaluateLabScenarios(): LabScenarioResult[] {
  return LAB_SCENARIOS.map((scenario) => ({
    ...scenario,
    summary: scoreContest(predictedToPicks(scenario.predicted), LAB_FIELD_SIZE),
  })).sort((a, b) => b.summary.rankIqScore - a.summary.rankIqScore);
}

export function scoreLabSubmission(predicted: string[]): ContestScoreSummary {
  return scoreContest(predictedToPicks(predicted), LAB_FIELD_SIZE);
}
