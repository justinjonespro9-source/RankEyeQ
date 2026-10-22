import { prisma } from "@/lib/db";
import type { WaiverDb } from "@/lib/waivers/clock";

/**
 * Read-only RankEyeQ results snapshot queries for admin. Never builds, commits,
 * grades or mutates WeekStat rows.
 */

export type RankEyeQResultsSnapshotListItem = {
  id: string;
  weekId: string;
  revision: number;
  contentChecksum: string;
  seriesKey: string;
  publicationState: string;
  participantCount: number;
  pendingZeroCount: number;
  unresolvedCount: number;
  sourceReference: string;
  authorityBasis: string;
  schemaVersion: string;
  scoringVersion: string;
  builtAt: Date;
  builtByUserId: string;
  supersedesSnapshotId: string | null;
};

export async function loadRankEyeQResultsSnapshotsForWeek(weekId: string, db: WaiverDb = prisma): Promise<RankEyeQResultsSnapshotListItem[]> {
  return db.waiverRankEyeQResultsSnapshot.findMany({
    where: { weekId },
    orderBy: { revision: "desc" },
    select: {
      id: true,
      weekId: true,
      revision: true,
      contentChecksum: true,
      seriesKey: true,
      publicationState: true,
      participantCount: true,
      pendingZeroCount: true,
      unresolvedCount: true,
      sourceReference: true,
      authorityBasis: true,
      schemaVersion: true,
      scoringVersion: true,
      builtAt: true,
      builtByUserId: true,
      supersedesSnapshotId: true,
    },
  });
}

export async function loadRankEyeQResultsSnapshotDetail(snapshotId: string, db: WaiverDb = prisma) {
  return db.waiverRankEyeQResultsSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      decisions: {
        orderBy: { rankableEntryId: "asc" },
        select: {
          id: true,
          rankableEntryId: true,
          decision: true,
          evidenceReference: true,
          reason: true,
          decidedByUserId: true,
          decidedAt: true,
        },
      },
      builtBy: { select: { id: true, email: true } },
      week: { select: { id: true, weekNumber: true, label: true, status: true } },
    },
  });
}
