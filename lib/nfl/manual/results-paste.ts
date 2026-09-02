import { prisma } from "@/lib/db";
import { calculateActualFinishesForContest } from "@/lib/nfl/actual-finishes";
import {
  parseFantasyPointsPaste,
  type FantasyPointCandidate,
} from "@/lib/nfl/manual/parse-fantasy-points";
import { recordManualImport } from "@/lib/nfl/manual/schedule-import";
import { DEFAULT_FANTASY_SCORING_VERSION } from "@/lib/fantasy/scoring-config";
import type { ContestPosition } from "@/lib/generated/prisma/client";

async function loadEligibleCandidates(
  weekId: string,
  position?: ContestPosition,
): Promise<FantasyPointCandidate[]> {
  const contests = await prisma.rankIQContest.findMany({
    where: {
      weekId,
      ...(position ? { position } : {}),
    },
    include: {
      entries: {
        where: { excluded: false },
        include: { rankableEntry: true },
      },
    },
  });

  return contests.flatMap((contest) =>
    contest.entries.map((entry) => ({
      id: entry.id,
      rankableEntryId: entry.rankableEntryId,
      name: entry.rankableEntry.name,
      team: entry.rankableEntry.team,
      position: contest.position,
      shortName: entry.rankableEntry.shortName,
    })),
  );
}

export async function previewFantasyPointsPaste(input: {
  weekId: string;
  text: string;
  position?: ContestPosition;
}) {
  const eligible = await loadEligibleCandidates(input.weekId, input.position);
  return parseFantasyPointsPaste({
    text: input.text,
    eligible,
    fixedPosition: input.position,
  });
}

export async function commitFantasyPointsPaste(input: {
  weekId: string;
  text: string;
  adminUserId: string;
  position?: ContestPosition;
  provisional?: boolean;
}) {
  const preview = await previewFantasyPointsPaste(input);
  if (!preview.ready) {
    throw new Error(`Fantasy points paste is not ready: ${preview.blockers[0]}`);
  }

  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true },
  });
  const provisional = Boolean(input.provisional);
  let updated = 0;
  const touchedContests = new Set<string>();

  for (const row of preview.rows) {
    if (!row.matchedContestEntryId || row.fantasyPoints == null) continue;
    const entry = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: row.matchedContestEntryId },
      include: { contest: true, rankableEntry: true, game: true },
    });

    // Never overwrite final official scores with provisional updates.
    if (provisional) {
      if (entry.actualRank != null) continue;
      const existingFinal = await prisma.playerWeekStat.findFirst({
        where: {
          weekId: week.id,
          rankableEntryId: entry.rankableEntryId,
          isProvisional: false,
          provider: "manual",
        },
      });
      const existingDefFinal = await prisma.defenseWeekStat.findFirst({
        where: {
          weekId: week.id,
          rankableEntryId: entry.rankableEntryId,
          isProvisional: false,
          provider: "manual",
        },
      });
      if (existingFinal || existingDefFinal) {
        continue;
      }
      if (entry.contest.status === "FINAL" || entry.contest.status === "ARCHIVED") {
        continue;
      }
    }

    await prisma.contestEntry.update({
      where: { id: entry.id },
      data: {
        fantasyPoints: row.fantasyPoints,
        actualRank: provisional ? entry.actualRank : null,
      },
    });
    updated += 1;
    touchedContests.add(entry.contestId);

    if (entry.contest.position === "DEF") {
      await prisma.defenseWeekStat.upsert({
        where: {
          provider_weekId_team: {
            provider: "manual",
            weekId: week.id,
            team: entry.rankableEntry.team,
          },
        },
        update: {
          rankableEntryId: entry.rankableEntryId,
          gameId: entry.gameId,
          externalId: entry.rankableEntry.externalId,
          fantasyPoints: row.fantasyPoints,
          isProvisional: provisional,
          scoringVersion: week.fantasyScoringVersion || week.season.fantasyScoringVersion || DEFAULT_FANTASY_SCORING_VERSION,
        },
        create: {
          provider: "manual",
          weekId: week.id,
          rankableEntryId: entry.rankableEntryId,
          gameId: entry.gameId,
          team: entry.rankableEntry.team,
          externalId: entry.rankableEntry.externalId,
          scoringVersion: week.fantasyScoringVersion || week.season.fantasyScoringVersion || DEFAULT_FANTASY_SCORING_VERSION,
          fantasyPoints: row.fantasyPoints,
          isProvisional: provisional,
        },
      });
    } else {
      await prisma.playerWeekStat.upsert({
        where: {
          provider_weekId_externalPlayerId: {
            provider: "manual",
            weekId: week.id,
            externalPlayerId: entry.rankableEntry.externalId,
          },
        },
        update: {
          rankableEntryId: entry.rankableEntryId,
          gameId: entry.gameId,
          fantasyPoints: row.fantasyPoints,
          isProvisional: provisional,
          scoringVersion: week.fantasyScoringVersion || week.season.fantasyScoringVersion || DEFAULT_FANTASY_SCORING_VERSION,
        },
        create: {
          provider: "manual",
          weekId: week.id,
          rankableEntryId: entry.rankableEntryId,
          gameId: entry.gameId,
          externalPlayerId: entry.rankableEntry.externalId,
          scoringVersion: week.fantasyScoringVersion || week.season.fantasyScoringVersion || DEFAULT_FANTASY_SCORING_VERSION,
          fantasyPoints: row.fantasyPoints,
          isProvisional: provisional,
        },
      });
    }

    if (!provisional && entry.gameId) {
      await prisma.nflGame.update({
        where: { id: entry.gameId },
        data: { status: "FINAL" },
      });
    } else if (provisional && entry.gameId) {
      await prisma.nflGame.update({
        where: { id: entry.gameId },
        data: { status: "IN_PROGRESS" },
      });
    }
  }

  if (!provisional) {
    for (const contestId of touchedContests) {
      await calculateActualFinishesForContest(contestId);
    }
  }

  await recordManualImport({
    adminUserId: input.adminUserId,
    weekId: week.id,
    importType: provisional ? "PROVISIONAL_FANTASY_POINTS" : "FANTASY_POINTS",
    rowCount: preview.rows.length,
    updatedCount: updated,
    metadata: {
      position: input.position ?? "ALL",
      zeroCount: preview.zeroCount,
      provisional,
    },
  });

  return {
    updated,
    zeroCount: preview.zeroCount,
    contestsTouched: touchedContests.size,
    provisional,
  };
}
