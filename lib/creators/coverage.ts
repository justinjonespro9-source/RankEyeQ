import {
  getBenchmarkCoverage,
  type BenchmarkCellStatus,
  type BenchmarkCoverageRow,
  type BenchmarkCoverageSummary,
} from "@/lib/benchmarks/coverage";
import { listActiveCreatorCompetitors } from "@/lib/creator-identity";
import { formatCreatorAffiliationBadge } from "@/lib/creator-identity";
import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type CreatorImportCellStatus =
  | "Not imported"
  | "Draft"
  | "Submitted"
  | "Error";

export type CreatorCoverageRow = {
  profileId: string;
  username: string;
  displayName: string;
  personName: string | null;
  brandName: string | null;
  affiliationBadge: string;
  sourceUrl: string | null;
  competitorActive: boolean;
  cells: Record<ContestPosition, CreatorImportCellStatus>;
  lateCells: ContestPosition[];
  missingSourceUrlCells: ContestPosition[];
  capturedCount: number;
  expectedCount: number;
  missingPositions: ContestPosition[];
};

export type CreatorCoverageDashboard = {
  activeCreators: number;
  expectedBoards: number;
  importedBoards: number;
  submittedBoards: number;
  missingBoards: number;
  missingSourceLinks: number;
  errorBoards: number;
  rows: CreatorCoverageRow[];
  weekId: string;
};

function mapCell(status: BenchmarkCellStatus, late: boolean): CreatorImportCellStatus {
  if (status === "Missing" || status === "Not Available") return "Not imported";
  if (late) return "Error";
  if (status === "Thursday Snapshot") return "Draft";
  if (
    status === "Sunday Snapshot" ||
    status === "Locked" ||
    status === "Graded"
  ) {
    return "Submitted";
  }
  return "Not imported";
}

export function toCreatorImportStatus(
  status: BenchmarkCellStatus,
  late: boolean,
): CreatorImportCellStatus {
  return mapCell(status, late);
}

export async function getCreatorRankingCoverage(
  weekId: string,
): Promise<CreatorCoverageDashboard> {
  const [coverage, creators, contests, snapshots] = await Promise.all([
    getBenchmarkCoverage(weekId),
    listActiveCreatorCompetitors(),
    prisma.rankIQContest.findMany({
      where: { weekId },
      select: { id: true, position: true },
    }),
    prisma.benchmarkSnapshot.findMany({
      where: { weekId },
      orderBy: { createdAt: "desc" },
      select: {
        contestId: true,
        universalProfileId: true,
        sourceUrl: true,
        late: true,
        status: true,
      },
    }),
  ]);

  const creatorIds = new Set(creators.map((row) => row.id));
  const contestByPosition = new Map(
    contests.map((contest) => [contest.position, contest.id]),
  );

  const latestSnapshot = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.contestId}:${snapshot.universalProfileId}`;
    if (!latestSnapshot.has(key)) latestSnapshot.set(key, snapshot);
  }

  const coverageById = new Map(
    coverage.rows
      .filter((row) => creatorIds.has(row.profileId))
      .map((row) => [row.profileId, row]),
  );

  const rows: CreatorCoverageRow[] = creators.map((creator) => {
    const base: BenchmarkCoverageRow | undefined = coverageById.get(creator.id);
    const cells = {} as Record<ContestPosition, CreatorImportCellStatus>;
    const lateCells: ContestPosition[] = [];
    const missingSourceUrlCells: ContestPosition[] = [];
    let capturedCount = 0;
    let expectedCount = 0;
    const missingPositions: ContestPosition[] = [];

    for (const position of CONTEST_POSITIONS) {
      const contestId = contestByPosition.get(position);
      if (!contestId) {
        cells[position] = "Not imported";
        continue;
      }
      expectedCount += 1;
      const status = base?.cells[position] ?? "Missing";
      const late = Boolean(base?.lateCells.includes(position));
      const mapped = mapCell(status, late);
      cells[position] = mapped;
      if (late) lateCells.push(position);
      if (mapped === "Not imported") missingPositions.push(position);
      if (mapped === "Draft" || mapped === "Submitted") capturedCount += 1;

      const snap = latestSnapshot.get(`${contestId}:${creator.id}`);
      if (
        (mapped === "Draft" || mapped === "Submitted") &&
        !(snap?.sourceUrl?.trim() || creator.creatorCompetitor?.sourceUrl?.trim())
      ) {
        missingSourceUrlCells.push(position);
      }
    }

    const personName = creator.creatorCompetitor?.personName ?? null;
    const brandName = creator.creatorCompetitor?.brandName ?? null;

    return {
      profileId: creator.id,
      username: creator.username,
      displayName: creator.displayName,
      personName,
      brandName,
      affiliationBadge:
        formatCreatorAffiliationBadge({
          displayName: creator.displayName,
          personName,
          brandName,
        }) ?? "CREATOR",
      sourceUrl: creator.creatorCompetitor?.sourceUrl ?? null,
      competitorActive: creator.competitorActive,
      cells,
      lateCells,
      missingSourceUrlCells,
      capturedCount,
      expectedCount,
      missingPositions,
    };
  });

  let expectedBoards = 0;
  let importedBoards = 0;
  let submittedBoards = 0;
  let missingBoards = 0;
  let missingSourceLinks = 0;
  let errorBoards = 0;
  for (const row of rows) {
    for (const position of CONTEST_POSITIONS) {
      if (!contestByPosition.has(position)) continue;
      expectedBoards += 1;
      const status = row.cells[position];
      if (status === "Not imported") missingBoards += 1;
      if (status === "Draft" || status === "Submitted") importedBoards += 1;
      if (status === "Submitted") submittedBoards += 1;
      if (status === "Error") errorBoards += 1;
    }
    missingSourceLinks += row.missingSourceUrlCells.length;
  }

  return {
    activeCreators: rows.filter((row) => row.competitorActive).length,
    expectedBoards,
    importedBoards,
    submittedBoards,
    missingBoards,
    missingSourceLinks,
    errorBoards,
    rows,
    weekId,
  };
}

/** Next incomplete cell for fast “Next Creator / Next Position” navigation. */
export function findNextCreatorImportTarget(input: {
  rows: CreatorCoverageRow[];
  contestByPosition: Map<ContestPosition, string>;
  afterProfileId?: string;
  afterPosition?: ContestPosition;
}): { profileId: string; contestId: string; position: ContestPosition } | null {
  const flat: Array<{
    profileId: string;
    contestId: string;
    position: ContestPosition;
  }> = [];
  for (const row of input.rows) {
    for (const position of CONTEST_POSITIONS) {
      const contestId = input.contestByPosition.get(position);
      if (!contestId) continue;
      if (row.cells[position] === "Not imported" || row.cells[position] === "Error") {
        flat.push({ profileId: row.profileId, contestId, position });
      }
    }
  }
  if (flat.length === 0) return null;
  if (!input.afterProfileId || !input.afterPosition) return flat[0];
  const idx = flat.findIndex(
    (item) =>
      item.profileId === input.afterProfileId &&
      item.position === input.afterPosition,
  );
  if (idx < 0) return flat[0];
  return flat[idx + 1] ?? flat[0];
}

export type { BenchmarkCoverageSummary };
