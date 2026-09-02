import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { ProfileType } from "@/lib/generated/prisma/client";
import { isOfficialBenchmarkUsername } from "@/lib/benchmark-sources";

/** UI label for BENCHMARK profile type. */
export const EXPERT_PROFILE_TYPE: ProfileType = "BENCHMARK";

export function isExpertProfile(profileType: ProfileType): boolean {
  return profileType === "BENCHMARK";
}

export type ExpertIdentityRow = {
  universalProfileId: string;
  username: string;
  displayName: string;
  publicationName: string | null;
  analystName: string | null;
  sourceUrl: string | null;
  sourceKind: string;
  positionsCovered: ContestPosition[];
  active: boolean;
  competitorActive: boolean;
  isOfficialSource: boolean;
  gradedSubmissions: number;
};

export async function listExpertIdentities(): Promise<ExpertIdentityRow[]> {
  const profiles = await prisma.universalProfile.findMany({
    where: { profileType: "BENCHMARK" },
    include: {
      expertSource: true,
      submissions: {
        where: { status: "GRADED" },
        select: { id: true },
      },
    },
    orderBy: { displayName: "asc" },
  });

  return profiles.map((profile) => ({
    universalProfileId: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    publicationName: profile.expertSource?.publicationName ?? profile.displayName,
    analystName: profile.expertSource?.analystName ?? null,
    sourceUrl: profile.expertSource?.sourceUrl ?? null,
    sourceKind: profile.expertSource?.sourceKind ?? "PUBLISHER",
    positionsCovered: parsePositionsCovered(profile.expertSource?.positionsCovered),
    active: profile.expertSource?.active ?? true,
    competitorActive: profile.competitorActive,
    isOfficialSource: isOfficialBenchmarkUsername(profile.username),
    gradedSubmissions: profile.submissions.length,
  }));
}

export async function upsertExpertSourceProfile(input: {
  universalProfileId: string;
  publicationName?: string | null;
  analystName?: string | null;
  sourceUrl?: string | null;
  sourceKind?: string;
  positionsCovered?: ContestPosition[];
  active?: boolean;
  notes?: string | null;
}) {
  const positionsJson =
    input.positionsCovered && input.positionsCovered.length > 0
      ? input.positionsCovered
      : undefined;

  return prisma.expertSourceProfile.upsert({
    where: { universalProfileId: input.universalProfileId },
    update: {
      publicationName: input.publicationName ?? undefined,
      analystName: input.analystName ?? undefined,
      sourceUrl: input.sourceUrl ?? undefined,
      sourceKind: input.sourceKind ?? undefined,
      positionsCovered: positionsJson,
      active: input.active ?? undefined,
      notes: input.notes ?? undefined,
    },
    create: {
      universalProfileId: input.universalProfileId,
      publicationName: input.publicationName ?? null,
      analystName: input.analystName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      sourceKind: input.sourceKind ?? "PUBLISHER",
      positionsCovered: positionsJson,
      active: input.active ?? true,
      notes: input.notes ?? null,
    },
  });
}

function parsePositionsCovered(raw: unknown): ContestPosition[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(["QB", "RB", "WR", "TE", "DEF"]);
  return raw.filter(
    (value): value is ContestPosition =>
      typeof value === "string" && allowed.has(value),
  );
}

export async function ensureExpertSourceMetadata(input: {
  universalProfileId: string;
  displayName: string;
  publicationName?: string;
}) {
  const existing = await prisma.expertSourceProfile.findUnique({
    where: { universalProfileId: input.universalProfileId },
  });
  if (existing) return existing;

  return upsertExpertSourceProfile({
    universalProfileId: input.universalProfileId,
    publicationName: input.publicationName ?? input.displayName,
    sourceKind: "PUBLISHER",
    active: true,
  });
}
