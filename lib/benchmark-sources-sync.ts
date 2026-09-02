import { prisma } from "@/lib/db";
import {
  EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT,
  OFFICIAL_BENCHMARK_SOURCES,
  OFFICIAL_BENCHMARK_USERNAMES,
} from "@/lib/benchmark-sources";
import { ensureExpertSourceMetadata } from "@/lib/expert-identity";

type BenchmarkDb = {
  universalProfile: typeof prisma.universalProfile;
};

/**
 * Active expert/benchmark sources for coverage, smoke checks, and public profiles.
 */
export async function listActiveBenchmarkSources(db: BenchmarkDb = prisma) {
  return db.universalProfile.findMany({
    where: {
      profileType: "BENCHMARK",
      competitorActive: true,
      status: "ACTIVE",
    },
    orderBy: { displayName: "asc" },
  });
}

export async function countActiveBenchmarkSources(db: BenchmarkDb = prisma) {
  return db.universalProfile.count({
    where: {
      profileType: "BENCHMARK",
      competitorActive: true,
      status: "ACTIVE",
      username: { in: [...OFFICIAL_BENCHMARK_USERNAMES] },
    },
  });
}

/**
 * Idempotent upsert of the official 8 expert/benchmark sources.
 * Safe for seed. Does not delete graded history.
 */
export async function ensureOfficialBenchmarkSources(db: BenchmarkDb = prisma) {
  for (const source of OFFICIAL_BENCHMARK_SOURCES) {
    const profile = await db.universalProfile.upsert({
      where: { username: source.username },
      update: {
        displayName: source.displayName,
        profileType: "BENCHMARK",
        status: "ACTIVE",
        competitorActive: true,
        universalUserId: source.universalUserId,
      },
      create: {
        username: source.username,
        displayName: source.displayName,
        profileType: "BENCHMARK",
        status: "ACTIVE",
        competitorActive: true,
        universalUserId: source.universalUserId,
      },
    });
    await ensureExpertSourceMetadata({
      universalProfileId: profile.id,
      displayName: source.displayName,
      publicationName: source.displayName,
    });
  }

  const activeCount = await countActiveBenchmarkSources(db);
  return {
    ok: activeCount === EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT,
    activeCount,
    expected: EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT,
  };
}
