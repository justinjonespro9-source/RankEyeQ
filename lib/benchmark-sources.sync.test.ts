import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT,
  OFFICIAL_BENCHMARK_SOURCES,
  OFFICIAL_BENCHMARK_USERNAMES,
} from "@/lib/benchmark-sources";
import {
  countActiveBenchmarkSources,
  ensureOfficialBenchmarkSources,
  listActiveBenchmarkSources,
} from "@/lib/benchmark-sources-sync";
import { prisma } from "@/lib/db";

describe("benchmark source sync + DB roster", () => {
  it("ensures exactly 8 BENCHMARK sources that are not HUMAN or AI", async () => {
    const result = await ensureOfficialBenchmarkSources();
    expect(result.ok).toBe(true);
    expect(result.activeCount).toBe(EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT);

    const active = await listActiveBenchmarkSources();
    const officialActive = active.filter((source) =>
      OFFICIAL_BENCHMARK_USERNAMES.has(source.username),
    );
    expect(officialActive).toHaveLength(8);
    expect(officialActive.every((source) => source.profileType === "BENCHMARK")).toBe(
      true,
    );
    expect(officialActive.every((source) => source.profileType !== "HUMAN")).toBe(true);
    expect(officialActive.every((source) => source.profileType !== "AI")).toBe(true);
    expect(officialActive.map((source) => source.username).sort()).toEqual(
      [...OFFICIAL_BENCHMARK_USERNAMES].sort(),
    );
    expect(officialActive.map((source) => source.displayName).sort()).toEqual(
      OFFICIAL_BENCHMARK_SOURCES.map((source) => source.displayName).sort(),
    );
    expect(await countActiveBenchmarkSources()).toBe(8);

    for (const source of officialActive) {
      const authUser = await prisma.user.findUnique({
        where: { universalProfileId: source.id },
      });
      expect(authUser).toBeNull();
    }
  });
});
