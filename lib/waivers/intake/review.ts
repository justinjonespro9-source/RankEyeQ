import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { loadVerifiedWaiverArtifact } from "@/lib/waivers/artifacts/queries";
import { loadWaiverCanonicalPreflightSnapshot } from "@/lib/waivers/canonical/preflight";
import type { PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";
import type { WaiverDb } from "@/lib/waivers/clock";
import { WAIVER_POSITIONS } from "@/lib/waivers/constants";
import {
  evaluateWaiverResultsIntake,
  type WaiverIntakeArtifactInput,
  type WaiverIntakePositionInput,
  type WaiverResultsIntake,
} from "@/lib/waivers/intake/model";

/**
 * Read-only results intake review (SELECT only): the stored artifact
 * (re-verified, never fetched), every contest's pinned frozen snapshot, the
 * entries called on locked boards and the current D3 resolutions bound to this
 * artifact row. Grades, approves, applies and writes nothing.
 */

const ENTRY_SELECT = {
  id: true,
  rankableEntryId: true,
  position: true,
  evidenceRole: true,
  eligibility: true,
  displayNameAtFreeze: true,
  teamAtFreeze: true,
  isByeAtFreeze: true,
  identityProviderAtFreeze: true,
  identityExternalIdAtFreeze: true,
  rankableEntry: { select: { provider: true, externalId: true, team: true, active: true, adminNotes: true, name: true } },
} satisfies Prisma.WaiverSnapshotEntrySelect;

function toPreflightEntry(entry: Prisma.WaiverSnapshotEntryGetPayload<{ select: typeof ENTRY_SELECT }>): PreflightSnapshotEntry {
  return {
    snapshotEntryId: entry.id,
    rankableEntryId: entry.rankableEntryId,
    position: entry.position,
    evidenceRole: entry.evidenceRole,
    eligibility: entry.eligibility,
    displayNameAtFreeze: entry.displayNameAtFreeze,
    teamAtFreeze: entry.teamAtFreeze,
    isByeAtFreeze: entry.isByeAtFreeze,
    frozenIdentity:
      entry.identityProviderAtFreeze !== null && entry.identityExternalIdAtFreeze !== null
        ? { provider: entry.identityProviderAtFreeze, externalId: entry.identityExternalIdAtFreeze }
        : null,
    rankable: entry.rankableEntry,
  };
}

/** Null when the artifact row does not exist. */
export async function loadWaiverResultsIntake(db: WaiverDb, artifactRowId: string): Promise<WaiverResultsIntake | null> {
  const row = await db.waiverCanonicalArtifact.findUnique({
    where: { id: artifactRowId },
    select: {
      id: true,
      artifactId: true,
      seriesKey: true,
      revision: true,
      contentChecksum: true,
      weekId: true,
      defCrosswalkVersion: true,
      week: { select: { id: true, weekNumber: true, season: { select: { year: true } } } },
      events: { orderBy: { sequence: "desc" }, take: 1, select: { state: true, sequence: true } },
    },
  });
  if (!row) return null;
  const week = { id: row.week.id, season: row.week.season.year, weekNumber: row.week.weekNumber };
  const newerRevisions = await db.waiverCanonicalArtifact.count({ where: { weekId: week.id, seriesKey: row.seriesKey, revision: { gt: row.revision } } });
  const loaded = await loadVerifiedWaiverArtifact(db, row.id);
  const artifact: WaiverIntakeArtifactInput = {
    rowId: row.id,
    artifactId: row.artifactId,
    seriesKey: row.seriesKey,
    revision: row.revision,
    contentChecksum: row.contentChecksum,
    weekId: row.weekId,
    defCrosswalkVersion: row.defCrosswalkVersion,
    latestState: row.events[0]?.state ?? null,
    latestSequence: row.events[0]?.sequence ?? null,
    newerRevisions,
    verification: !loaded ? { ok: false, issueCodes: ["CONTENT_MISSING"] } : loaded.ok ? { ok: true, verified: loaded.verified } : { ok: false, issueCodes: loaded.issueCodes },
  };

  const currentSnapshot = await db.waiverSnapshot.findFirst({
    where: { currentForWeekId: week.id, status: "FROZEN" },
    select: { id: true, entries: { where: { evidenceRole: "CANDIDATE", eligibility: "ELIGIBLE" }, select: { position: true } } },
  });
  const contests = await db.waiverContest.findMany({
    where: { weekId: week.id },
    select: { id: true, position: true, status: true, snapshotId: true, scoringVersion: true, maxCalls: true, resultFieldSize: true },
  });

  const positions: WaiverIntakePositionInput[] = [];
  for (const position of WAIVER_POSITIONS) {
    const contest = contests.find((c) => c.position === position);
    if (!contest) {
      positions.push({
        position,
        kind: "NO_CONTEST",
        currentSnapshot: currentSnapshot ? { id: currentSnapshot.id, eligibleAtPosition: currentSnapshot.entries.filter((e) => e.position === position).length } : null,
      });
      continue;
    }
    const submissions = await db.waiverSubmission.findMany({
      where: { contestId: contest.id },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        universalProfileId: true,
        universalProfile: { select: { profileType: true, competitorActive: true } },
        lockedRevision: {
          select: {
            id: true,
            kind: true,
            callCount: true,
            fingerprint: true,
            lateEntry: { select: { id: true } },
            competitiveOverride: { select: { id: true } },
            calls: { orderBy: { slot: "asc" }, select: { slot: true, snapshotEntry: { select: ENTRY_SELECT } } },
          },
        },
      },
    });
    const pinned = await loadWaiverCanonicalPreflightSnapshot(db, contest.snapshotId);
    const snapshotRow = await db.waiverSnapshot.findUniqueOrThrow({ where: { id: contest.snapshotId }, select: { version: true, entriesFingerprint: true } });
    const resolutions = await db.waiverConflictResolution.findMany({
      where: { contestId: contest.id, artifactRowId: row.id, supersededBy: null },
      orderBy: { conflictKey: "asc" },
      select: { id: true, conflictKey: true, sequence: true, conflictKind: true, resolution: true, snapshotEntryId: true, sngParticipantId: true },
    });
    positions.push({
      position,
      kind: "CONTEST",
      contest: { id: contest.id, status: contest.status, snapshotId: contest.snapshotId, scoringVersion: contest.scoringVersion, maxCalls: contest.maxCalls, resultFieldSize: contest.resultFieldSize },
      snapshot: { id: contest.snapshotId, version: snapshotRow.version, entriesFingerprint: snapshotRow.entriesFingerprint, isCurrent: contest.snapshotId === currentSnapshot?.id, entries: pinned.entries },
      boards: submissions.flatMap((s) => {
        const revision = s.lockedRevision;
        if (!revision) return [];
        return [
          {
            submissionId: s.id,
            revisionId: revision.id,
            revisionFingerprint: revision.fingerprint,
            revisionKind: revision.kind,
            revisionCallCount: revision.callCount,
            competitor: {
              universalProfileId: s.universalProfileId,
              profileType: s.universalProfile.profileType,
              competitorActive: s.universalProfile.competitorActive,
              entryBasis: revision.competitiveOverride ? "ADMIN_COMPETITIVE_OVERRIDE" : revision.lateEntry ? "AI_LATE_ENTRY" : "STANDARD",
            },
            calls: revision.calls.map((call) => ({ slot: call.slot, entry: toPreflightEntry(call.snapshotEntry) })),
          },
        ];
      }),
      unstampedBoardCount: submissions.filter((s) => s.status === "SUBMITTED").length,
      resolutions,
    });
  }

  return evaluateWaiverResultsIntake({ week, artifact, positions });
}

/** Admin page entry point. */
export async function loadWaiverResultsIntakeView(artifactRowId: string): Promise<WaiverResultsIntake | null> {
  return loadWaiverResultsIntake(prisma, artifactRowId);
}
