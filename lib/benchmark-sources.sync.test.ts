import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT,
  OFFICIAL_BENCHMARK_SOURCES,
  OFFICIAL_BENCHMARK_USERNAMES,
} from "@/lib/benchmark-sources";
import {
  countActiveBenchmarkSources,
  countOfficialPublisherShells,
  ensureOfficialBenchmarkSources,
  listActiveBenchmarkSources,
} from "@/lib/benchmark-sources-sync";
import { prisma } from "@/lib/db";

describe("benchmark source sync + DB roster", () => {
  it("ensures 8 publisher shells that are not active Expert competitors", async () => {
    const result = await ensureOfficialBenchmarkSources();
    expect(result.ok).toBe(true);
    expect(result.publisherShells).toBe(EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT);
    expect(await countOfficialPublisherShells()).toBe(
      EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT,
    );

    const shells = await prisma.universalProfile.findMany({
      where: {
        profileType: "BENCHMARK",
        username: { in: [...OFFICIAL_BENCHMARK_USERNAMES] },
      },
      include: { expertSource: true },
    });
    expect(shells).toHaveLength(8);
    expect(shells.every((source) => source.profileType === "BENCHMARK")).toBe(true);
    expect(shells.every((source) => !source.competitorActive)).toBe(true);
    expect(
      shells.every((source) => source.expertSource?.sourceKind === "PUBLISHER"),
    ).toBe(true);
    expect(shells.map((source) => source.username).sort()).toEqual(
      [...OFFICIAL_BENCHMARK_USERNAMES].sort(),
    );
    expect(shells.map((source) => source.displayName).sort()).toEqual(
      OFFICIAL_BENCHMARK_SOURCES.map((source) => source.displayName).sort(),
    );

    const activeCompetitors = await listActiveBenchmarkSources();
    const officialStillActive = activeCompetitors.filter((source) =>
      OFFICIAL_BENCHMARK_USERNAMES.has(source.username),
    );
    expect(officialStillActive).toHaveLength(0);

    for (const source of shells) {
      const authUser = await prisma.user.findUnique({
        where: { universalProfileId: source.id },
      });
      expect(authUser).toBeNull();
    }

    // Active competitor count is analysts only (may be 0 before seeding).
    expect(await countActiveBenchmarkSources()).toBe(activeCompetitors.length);
  });
});
