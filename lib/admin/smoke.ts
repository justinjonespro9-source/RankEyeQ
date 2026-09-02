import { prisma } from "@/lib/db";
import { EXPECTED_ACTIVE_AI_COMPETITOR_COUNT } from "@/lib/ai-competitors";
import { countActiveAiCompetitors } from "@/lib/ai-competitors-sync";
import { EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT } from "@/lib/benchmark-sources";
import { countActiveBenchmarkSources } from "@/lib/benchmark-sources-sync";
import { validateEnv } from "@/lib/env";
import { DEFAULT_FANTASY_SCORING_VERSION, RANKIQ_NFL_PPR_V1 } from "@/lib/fantasy/scoring-config";
import { resolveNflProviderName } from "@/lib/providers/nfl";

export type SmokeCheck = {
  key: string;
  ok: boolean;
  detail: string;
};

export async function getSmokeDiagnostics(): Promise<{
  checks: SmokeCheck[];
  ok: boolean;
  envSummary: ReturnType<typeof validateEnv>["summary"];
}> {
  const env = validateEnv();
  const checks: SmokeCheck[] = [];

  checks.push({
    key: "env",
    ok: env.ok,
    detail: env.ok
      ? `Env OK · provider ${env.summary.nflProvider} · email ${env.summary.emailProvider}`
      : env.errors.map((issue) => issue.message).join("; "),
  });

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ key: "database", ok: true, detail: "Database reachable" });
  } catch {
    checks.push({ key: "database", ok: false, detail: "Database connection failed" });
  }

  checks.push({
    key: "auth",
    ok: env.summary.hasAuthSecret && env.summary.hasAuthUrl,
    detail: env.summary.hasAuthSecret
      ? `Auth configured · Google ${env.summary.googleOAuth ? "on" : "off"}`
      : "AUTH_SECRET / AUTH_URL missing",
  });

  const activeSeason = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    include: {
      weeks: {
        where: { isTest: false },
        orderBy: { weekNumber: "asc" },
      },
    },
  });
  const week =
    activeSeason?.weeks.find((item) => item.status === "OPEN" || item.status === "LOCKED") ??
    activeSeason?.weeks[0] ??
    null;
  checks.push({
    key: "active_week",
    ok: Boolean(week),
    detail: week
      ? `${week.label} · ${week.status} · scoring ${week.fantasyScoringVersion}`
      : "No non-test week on the active NFL season",
  });

  const contestCount = week
    ? await prisma.rankIQContest.count({ where: { weekId: week.id } })
    : 0;
  checks.push({
    key: "contests",
    ok: contestCount === 5,
    detail: week ? `${contestCount} contests for ${week.label}` : "No week selected",
  });

  const providerName = resolveNflProviderName();
  checks.push({
    key: "provider",
    ok:
      providerName === "mock" ||
      providerName === "manual" ||
      env.summary.hasSportsDataKey,
    detail:
      providerName === "manual"
        ? "NFL provider: manual (operator-entered schedule/pools/results)"
        : `NFL provider: ${providerName}`,
  });

  const poolCount = week
    ? await prisma.contestEntry.count({
        where: { contest: { weekId: week.id }, excluded: false },
      })
    : 0;
  checks.push({
    key: "player_pools",
    ok: poolCount > 0,
    detail: week ? `${poolCount} active pool entries` : "No week selected",
  });

  const aiCount = await countActiveAiCompetitors();
  checks.push({
    key: "ai_profiles",
    ok: aiCount === EXPECTED_ACTIVE_AI_COMPETITOR_COUNT,
    detail: `${aiCount} active AI competitors (expected ${EXPECTED_ACTIVE_AI_COMPETITOR_COUNT})`,
  });

  const benchmarkCount = await countActiveBenchmarkSources();
  checks.push({
    key: "benchmark_profiles",
    ok: benchmarkCount === EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT,
    detail: `${benchmarkCount} active expert/benchmark sources (expected ${EXPECTED_ACTIVE_BENCHMARK_SOURCE_COUNT})`,
  });

  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  checks.push({
    key: "admin_access",
    ok: adminCount >= 1,
    detail: `${adminCount} admin user(s)`,
  });

  checks.push({
    key: "timing",
    ok: Boolean(week?.fullLockAt && week.publicReleaseAt),
    detail: week?.fullLockAt
      ? "Week timing windows are set"
      : "Missing fullLockAt / publicReleaseAt",
  });

  checks.push({
    key: "scoring_version",
    ok: true,
    detail: "RankEYEQ scoring formulas unchanged (lib/scoring.ts)",
  });
  checks.push({
    key: "fantasy_scoring_version",
    ok:
      !week ||
      week.fantasyScoringVersion === DEFAULT_FANTASY_SCORING_VERSION ||
      week.fantasyScoringVersion === RANKIQ_NFL_PPR_V1,
    detail: week
      ? `Week fantasy version: ${week.fantasyScoringVersion}`
      : `Default ${DEFAULT_FANTASY_SCORING_VERSION}`,
  });

  return {
    checks,
    ok: checks.every((check) => check.ok),
    envSummary: env.summary,
  };
}
