import { prisma } from "@/lib/db";
import {
  buildAiPromptBundle,
  buildAiRankingPrompt,
  buildAllPositionPrompts,
  type AiPromptBundle,
  type AiPromptContest,
} from "@/lib/admin/ai-prompt";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

export async function loadAiPromptContest(
  contestId: string,
): Promise<AiPromptContest | null> {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      week: { include: { season: true } },
      entries: {
        where: { excluded: false },
        include: {
          game: true,
          rankableEntry: { include: { game: true } },
        },
        orderBy: { rankableEntry: { name: "asc" } },
      },
    },
  });
  if (!contest) return null;

  return {
    title: contest.title,
    seasonYear: contest.week.season.year,
    sport: contest.week.season.sport,
    weekLabel: contest.week.label,
    weekNumber: contest.week.weekNumber,
    position: contest.position,
    rankingDepth: contest.rankingDepth,
    rankingsOpenAt: contest.week.rankingsOpenAt,
    fullLockAt: contest.week.fullLockAt,
    players: contest.entries.map((entry) => ({
      name: entry.rankableEntry.name,
      team: entry.rankableEntry.team,
      opponent: entry.rankableEntry.opponent,
      gameStartsAt:
        entry.game?.startsAt ??
        entry.rankableEntry.game?.startsAt ??
        entry.rankableEntry.gameStartsAt,
    })),
  };
}

export async function loadWeekAiPrompts(
  weekId: string,
  botDisplayName?: string,
  generatedAt: Date = new Date(),
) {
  const contests = await prisma.rankIQContest.findMany({
    where: { weekId },
    select: { id: true, position: true },
  });
  const byPosition = new Map(contests.map((c) => [c.position, c.id]));
  const promptContests: AiPromptContest[] = [];
  for (const position of CONTEST_POSITIONS) {
    const id = byPosition.get(position);
    if (!id) continue;
    const contest = await loadAiPromptContest(id);
    if (contest) promptContests.push(contest);
  }

  const bundles: AiPromptBundle[] = promptContests.map((contest) =>
    buildAiPromptBundle(contest, { aiDisplayName: botDisplayName, generatedAt }),
  );

  return {
    contests: promptContests,
    combined: buildAllPositionPrompts(promptContests, botDisplayName),
    generatedAt,
    prompts: bundles.map((bundle) => ({
      position: bundle.meta.position,
      prompt: bundle.prompt,
      pool: promptContests.find((c) => c.position === bundle.meta.position)
        ?.players ?? [],
      poolText: bundle.poolText,
      meta: bundle.meta,
      version: bundle.version,
    })),
  };
}

export async function loadAiPromptBundleForContest(
  contestId: string,
  options?: { aiDisplayName?: string | null; generatedAt?: Date },
) {
  const contest = await loadAiPromptContest(contestId);
  if (!contest) return null;
  return buildAiPromptBundle(contest, options);
}

/** @deprecated Prefer buildAiPromptBundle — kept for call-site clarity. */
export { buildAiRankingPrompt };
