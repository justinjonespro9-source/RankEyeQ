import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { WAIVER_ARTIFACT_PUBLICATION_AUTHORITY } from "@/lib/waivers/artifacts/authority";
import { waiverArtifactByteLength, waiverArtifactTextSha256 } from "@/lib/waivers/artifacts/import-model";
import { verifySngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";

/** Read-only admin views of imported canonical artifacts. Never return artifact text. */

const userLabel = (user: { name: string | null; email: string | null }) => user.name ?? user.email ?? "admin";

const EVENT_SELECT = {
  id: true,
  sequence: true,
  state: true,
  basis: true,
  reason: true,
  sourceReference: true,
  sourceObservedAt: true,
  attestationVersion: true,
  recordedAt: true,
  successor: { select: { id: true, artifactId: true, revision: true } },
  operator: { select: { name: true, email: true } },
} satisfies Prisma.WaiverCanonicalArtifactEventSelect;

const LIST_SELECT = {
  id: true,
  artifactId: true,
  seriesKey: true,
  revision: true,
  supersedesArtifactId: true,
  contentChecksum: true,
  acceptanceId: true,
  acceptedAt: true,
  authorityBasis: true,
  sourceReference: true,
  sourceObservedAt: true,
  participantCount: true,
  byteLength: true,
  importedAt: true,
  importedBy: { select: { name: true, email: true } },
  supersededBy: { select: { id: true, artifactId: true, revision: true } },
  events: { orderBy: { sequence: "asc" }, select: EVENT_SELECT },
} satisfies Prisma.WaiverCanonicalArtifactSelect;

type EventRow = Prisma.WaiverCanonicalArtifactEventGetPayload<{ select: typeof EVENT_SELECT }>;

function shapeEvents(events: EventRow[]) {
  return events.map(({ operator, ...event }) => ({ ...event, operator: userLabel(operator) }));
}

export async function loadWaiverArtifactWeekView(weekId: string) {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: { id: true, label: true, weekNumber: true, status: true, isTest: true, season: { select: { year: true } } },
  });
  if (!week) return null;
  const rows = await prisma.waiverCanonicalArtifact.findMany({ where: { weekId }, orderBy: { revision: "asc" }, select: LIST_SELECT });
  return {
    week: { id: week.id, label: week.label, weekNumber: week.weekNumber, status: week.status, isTest: week.isTest, seasonYear: week.season.year },
    authorityMode: WAIVER_ARTIFACT_PUBLICATION_AUTHORITY,
    artifacts: rows.map(({ importedBy, events, ...row }) => ({
      ...row,
      importedBy: userLabel(importedBy),
      currentState: events[events.length - 1]?.state ?? null,
      events: shapeEvents(events),
    })),
  };
}

export async function loadWaiverArtifactDetail(artifactRowId: string) {
  const row = await prisma.waiverCanonicalArtifact.findUnique({
    where: { id: artifactRowId },
    select: {
      ...LIST_SELECT,
      schemaVersion: true,
      serializationVersion: true,
      rulesetCode: true,
      rulesetVersion: true,
      rulesetDefinitionChecksum: true,
      engineVersion: true,
      positionPolicyVersion: true,
      readinessPolicyVersion: true,
      sngAcceptedById: true,
      generatedAt: true,
      readinessEvidenceChecksum: true,
      manifestChecksum: true,
      runFingerprint: true,
      inputSetChecksum: true,
      sourceRevisionFingerprint: true,
      season: true,
      weekNumber: true,
      qbFieldSize: true,
      rbFieldSize: true,
      wrFieldSize: true,
      teFieldSize: true,
      defFieldSize: true,
      defCrosswalkVersion: true,
      expectedContentChecksum: true,
      attestedPublicationState: true,
      attestationVersion: true,
      attestationText: true,
      previewFingerprint: true,
      week: { select: { id: true, label: true } },
      supersedes: { select: { id: true, artifactId: true, revision: true } },
    },
  });
  if (!row) return null;
  const { importedBy, events, ...rest } = row;
  return {
    ...rest,
    importedBy: userLabel(importedBy),
    currentState: events[events.length - 1]?.state ?? null,
    latestSequence: events[events.length - 1]?.sequence ?? 0,
    events: shapeEvents(events),
  };
}

/**
 * Re-runs the authoritative verifier over the stored text and its recorded
 * digests. The only read of artifact content; returns findings, never text.
 */
export async function reverifyWaiverArtifactContent(artifactRowId: string) {
  const row = await prisma.waiverCanonicalArtifact.findUnique({
    where: { id: artifactRowId },
    select: {
      season: true,
      weekNumber: true,
      contentChecksum: true,
      byteLength: true,
      content: { select: { contentText: true, textSha256: true, byteLength: true } },
    },
  });
  if (!row?.content) return null;
  const text = row.content.contentText;
  const result = verifySngCanonicalArtifact(text, {
    expectedSeason: row.season,
    expectedWeek: row.weekNumber,
    expectedContentChecksum: row.contentChecksum,
  });
  return {
    ok: result.ok && waiverArtifactTextSha256(text) === row.content.textSha256 && waiverArtifactByteLength(text) === row.byteLength,
    verifierOk: result.ok,
    issueCodes: result.ok ? [] : result.issues.map((issue) => issue.code),
    textSha256Matches: waiverArtifactTextSha256(text) === row.content.textSha256,
    byteLengthMatches: waiverArtifactByteLength(text) === row.byteLength && row.content.byteLength === row.byteLength,
  };
}
