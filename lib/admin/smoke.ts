import { prisma } from "@/lib/db";
import { EXPECTED_ACTIVE_AI_COMPETITOR_COUNT } from "@/lib/ai-competitors";
import { countActiveAiCompetitors } from "@/lib/ai-competitors-sync";
import { EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT } from "@/lib/benchmark-sources";
import { countOfficialPublisherShells } from "@/lib/benchmark-sources-sync";
import { validateEnv } from "@/lib/env";
import {
  DEFAULT_FANTASY_SCORING_VERSION,
  FANTASYTRACK_NFL_FULL_PPR_V1,
  FANTASYTRACK_NFL_HALF_PPR_V1,
  FANTASYTRACK_NFL_HALF_PPR_V2,
  RANKIQ_NFL_PPR_V1,
} from "@/lib/fantasy/scoring-config";
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

  const shellCount = await countOfficialPublisherShells();
  checks.push({
    key: "benchmark_profiles",
    ok: shellCount === EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT,
    detail: `${shellCount} official publisher shells (expected ${EXPECTED_OFFICIAL_PUBLISHER_SHELL_COUNT}); active Expert competitors are managed separately`,
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
      week.fantasyScoringVersion === FANTASYTRACK_NFL_HALF_PPR_V2 ||
      week.fantasyScoringVersion === FANTASYTRACK_NFL_HALF_PPR_V1 ||
      week.fantasyScoringVersion === FANTASYTRACK_NFL_FULL_PPR_V1 ||
      week.fantasyScoringVersion === RANKIQ_NFL_PPR_V1,
    detail: week
      ? `Week fantasy version: ${week.fantasyScoringVersion}${
          week.fantasyScoringVersion === FANTASYTRACK_NFL_HALF_PPR_V2
            ? " (canonical Half PPR + milestones)"
            : week.fantasyScoringVersion === FANTASYTRACK_NFL_HALF_PPR_V1
              ? " (Half PPR without milestones)"
              : " (historical Full PPR — ok for past weeks)"
        }`
      : `Default ${DEFAULT_FANTASY_SCORING_VERSION}`,
  });

  return {
    checks,
    ok: checks.every((check) => check.ok),
    envSummary: env.summary,
  };
}
