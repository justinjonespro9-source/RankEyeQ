import { prisma } from "@/lib/db";
import {
  verifySngCanonicalArtifact,
  type CanonicalVerificationIssue,
  type VerifiedSngCanonicalArtifact,
} from "@/lib/waivers/canonical/artifact-verifier";
import {
  evaluateWaiverCanonicalPreflight,
  type PreflightSnapshot,
  type WaiverCanonicalPreflight,
} from "@/lib/waivers/canonical/preflight-model";
import type { WaiverDb } from "@/lib/waivers/clock";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";

export type WaiverCanonicalPreflightInput = {
  snapshotId: string;
  /** Exported artifact text supplied by the operator; never fetched from SNG and never stored. */
  artifactText?: string;
  expectedContentChecksum?: string;
  attestedPublicationState?: string;
};

/** Loads one snapshot with its live RankableEntry identities (SELECT only). */
export async function loadWaiverCanonicalPreflightSnapshot(db: WaiverDb, snapshotId: string): Promise<PreflightSnapshot> {
  const snapshot = await db.waiverSnapshot.findUnique({
    where: { id: snapshotId },
    select: {
      id: true,
      status: true,
      season: { select: { year: true } },
      week: { select: { weekNumber: true } },
      entries: {
        orderBy: [{ position: "asc" }, { inputLineNumber: "asc" }],
        select: {
          id: true,
          rankableEntryId: true,
          position: true,
          evidenceRole: true,
          eligibility: true,
          displayNameAtFreeze: true,
          teamAtFreeze: true,
          isByeAtFreeze: true,
          rankableEntry: { select: { provider: true, externalId: true, team: true, active: true, adminNotes: true, name: true } },
        },
      },
    },
  });
  if (!snapshot) throw new WaiverSnapshotError("NOT_FOUND", "Snapshot not found");
  return {
    id: snapshot.id,
    status: snapshot.status,
    seasonYear: snapshot.season.year,
    weekNumber: snapshot.week.weekNumber,
    entries: snapshot.entries.map((entry) => ({
      snapshotEntryId: entry.id,
      rankableEntryId: entry.rankableEntryId,
      position: entry.position,
      evidenceRole: entry.evidenceRole,
      eligibility: entry.eligibility,
      displayNameAtFreeze: entry.displayNameAtFreeze,
      teamAtFreeze: entry.teamAtFreeze,
      isByeAtFreeze: entry.isByeAtFreeze,
      rankable: entry.rankableEntry,
    })),
  };
}

/**
 * Read-only identity preflight: loads the snapshot, verifies supplied artifact
 * text against the snapshot's season/week, and evaluates the pure model.
 */
export async function buildWaiverCanonicalPreflight(db: WaiverDb, input: WaiverCanonicalPreflightInput): Promise<WaiverCanonicalPreflight> {
  const snapshot = await loadWaiverCanonicalPreflightSnapshot(db, input.snapshotId);
  let verified: VerifiedSngCanonicalArtifact | null = null;
  let artifactIssues: CanonicalVerificationIssue[] | undefined;
  if (input.artifactText !== undefined) {
    const result = verifySngCanonicalArtifact(input.artifactText, {
      expectedSeason: snapshot.seasonYear,
      expectedWeek: snapshot.weekNumber,
      expectedContentChecksum: input.expectedContentChecksum,
      attestedPublicationState: input.attestedPublicationState,
    });
    if (result.ok) verified = { artifact: result.artifact, summary: result.summary };
    else artifactIssues = result.issues;
  }
  return evaluateWaiverCanonicalPreflight({ snapshot, verified, artifactIssues });
}

export async function previewWaiverCanonicalPreflight(input: WaiverCanonicalPreflightInput): Promise<WaiverCanonicalPreflight> {
  return buildWaiverCanonicalPreflight(prisma, input);
}
