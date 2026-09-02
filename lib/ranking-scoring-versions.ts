import { prisma } from "@/lib/db";
import {
  getDefaultRankingScoringConfig,
  parseRankingScoringConfig,
  RANKEYEQ_V1_SLUG,
  type RankingScoringConfig,
} from "@/lib/ranking-scoring-version";

export async function getActiveRankingScoringVersion() {
  const active = await prisma.rankingScoringVersion.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { activatedAt: "desc" },
  });
  if (active) return active;

  return prisma.rankingScoringVersion.findUnique({
    where: { slug: RANKEYEQ_V1_SLUG },
  });
}

export async function resolveScoringConfigForContest(contestId: string): Promise<{
  versionId: string | null;
  config: RankingScoringConfig;
  slug: string | null;
}> {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      rankingScoringVersion: true,
      season: { include: { activeRankingScoringVersion: true } },
    },
  });

  if (!contest) {
    return {
      versionId: null,
      config: getDefaultRankingScoringConfig(),
      slug: RANKEYEQ_V1_SLUG,
    };
  }

  if (contest.rankingScoringConfig) {
    return {
      versionId: contest.rankingScoringVersionId,
      config: parseRankingScoringConfig(contest.rankingScoringConfig),
      slug: contest.rankingScoringVersion?.slug ?? RANKEYEQ_V1_SLUG,
    };
  }

  if (contest.rankingScoringVersion) {
    return {
      versionId: contest.rankingScoringVersion.id,
      config: parseRankingScoringConfig(contest.rankingScoringVersion.config),
      slug: contest.rankingScoringVersion.slug,
    };
  }

  const seasonVersion = contest.season.activeRankingScoringVersion;
  if (seasonVersion) {
    return {
      versionId: seasonVersion.id,
      config: parseRankingScoringConfig(seasonVersion.config),
      slug: seasonVersion.slug,
    };
  }

  const active = await getActiveRankingScoringVersion();
  if (active) {
    return {
      versionId: active.id,
      config: parseRankingScoringConfig(active.config),
      slug: active.slug,
    };
  }

  return {
    versionId: null,
    config: getDefaultRankingScoringConfig(),
    slug: RANKEYEQ_V1_SLUG,
  };
}

export async function listRankingScoringVersions() {
  return prisma.rankingScoringVersion.findMany({
    orderBy: [{ status: "asc" }, { activatedAt: "desc" }],
  });
}

export async function activateRankingScoringVersion(versionId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.rankingScoringVersion.updateMany({
      where: { status: "ACTIVE", id: { not: versionId } },
      data: { status: "RETIRED" },
    });
    await tx.rankingScoringVersion.update({
      where: { id: versionId },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
  });
}
