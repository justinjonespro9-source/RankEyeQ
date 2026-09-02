import { prisma } from "@/lib/db";
import { listActiveAiCompetitors } from "@/lib/ai-competitors-sync";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type {
  ContestPosition,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

export type BotCellStatus =
  | "Missing"
  | "Draft"
  | "Submitted"
  | "Locked"
  | "Graded";

export type BotCoverageRow = {
  profileId: string;
  username: string;
  displayName: string;
  cells: Record<ContestPosition, BotCellStatus>;
  submittedCount: number;
  expectedCount: number;
};

export type BotCoverageSummary = {
  rows: BotCoverageRow[];
  expectedBoards: number;
  submittedBoards: number;
  lockedBoards: number;
  gradedBoards: number;
  allBotsComplete: boolean;
  missing: Array<{ username: string; positions: ContestPosition[] }>;
};

export function cellStatusFromSubmission(
  status: SubmissionStatus | null | undefined,
): BotCellStatus {
  if (!status) return "Missing";
  if (status === "GRADED") return "Graded";
  if (status === "LOCKED") return "Locked";
  if (status === "SUBMITTED") return "Submitted";
  return "Draft";
}

export function summarizeBotCoverage(input: {
  bots: Array<{ id: string; username: string; displayName: string }>;
  positions: ContestPosition[];
  submissions: Array<{
    universalProfileId: string;
    position: ContestPosition;
    status: SubmissionStatus;
  }>;
}): BotCoverageSummary {
  const positions = input.positions;
  const byBotPosition = new Map<string, SubmissionStatus>();
  for (const submission of input.submissions) {
    byBotPosition.set(
      `${submission.universalProfileId}:${submission.position}`,
      submission.status,
    );
  }

  const rows: BotCoverageRow[] = input.bots.map((bot) => {
    const cells = {} as Record<ContestPosition, BotCellStatus>;
    let submittedCount = 0;
    for (const position of positions) {
      const status = cellStatusFromSubmission(
        byBotPosition.get(`${bot.id}:${position}`),
      );
      cells[position] = status;
      if (status === "Submitted" || status === "Locked" || status === "Graded") {
        submittedCount += 1;
      }
    }
    return {
      profileId: bot.id,
      username: bot.username,
      displayName: bot.displayName,
      cells,
      submittedCount,
      expectedCount: positions.length,
    };
  });

  let submittedBoards = 0;
  let lockedBoards = 0;
  let gradedBoards = 0;
  for (const row of rows) {
    for (const position of positions) {
      const status = row.cells[position];
      if (status === "Submitted" || status === "Locked" || status === "Graded") {
        submittedBoards += 1;
      }
      if (status === "Locked" || status === "Graded") lockedBoards += 1;
      if (status === "Graded") gradedBoards += 1;
    }
  }

  const expectedBoards = input.bots.length * positions.length;
  const missing = rows
    .map((row) => ({
      username: row.displayName,
      positions: positions.filter((position) => row.cells[position] === "Missing"),
    }))
    .filter((row) => row.positions.length > 0);

  return {
    rows,
    expectedBoards,
    submittedBoards,
    lockedBoards,
    gradedBoards,
    allBotsComplete:
      input.bots.length > 0 &&
      submittedBoards === expectedBoards &&
      expectedBoards > 0,
    missing,
  };
}

export async function getBotCoverage(weekId: string): Promise<BotCoverageSummary> {
  const [bots, contests] = await Promise.all([
    listActiveAiCompetitors(),
    prisma.rankIQContest.findMany({
      where: { weekId },
      include: {
        submissions: {
          include: { universalProfile: true },
        },
      },
    }),
  ]);

  const positions = CONTEST_POSITIONS.filter((position) =>
    contests.some((contest) => contest.position === position),
  );
  const usePositions = positions.length > 0 ? positions : CONTEST_POSITIONS;

  const submissions = contests.flatMap((contest) =>
    contest.submissions
      .filter((submission) => submission.universalProfile.profileType === "AI")
      .map((submission) => ({
        universalProfileId: submission.universalProfileId,
        position: contest.position,
        status: submission.status,
      })),
  );

  return summarizeBotCoverage({
    bots: bots.map((bot) => ({
      id: bot.id,
      username: bot.username,
      displayName: bot.displayName,
    })),
    positions: usePositions,
    submissions,
  });
}
