/**
 * Official RankEYEQ expert/benchmark publishing sources (V1).
 * These are not HUMAN or AI users. Seed/upsert and admin coverage use this list.
 */

export type OfficialBenchmarkSource = {
  username: string;
  displayName: string;
  universalUserId: string;
};

export const OFFICIAL_BENCHMARK_SOURCES: readonly OfficialBenchmarkSource[] = [
  {
    username: "espn-fantasy",
    displayName: "ESPN Fantasy",
    universalUserId: "uu_benchmark_espn_fantasy",
  },
  {
    username: "yahoo-fantasy",
    displayName: "Yahoo Fantasy",
    universalUserId: "uu_benchmark_yahoo_fantasy",
  },
  {
    username: "fantasypros-ecr",
    displayName: "FantasyPros ECR",
    universalUserId: "uu_benchmark_fantasypros_ecr",
  },
  {
    username: "fantasy-life",
    displayName: "Fantasy Life",
    universalUserId: "uu_benchmark_fantasy_life",
  },
  {
    username: "pff",
    displayName: "PFF",
    universalUserId: "uu_benchmark_pff",
  },
  {
    username: "cbs-fantasy",
    displayName: "CBS Sports Fantasy",
    universalUserId: "uu_benchmark_cbs_fantasy",
  },
  {
    username: "rotowire",
    displayName: "RotoWire",
    universalUserId: "uu_benchmark_rotowire",
  },
  {
    username: "establish-the-run",
    displayName: "Establish The Run",
    universalUserId: "uu_benchmark_establish_the_run",
  },
] as const;

export const EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT =
  OFFICIAL_BENCHMARK_SOURCES.length;

/** @deprecated Prefer EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT — shells are not active competitors. */
export const EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT =
  EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT;

export const OFFICIAL_BENCHMARK_USERNAMES = new Set(
  OFFICIAL_BENCHMARK_SOURCES.map((source) => source.username),
);

export function isOfficialBenchmarkUsername(username: string) {
  return OFFICIAL_BENCHMARK_USERNAMES.has(username.trim().toLowerCase());
}

export function benchmarkAffiliationDisclaimer(sourceName: string) {
  return `Independent RankEyeQ Expert. Rankings are entered from publicly available or otherwise authorized source rankings and scored independently by RankEyeQ. This profile is not operated by or affiliated with ${sourceName}.`;
}

export const LATE_CAPTURE_WARNING =
  "Captured after official RankEYEQ lock — not eligible for official benchmark scoring.";
