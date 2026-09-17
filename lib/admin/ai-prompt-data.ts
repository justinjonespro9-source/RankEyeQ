import { prisma } from "@/lib/db";
import {
  buildAiPromptBundle,
  buildAiRankingPrompt,
  buildAllPositionPrompts,
  type AiLockedSelection,
  type AiPromptBundle,
  type AiPromptContest,
  type AiPromptMode,
  type AiPromptPlayer,
} from "@/lib/admin/ai-prompt";
import { CONTEST_POSITIONS, submissionDepthFromScoring } from "@/lib/contest-defaults";
import { loadResolvedStatusesForWeek } from "@/lib/eligibility/player-week-availability-store";
import { kickoffHasPassed } from "@/lib/timing/partial-lock";
import { resolveWeekScopedKickoff } from "@/lib/timing/resolve-contest-kickoff";
import {
  WeekMatchupNotStampedError,
  assertWeekMatchupsStamped,
} from "@/lib/nfl/week-matchup-health";
import { formatOpponentLabel } from "@/lib/providers/nfl/eligibility";

function kickoffForEntry(
  weekId: string,
  entry: {
    game: {
      id: string;
      weekId: string | null;
      homeTeam: string;
      awayTeam: string;
      startsAt: Date;
    } | null;
  },
): Date | null {
  return resolveWeekScopedKickoff({
    weekId,
    contestGame: entry.game,
  });
}

export async function loadAiPromptContest(
  contestId: string,
  options?: {
    universalProfileId?: string | null;
    now?: Date;
  },
): Promise<AiPromptContest | null> {
  const now = options?.now ?? new Date();
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

  try {
    await assertWeekMatchupsStamped(contest.weekId);
  } catch (error) {
    if (error instanceof WeekMatchupNotStampedError) {
      throw error;
    }
    throw error;
  }

  const resolvedById = await loadResolvedStatusesForWeek({
    weekId: contest.weekId,
    seasonId: contest.week.seasonId,
    rankableEntryIds: contest.entries.map((e) => e.rankableEntryId),
  });

  const players: AiPromptPlayer[] = contest.entries.map((entry) => {
    const resolved = resolvedById.get(entry.rankableEntryId);
    const team = entry.weekTeam ?? entry.rankableEntry.team;
    const opponent =
      entry.game && entry.game.weekId === contest.weekId
        ? formatOpponentLabel(team, entry.game.homeTeam, entry.game.awayTeam)
        : "TBD";
    return {
      name: entry.rankableEntry.name,
      team,
      opponent,
      gameStartsAt: kickoffForEntry(contest.weekId, entry),
      availability:
        resolved?.effectiveEntryAvailability ??
        entry.rankableEntry.availability,
      designation: resolved?.designation,
      injuryDescription: resolved?.injuryDescription,
      unavailableReason: resolved?.selectable
        ? null
        : resolved?.unavailableReason,
      rankableEntryId: entry.rankableEntryId,
    };
  });

  let lockedSelections: AiLockedSelection[] = [];
  if (options?.universalProfileId) {
    const submission = await prisma.rankingSubmission.findUnique({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: options.universalProfileId,
        },
      },
      include: {
        picks: {
          include: { rankableEntry: true },
          orderBy: { predictedRank: "asc" },
        },
      },
    });
    if (submission) {
      const kickoffById = new Map(
        players.map((player) => [
          player.rankableEntryId ?? "",
          player.gameStartsAt,
        ]),
      );
      lockedSelections = submission.picks
        .filter((pick) => {
          if (pick.slotLocked) return true;
          const kickoff = kickoffById.get(pick.rankableEntryId) ?? null;
          return kickoffHasPassed(kickoff, now);
        })
        .map((pick) => ({
          rank: pick.lockedRank ?? pick.predictedRank,
          name: pick.rankableEntry.name,
          team: pick.rankableEntry.team,
          rankableEntryId: pick.rankableEntryId,
        }));
    }
  }

  return {
    title: contest.title,
    seasonYear: contest.week.season.year,
    sport: contest.week.season.sport,
    weekLabel: contest.week.label,
    weekNumber: contest.week.weekNumber,
    position: contest.position,
    rankingDepth: contest.rankingDepth,
    submissionDepth: submissionDepthFromScoring(contest.rankingDepth),
    rankingsOpenAt: contest.week.rankingsOpenAt,
    fullLockAt: contest.week.fullLockAt,
    players,
    lockedSelections,
  };
}

export async function loadWeekAiPrompts(
  weekId: string,
  botDisplayName?: string,
  generatedAt: Date = new Date(),
  options?: { universalProfileId?: string | null },
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
    const contest = await loadAiPromptContest(id, {
      universalProfileId: options?.universalProfileId,
      now: generatedAt,
    });
    if (contest) promptContests.push(contest);
  }

  const bundles: AiPromptBundle[] = promptContests.map((contest) =>
    buildAiPromptBundle(contest, {
      aiDisplayName: botDisplayName,
      generatedAt,
      now: generatedAt,
    }),
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
      mode: bundle.meta.mode as AiPromptMode,
    })),
  };
}

export async function loadAiPromptBundleForContest(
  contestId: string,
  options?: {
    aiDisplayName?: string | null;
    generatedAt?: Date;
    universalProfileId?: string | null;
    mode?: AiPromptMode;
  },
) {
  const generatedAt = options?.generatedAt ?? new Date();
  const contest = await loadAiPromptContest(contestId, {
    universalProfileId: options?.universalProfileId,
    now: generatedAt,
  });
  if (!contest) return null;
  return buildAiPromptBundle(contest, {
    aiDisplayName: options?.aiDisplayName,
    generatedAt,
    now: generatedAt,
    mode: options?.mode,
  });
}

/** @deprecated Prefer buildAiPromptBundle — kept for call-site clarity. */
export { buildAiRankingPrompt };
