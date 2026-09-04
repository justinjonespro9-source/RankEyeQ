import { prisma } from "@/lib/db";
import { listActiveBenchmarkSources } from "@/lib/benchmark-sources-sync";
import { listActiveCreatorCompetitors } from "@/lib/creator-identity";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type {
  BenchmarkCaptureType,
  BenchmarkSnapshotStatus,
  ContestPosition,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

export type BenchmarkCellStatus =
  | "Missing"
  | "Thursday Snapshot"
  | "Sunday Snapshot"
  | "Locked"
  | "Graded"
  | "Not Available";

export type BenchmarkCoverageRow = {
  profileId: string;
  username: string;
  displayName: string;
  cells: Record<ContestPosition, BenchmarkCellStatus>;
  lateCells: ContestPosition[];
  capturedCount: number;
  expectedCount: number;
};

export type BenchmarkCoverageSummary = {
  rows: BenchmarkCoverageRow[];
  expectedBoards: number;
  capturedBoards: number;
  fullyLockedBoards: number;
  gradedBoards: number;
  sourcesMissingPositions: Array<{
    username: string;
    displayName: string;
    positions: ContestPosition[];
  }>;
};

function cellFromState(input: {
  snapshotStatus: BenchmarkSnapshotStatus | null;
  captureType: BenchmarkCaptureType | null;
  submissionStatus: SubmissionStatus | null;
}): BenchmarkCellStatus {
  if (input.snapshotStatus === "NOT_AVAILABLE") return "Not Available";
  if (input.submissionStatus === "GRADED" || input.snapshotStatus === "GRADED") {
    return "Graded";
  }
  if (input.submissionStatus === "LOCKED" || input.snapshotStatus === "LOCKED") {
    return "Locked";
  }
  if (input.captureType === "SUNDAY" || input.captureType === "MANUAL_FINAL") {
    return "Sunday Snapshot";
  }
  if (input.captureType === "THURSDAY") return "Thursday Snapshot";
  return "Missing";
}

export function summarizeBenchmarkCoverage(input: {
  sources: Array<{ id: string; username: string; displayName: string }>;
  positions: ContestPosition[];
  cells: Array<{
    universalProfileId: string;
    position: ContestPosition;
    snapshotStatus: BenchmarkSnapshotStatus | null;
    captureType: BenchmarkCaptureType | null;
    submissionStatus: SubmissionStatus | null;
    late: boolean;
  }>;
}): BenchmarkCoverageSummary {
  const byKey = new Map<string, (typeof input.cells)[number]>();
  for (const cell of input.cells) {
    byKey.set(`${cell.universalProfileId}:${cell.position}`, cell);
  }

  const rows: BenchmarkCoverageRow[] = input.sources.map((source) => {
    const cells = {} as Record<ContestPosition, BenchmarkCellStatus>;
    const lateCells: ContestPosition[] = [];
    let capturedCount = 0;
    let expectedCount = 0;
    for (const position of input.positions) {
      const raw = byKey.get(`${source.id}:${position}`);
      const status = cellFromState({
        snapshotStatus: raw?.snapshotStatus ?? null,
        captureType: raw?.captureType ?? null,
        submissionStatus: raw?.submissionStatus ?? null,
      });
      cells[position] = status;
      if (raw?.late && status !== "Not Available" && status !== "Missing") {
        lateCells.push(position);
      }
      if (status !== "Not Available") expectedCount += 1;
      if (
        status === "Thursday Snapshot" ||
        status === "Sunday Snapshot" ||
        status === "Locked" ||
        status === "Graded"
      ) {
        capturedCount += 1;
      }
    }
    return {
      profileId: source.id,
      username: source.username,
      displayName: source.displayName,
      cells,
      lateCells,
      capturedCount,
      expectedCount,
    };
  });

  let expectedBoards = 0;
  let capturedBoards = 0;
  let fullyLockedBoards = 0;
  let gradedBoards = 0;
  for (const row of rows) {
    for (const position of input.positions) {
      const status = row.cells[position];
      if (status !== "Not Available") expectedBoards += 1;
      if (
        status === "Thursday Snapshot" ||
        status === "Sunday Snapshot" ||
        status === "Locked" ||
        status === "Graded"
      ) {
        capturedBoards += 1;
      }
      if (status === "Locked" || status === "Graded") fullyLockedBoards += 1;
      if (status === "Graded") gradedBoards += 1;
    }
  }

  const sourcesMissingPositions = rows
    .map((row) => ({
      username: row.username,
      displayName: row.displayName,
      positions: input.positions.filter(
        (position) => row.cells[position] === "Missing",
      ),
    }))
    .filter((row) => row.positions.length > 0);

  return {
    rows,
    expectedBoards,
    capturedBoards,
    fullyLockedBoards,
    gradedBoards,
    sourcesMissingPositions,
  };
}

export async function getBenchmarkCoverage(
  weekId: string,
): Promise<BenchmarkCoverageSummary> {
  const [experts, creators, contests, snapshots] = await Promise.all([
    listActiveBenchmarkSources(),
    listActiveCreatorCompetitors(),
    prisma.rankIQContest.findMany({
      where: { weekId },
      include: {
        submissions: { include: { universalProfile: true } },
      },
    }),
    prisma.benchmarkSnapshot.findMany({
      where: { weekId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const sources = [
    ...experts.map((source) => ({
      id: source.id,
      username: source.username,
      displayName:
        source.expertSource?.analystName?.trim() || source.displayName,
      profileType: "BENCHMARK" as const,
    })),
    ...creators.map((source) => ({
      id: source.id,
      username: source.username,
      displayName:
        source.creatorCompetitor?.personName?.trim() || source.displayName,
      profileType: "CREATOR" as const,
    })),
  ];

  const positions = CONTEST_POSITIONS.filter((position) =>
    contests.some((contest) => contest.position === position),
  );
  const usePositions = positions.length > 0 ? positions : CONTEST_POSITIONS;

  const latestByContestProfile = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.contestId}:${snapshot.universalProfileId}`;
    if (!latestByContestProfile.has(key)) {
      latestByContestProfile.set(key, snapshot);
    }
  }

  const cells: Parameters<typeof summarizeBenchmarkCoverage>[0]["cells"] = [];
  for (const contest of contests) {
    for (const source of sources) {
      const snapshot = latestByContestProfile.get(
        `${contest.id}:${source.id}`,
      );
      const submission =
        contest.submissions.find(
          (row) =>
            row.universalProfileId === source.id &&
            (row.universalProfile.profileType === "BENCHMARK" ||
              row.universalProfile.profileType === "CREATOR"),
        ) ?? null;
      cells.push({
        universalProfileId: source.id,
        position: contest.position,
        snapshotStatus: snapshot?.status ?? null,
        captureType: snapshot?.captureType ?? null,
        submissionStatus: submission?.status ?? null,
        late: snapshot?.late ?? false,
      });
    }
  }

  return summarizeBenchmarkCoverage({
    sources: sources.map((source) => ({
      id: source.id,
      username: source.username,
      displayName: source.displayName,
    })),
    positions: usePositions,
    cells,
  });
}
