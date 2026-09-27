import { prisma } from "@/lib/db";
import {
  resolveSubmissionAuthority,
  type BoardAuthorityEvidence,
} from "@/lib/boards/authority";
import type {
  BenchmarkSnapshotStatus,
  ProfileType,
} from "@/lib/generated/prisma/client";

/**
 * RankEyeQ captured-source rights (BenchmarkSnapshot publicBoardAllowed /
 * NOT_AVAILABLE). A source-rights restriction, never an owner publication
 * setting — it only ever applies to captured-provenance boards.
 */
export type SnapshotRightsFields = {
  status: BenchmarkSnapshotStatus;
  publicBoardAllowed: boolean;
};

/** Captured provenance follows board authority: OWNER_AUTHORED boards never carry it. */
export function boardShowsCaptureProvenance(input: {
  profileType: ProfileType;
  submission: BoardAuthorityEvidence | null;
}): boolean {
  if (input.profileType !== "BENCHMARK" && input.profileType !== "CREATOR") {
    return false;
  }
  return resolveSubmissionAuthority(input) !== "OWNER_AUTHORED";
}

export function snapshotRestrictsPublicBoard(
  latestSnapshot: SnapshotRightsFields | null | undefined,
): boolean {
  if (!latestSnapshot) return false;
  return (
    latestSnapshot.status === "NOT_AVAILABLE" ||
    latestSnapshot.publicBoardAllowed === false
  );
}

/** Individual picks of this board must not be reproduced on public surfaces. */
export function capturedBoardSourceRestricted(input: {
  profileType: ProfileType;
  submission: BoardAuthorityEvidence | null;
  latestSnapshot: SnapshotRightsFields | null | undefined;
}): boolean {
  return (
    boardShowsCaptureProvenance(input) &&
    snapshotRestrictsPublicBoard(input.latestSnapshot)
  );
}

export function sourceRightsBoardKey(contestId: string, universalProfileId: string) {
  return `${contestId}:${universalProfileId}`;
}

/** Latest snapshot rights per profile+contest board (same ordering as the public board page). */
export async function loadLatestSnapshotRights(
  boards: ReadonlyArray<{ contestId: string; universalProfileId: string }>,
): Promise<Map<string, SnapshotRightsFields>> {
  const rights = new Map<string, SnapshotRightsFields>();
  if (boards.length === 0) return rights;
  const wanted = new Set(
    boards.map((board) => sourceRightsBoardKey(board.contestId, board.universalProfileId)),
  );
  const snapshots = await prisma.benchmarkSnapshot.findMany({
    where: {
      contestId: { in: [...new Set(boards.map((board) => board.contestId))] },
      universalProfileId: {
        in: [...new Set(boards.map((board) => board.universalProfileId))],
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      contestId: true,
      universalProfileId: true,
      status: true,
      publicBoardAllowed: true,
    },
  });
  for (const snapshot of snapshots) {
    const key = sourceRightsBoardKey(snapshot.contestId, snapshot.universalProfileId);
    if (!wanted.has(key) || rights.has(key)) continue;
    rights.set(key, {
      status: snapshot.status,
      publicBoardAllowed: snapshot.publicBoardAllowed,
    });
  }
  return rights;
}
