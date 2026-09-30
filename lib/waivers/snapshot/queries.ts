import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { readWaiverClock } from "@/lib/waivers/clock";
import { WAIVER_POSITIONS } from "@/lib/waivers/constants";
import { resolveWaiverLocksAt } from "@/lib/waivers/lock-time";
import { WAIVER_ROSTER_STALE_AFTER_MS, type WaiverEntryContext, type WaiverFollowUpAck } from "@/lib/waivers/snapshot/preview-model";

/** Read-only admin views of the Waiver snapshot workflow. */

export async function loadWaiverAdminWeeks() {
  return prisma.week.findMany({
    where: { season: { active: true } },
    orderBy: [{ isTest: "asc" }, { weekNumber: "asc" }],
    select: { id: true, label: true, weekNumber: true, status: true, isTest: true },
  });
}

const userLabel = (user: { name: string | null; email: string | null }) => user.name ?? user.email ?? "admin";

export async function loadWaiverWeekOps(weekId: string) {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: { id: true, label: true, weekNumber: true, status: true, isTest: true, season: { select: { year: true, rosterSyncedAt: true } } },
  });
  if (!week) return null;
  const now = await readWaiverClock();

  const games = await prisma.nflGame.findMany({ where: { weekId }, select: { startsAt: true, status: true } });
  const scheduled = games.filter((game) => game.status !== "CANCELED");
  const firstKickoff = scheduled.length ? new Date(Math.min(...scheduled.map((game) => game.startsAt.getTime()))) : null;
  const lock = firstKickoff ? resolveWaiverLocksAt(firstKickoff) : null;
  const availabilityRows = await prisma.playerWeekAvailability.count({ where: { weekId } });
  const latestAvailability = await prisma.playerWeekAvailability.aggregate({ where: { weekId }, _max: { observedAt: true } });

  const versions = await prisma.waiverSnapshot.findMany({
    where: { weekId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      status: true,
      currentForWeekId: true,
      sourceLabel: true,
      observedAt: true,
      frozenAt: true,
      candidateCount: true,
      eligibleCount: true,
      excludedCount: true,
      followUpCount: true,
      correctionCase: true,
      correctionReason: true,
      frozenBy: { select: { name: true, email: true } },
    },
  });

  const contestRows = await prisma.waiverContest.findMany({
    where: { weekId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, status: true, locksAt: true, opensAt: true, snapshot: { select: { id: true, version: true } } },
  });
  const contests = [];
  for (const contest of contestRows) {
    const byStatus = await prisma.waiverSubmission.groupBy({ by: ["status"], where: { contestId: contest.id }, _count: { _all: true } });
    const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
    contests.push({
      id: contest.id,
      position: contest.position,
      status: now.getTime() >= contest.locksAt.getTime() ? "LOCKED" : contest.status,
      locksAt: contest.locksAt,
      opensAt: contest.opensAt,
      snapshotId: contest.snapshot.id,
      snapshotVersion: contest.snapshot.version,
      submitted: count("SUBMITTED") + count("LOCKED"),
      drafts: count("DRAFT"),
    });
  }
  const opened = new Set<ContestPosition>(contests.map((contest) => contest.position));
  const unopenedPositions = WAIVER_POSITIONS.filter((position) => !opened.has(position));
  const current = versions.find((version) => version.currentForWeekId === weekId) ?? null;
  const lockPassed = Boolean(lock?.ok && now.getTime() >= lock.locksAt.getTime());

  return {
    now,
    week: { id: week.id, label: week.label, weekNumber: week.weekNumber, status: week.status, isTest: week.isTest, seasonYear: week.season.year },
    readiness: {
      scheduledGames: scheduled.length,
      canceledGames: games.length - scheduled.length,
      postponedGames: games.filter((game) => game.status === "POSTPONED").length,
      firstKickoff,
      locksAt: lock?.ok ? lock.locksAt : null,
      lockResolvable: Boolean(lock?.ok),
      lockPassed,
      rosterSyncedAt: week.season.rosterSyncedAt,
      rosterStale: !week.season.rosterSyncedAt || now.getTime() - week.season.rosterSyncedAt.getTime() > WAIVER_ROSTER_STALE_AFTER_MS,
      availabilityRows,
      latestAvailabilityAt: latestAvailability._max.observedAt,
    },
    current: current ? { ...current, frozenBy: userLabel(current.frozenBy) } : null,
    versions: versions.map((version) => ({ ...version, frozenBy: userLabel(version.frozenBy) })),
    contests,
    unopenedPositions,
    canOpenContests: Boolean(current && lock?.ok && !lockPassed && unopenedPositions.length > 0),
  };
}

export type WaiverWeekOps = NonNullable<Awaited<ReturnType<typeof loadWaiverWeekOps>>>;

type FreezeMetadata = {
  acknowledged?: string[];
  followUpAcks?: WaiverFollowUpAck[];
  missingFollowUps?: Array<{ rankableEntryId: string; name: string; position: string; lastObservedBps: number; lastObservedWeekNumber: number }>;
  entryContext?: WaiverEntryContext[];
  previewFingerprint?: string;
  correctionFingerprint?: string;
  inputSha256?: string;
};

export async function loadWaiverSnapshotDetail(snapshotId: string) {
  const snapshot = await prisma.waiverSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      week: { select: { id: true, label: true, weekNumber: true, isTest: true } },
      frozenBy: { select: { name: true, email: true } },
      supersedes: { select: { id: true, version: true } },
      supersededBy: { select: { id: true, version: true } },
      entries: { orderBy: [{ position: "asc" }, { evidenceRole: "asc" }, { eligibility: "asc" }, { rosteredBps: "asc" }, { inputLineNumber: "asc" }] },
      correctionsTo: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { operator: { select: { name: true, email: true } } },
      },
      contests: { orderBy: { position: "asc" }, select: { id: true, position: true, status: true, locksAt: true } },
    },
  });
  if (!snapshot) return null;
  const log = snapshot.manualImportLogId
    ? await prisma.manualImportLog.findUnique({ where: { id: snapshot.manualImportLogId }, select: { id: true, importType: true, createdAt: true, metadata: true } })
    : null;
  const metadata = (log?.metadata ?? {}) as FreezeMetadata;
  const contexts = new Map((metadata.entryContext ?? []).map((row) => [row.rankableEntryId, row]));
  return {
    id: snapshot.id,
    week: snapshot.week,
    version: snapshot.version,
    status: snapshot.status,
    isCurrent: snapshot.currentForWeekId === snapshot.weekId,
    thresholdBps: snapshot.thresholdBps,
    sourceLabel: snapshot.sourceLabel,
    sourceUrl: snapshot.sourceUrl,
    observedAt: snapshot.observedAt,
    frozenAt: snapshot.frozenAt,
    frozenBy: userLabel(snapshot.frozenBy),
    rawInputSha256: snapshot.rawInputSha256,
    entriesFingerprint: snapshot.entriesFingerprint,
    counts: {
      candidateCount: snapshot.candidateCount,
      eligibleCount: snapshot.eligibleCount,
      excludedCount: snapshot.excludedCount,
      followUpCount: snapshot.followUpCount,
    },
    correctionCase: snapshot.correctionCase,
    correctionReason: snapshot.correctionReason,
    supersedes: snapshot.supersedes,
    supersededBy: snapshot.supersededBy,
    importLog: log ? { id: log.id, importType: log.importType, createdAt: log.createdAt } : null,
    provenance: {
      acknowledged: metadata.acknowledged ?? [],
      followUpAcks: metadata.followUpAcks ?? [],
      missingFollowUps: metadata.missingFollowUps ?? [],
      previewFingerprint: metadata.previewFingerprint ?? null,
      correctionFingerprint: metadata.correctionFingerprint ?? null,
    },
    entries: snapshot.entries.map((entry) => ({
      ...entry,
      gameStatusAtFreeze: contexts.get(entry.rankableEntryId)?.gameStatusAtFreeze ?? null,
      tracked: contexts.get(entry.rankableEntryId)?.tracked ?? false,
      sourceTeamConflict: contexts.get(entry.rankableEntryId)?.teamConflict ? (contexts.get(entry.rankableEntryId)?.sourceTeam ?? "FA") : null,
    })),
    corrections: snapshot.correctionsTo.map((row) => ({ ...row, operator: userLabel(row.operator) })),
    contests: snapshot.contests,
  };
}

export type WaiverSnapshotDetail = NonNullable<Awaited<ReturnType<typeof loadWaiverSnapshotDetail>>>;
