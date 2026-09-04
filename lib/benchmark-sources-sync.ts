import { prisma } from "@/lib/db";
import {
  EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT,
  OFFICIAL_BENCHMARK_SOURCES,
  OFFICIAL_BENCHMARK_USERNAMES,
} from "@/lib/benchmark-sources";
import {
  EXPERT_SOURCE_KIND,
  ensureExpertSourceMetadata,
} from "@/lib/expert-identity";

type BenchmarkDb = {
  universalProfile: typeof prisma.universalProfile;
};

/**
 * Active Expert competitors for weekly coverage / import grids.
 * Individual analysts should be competitorActive; publisher shells should not.
 */
export async function listActiveBenchmarkSources(db: BenchmarkDb = prisma) {
  return db.universalProfile.findMany({
    where: {
      profileType: "BENCHMARK",
      competitorActive: true,
      status: "ACTIVE",
    },
    include: { expertSource: true },
    orderBy: { displayName: "asc" },
  });
}

export async function countActiveBenchmarkSources(db: BenchmarkDb = prisma) {
  return db.universalProfile.count({
    where: {
      profileType: "BENCHMARK",
      competitorActive: true,
      status: "ACTIVE",
    },
  });
}

export async function countOfficialPublisherShells(db: BenchmarkDb = prisma) {
  return db.universalProfile.count({
    where: {
      profileType: "BENCHMARK",
      username: { in: [...OFFICIAL_BENCHMARK_USERNAMES] },
    },
  });
}

/**
 * Idempotent upsert of official publisher affiliation shells.
 * These are NOT weekly Expert ballots when attributable analysts exist.
 * Historical rankings on these profiles are preserved; competitorActive=false
 * keeps them out of active coverage / consensus enrollment expectations.
 */
export async function ensureOfficialBenchmarkSources(db: BenchmarkDb = prisma) {
  for (const source of OFFICIAL_BENCHMARK_SOURCES) {
    const profile = await db.universalProfile.upsert({
      where: { username: source.username },
      update: {
        displayName: source.displayName,
        profileType: "BENCHMARK",
        status: "ACTIVE",
        // Publisher shells stay in the directory but are not active competitors.
        competitorActive: false,
        universalUserId: source.universalUserId,
      },
      create: {
        username: source.username,
        displayName: source.displayName,
        profileType: "BENCHMARK",
        status: "ACTIVE",
        competitorActive: false,
        universalUserId: source.universalUserId,
      },
    });
    await ensureExpertSourceMetadata({
      universalProfileId: profile.id,
      displayName: source.displayName,
      publicationName: source.displayName,
      sourceKind: EXPERT_SOURCE_KIND.PUBLISHER,
      active: true,
    });
  }

  const shellCount = await countOfficialPublisherShells(db);
  return {
    ok: shellCount === EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT,
    activeCount: shellCount,
    expected: EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT,
    publisherShells: shellCount,
  };
}
