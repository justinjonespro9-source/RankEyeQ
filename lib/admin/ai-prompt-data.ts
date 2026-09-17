import { prisma } from "@/lib/db";
import {
  buildAiPromptBundle,
  buildAiRankingPrompt,
  buildAllPositionPrompts,
  type AiPromptBundle,
  type AiPromptContest,
  type AiPromptMode,
  type AiPromptPlayer,
} from "@/lib/admin/ai-prompt";
import { CONTEST_POSITIONS, submissionDepthFromScoring } from "@/lib/contest-defaults";
import { loadResolvedStatusesForWeek } from "@/lib/eligibility/player-week-availability-store";
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

/**
 * Load contest pool for the universal AI prompt.
 * Does not include profile-specific locked selections — those apply at import only.
 */
export async function loadAiPromptContest(
  contestId: string,
  options?: {
    now?: Date;
  },
): Promise<AiPromptContest | null> {
  // `now` is accepted for call-site symmetry with import/lock loaders; pool
  // partitioning applies `now` later in buildAiPromptBundle.
  void options?.now;
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
    lockedSelections: [],
  };
}

/** Load profile-immutable locked picks for import merge (not for prompt text). */
export async function loadProfileImmutableLocks(
  contestId: string,
  universalProfileId: string,
  now: Date = new Date(),
): Promise<Array<{ rank: number; rankableEntryId: string; name: string; team: string }>> {
  const contest = await loadAiPromptContest(contestId, { now });
  if (!contest) return [];

  const submission = await prisma.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId,
        universalProfileId,
      },
    },
    include: {
      picks: {
        include: { rankableEntry: true },
        orderBy: { predictedRank: "asc" },
      },
    },
  });
  if (!submission) return [];

  const kickoffById = new Map(
    contest.players.map((player) => [
      player.rankableEntryId ?? "",
      player.gameStartsAt,
    ]),
  );

  return submission.picks
    .filter((pick) => {
      if (pick.slotLocked) return true;
      const kickoff = kickoffById.get(pick.rankableEntryId) ?? null;
      return kickoff != null && now >= kickoff;
    })
    .map((pick) => ({
      rank: pick.lockedRank ?? pick.predictedRank,
      rankableEntryId: pick.rankableEntryId,
      name: pick.rankableEntry.name,
      team: pick.rankableEntry.team,
    }));
}

export async function loadWeekAiPrompts(
  weekId: string,
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
    const contest = await loadAiPromptContest(id, {
      now: generatedAt,
    });
    if (contest) promptContests.push(contest);
  }

  const bundles: AiPromptBundle[] = promptContests.map((contest) =>
    buildAiPromptBundle(contest, {
      generatedAt,
      now: generatedAt,
    }),
  );

  return {
    contests: promptContests,
    combined: buildAllPositionPrompts(promptContests),
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
    generatedAt?: Date;
  },
) {
  const generatedAt = options?.generatedAt ?? new Date();
  const contest = await loadAiPromptContest(contestId, {
    now: generatedAt,
  });
  if (!contest) return null;
  return buildAiPromptBundle(contest, {
    generatedAt,
    now: generatedAt,
  });
}

/** @deprecated Prefer buildAiPromptBundle — kept for call-site clarity. */
export { buildAiRankingPrompt };
