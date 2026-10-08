import { prisma } from "@/lib/db";
import type { WaiverArtifactImportEvidence, WaiverArtifactImportInput } from "@/lib/waivers/artifacts/import-model";
import {
  buildSyntheticCanonicalArtifact,
  type SealedSyntheticArtifact,
  type SyntheticParticipantSpec,
} from "@/lib/waivers/__fixtures__/canonical-artifact";
import { MAINTENANCE_SQL } from "@/lib/waivers/__fixtures__/competition";

/**
 * Local-DB fixtures for canonical artifact authority tests: a namespaced
 * season (random SNG-valid year) with weeks 5 and 6, an admin and a non-admin
 * user, and synthetic contract artifacts. `cleanup()` removes everything with
 * the fixture-maintenance switch.
 */

const MINUTE = 60_000;

export type ArtifactSpec = {
  week?: number;
  revision?: number;
  /** Defaults to this week's previous fixture revision. */
  supersedesArtifactId?: string | null;
  artifactId?: string;
  participants?: SyntheticParticipantSpec[];
};

export async function createArtifactFixture(tag: string) {
  const suffix = `${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const year = 2030 + Math.floor(Math.random() * 70);
  const season = await prisma.season.create({ data: { year, sport: `WAIVERS-ART-${suffix}`, active: false } });
  const admin = await prisma.user.create({ data: { email: `art-admin-${suffix}@example.test`, role: "ADMIN" } });
  const member = await prisma.user.create({ data: { email: `art-user-${suffix}@example.test` } });
  const weeks = new Map<number, string>();
  for (const weekNumber of [5, 6]) {
    const week = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber,
        label: `W${weekNumber}`,
        startsAt: new Date(Date.now() - 3 * 24 * 60 * MINUTE),
        endsAt: new Date(Date.now() + 3 * 24 * 60 * MINUTE),
        status: "OPEN",
        isTest: true,
      },
    });
    weeks.set(weekNumber, week.id);
  }
  const acceptedAt = new Date(Math.floor((Date.now() - 60 * MINUTE) / 1000) * 1000).toISOString();

  const artifactIdFor = (week: number, revision: number) => `${suffix}-w${week}-r${revision}`;

  function build(spec: ArtifactSpec = {}): SealedSyntheticArtifact {
    const week = spec.week ?? 5;
    const revision = spec.revision ?? 1;
    return buildSyntheticCanonicalArtifact({
      season: year,
      week,
      revision,
      artifactId: spec.artifactId ?? artifactIdFor(week, revision),
      supersedesArtifactId: spec.supersedesArtifactId === undefined ? (revision === 1 ? null : artifactIdFor(week, revision - 1)) : spec.supersedesArtifactId,
      acceptedAt,
      participants: spec.participants,
    });
  }

  function evidence(sealed: SealedSyntheticArtifact, overrides: Partial<WaiverArtifactImportEvidence> = {}): WaiverArtifactImportEvidence {
    const artifact = sealed.artifact as { artifactId: string; revision: number; payload: { acceptance: { id: string; acceptedAt: string } } };
    return {
      expectedContentChecksum: sealed.checksum,
      sngArtifactId: artifact.artifactId,
      sngRevision: artifact.revision,
      sngAcceptanceId: artifact.payload.acceptance.id,
      sngAcceptedAt: new Date(artifact.payload.acceptance.acceptedAt),
      attestedPublicationState: "ACCEPTED",
      sourceReference: `sng-admin://fixture/${artifact.artifactId}`,
      sourceObservedAt: new Date(Date.parse(artifact.payload.acceptance.acceptedAt) + 30 * MINUTE),
      ...overrides,
    };
  }

  function request(sealed: SealedSyntheticArtifact, week = 5, overrides: Partial<WaiverArtifactImportEvidence> = {}): WaiverArtifactImportInput {
    return { weekId: weeks.get(week)!, artifactText: sealed.bytes, evidence: evidence(sealed, overrides) };
  }

  async function cleanup() {
    const weekIds = [...weeks.values()];
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(MAINTENANCE_SQL);
      const artifacts = await tx.waiverCanonicalArtifact.findMany({ where: { weekId: { in: weekIds } }, orderBy: { revision: "desc" }, select: { id: true } });
      const ids = artifacts.map((artifact) => artifact.id);
      await tx.waiverCanonicalArtifactEvent.deleteMany({ where: { OR: [{ artifactRowId: { in: ids } }, { successorArtifactRowId: { in: ids } }] } });
      await tx.waiverCanonicalArtifactContent.deleteMany({ where: { artifactRowId: { in: ids } } });
      for (const id of ids) await tx.waiverCanonicalArtifact.delete({ where: { id } });
      await tx.adminAuditLog.deleteMany({ where: { adminUserId: { in: [admin.id, member.id] } } });
    });
    await prisma.week.deleteMany({ where: { id: { in: weekIds } } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, member.id] } } });
  }

  return { suffix, year, adminUserId: admin.id, memberUserId: member.id, weekId: (week: number) => weeks.get(week)!, artifactIdFor, build, evidence, request, cleanup };
}

export type ArtifactFixture = Awaited<ReturnType<typeof createArtifactFixture>>;
