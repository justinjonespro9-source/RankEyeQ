import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { canonicalDefenseExternalId } from "@/lib/nfl/defense-identity";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  parseWeeklySchedulePaste,
  type ScheduleParseResult,
} from "@/lib/nfl/manual/parse-schedule";
import { enrollSeasonPlayer } from "@/lib/season-players";
import { syncWeeklyEligibleFieldFromSeason } from "@/lib/nfl/weekly-eligibility";

export async function recordManualImport(input: {
  adminUserId: string;
  weekId?: string | null;
  importType: string;
  rowCount: number;
  createdCount?: number;
  updatedCount?: number;
  excludedCount?: number;
  warnings?: string[];
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.manualImportLog.create({
    data: {
      adminUserId: input.adminUserId,
      weekId: input.weekId ?? null,
      importType: input.importType,
      rowCount: input.rowCount,
      createdCount: input.createdCount ?? 0,
      updatedCount: input.updatedCount ?? 0,
      excludedCount: input.excludedCount ?? 0,
      warnings: input.warnings ?? [],
      metadata: input.metadata,
    },
  });
}

export async function previewManualSchedule(text: string): Promise<ScheduleParseResult> {
  return parseWeeklySchedulePaste(text);
}

export async function commitManualSchedule(input: {
  weekId: string;
  text: string;
  adminUserId: string;
}) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true },
  });
  const parsed = parseWeeklySchedulePaste(input.text);
  if (!parsed.ready) {
    throw new Error(`Schedule paste is not ready: ${parsed.blockers[0]}`);
  }

  let created = 0;
  let updated = 0;

  for (const row of parsed.rows) {
    const externalId = `manual-${week.season.year}-w${week.weekNumber}-${row.awayTeam}-${row.homeTeam}`;
    const existing = await prisma.nflGame.findUnique({
      where: {
        provider_externalId: { provider: "manual", externalId },
      },
    });
    if (!existing) {
      await prisma.nflGame.create({
        data: {
          provider: "manual",
          externalId,
          seasonId: week.seasonId,
          weekId: week.id,
          seasonYear: week.season.year,
          weekNumber: week.weekNumber,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          startsAt: row.kickoff!,
          status: "SCHEDULED",
        },
      });
      created += 1;
    } else {
      await prisma.nflGame.update({
        where: { id: existing.id },
        data: {
          seasonId: week.seasonId,
          weekId: week.id,
          seasonYear: week.season.year,
          weekNumber: week.weekNumber,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          startsAt: row.kickoff!,
        },
      });
      updated += 1;
    }
  }

  // Legacy manual DEF master rows — skip when nflcom canonical already exists.
  for (const row of parsed.rows) {
    for (const team of [row.awayTeam, row.homeTeam]) {
      const canonical = await prisma.rankableEntry.findFirst({
        where: {
          provider: NFL_COM_BOOTSTRAP_PROVIDER,
          externalId: canonicalDefenseExternalId(team),
          position: "DEF",
        },
      });
      if (canonical) continue;

      const externalId = `manual-def-${team}`;
      await prisma.rankableEntry.upsert({
        where: {
          provider_externalId: { provider: "manual", externalId },
        },
        update: {
          name: `${team} D/ST`,
          shortName: team,
          team,
          position: "DEF",
          type: "DEFENSE",
          active: true,
        },
        create: {
          provider: "manual",
          externalId,
          type: "DEFENSE",
          name: `${team} D/ST`,
          shortName: team,
          team,
          position: "DEF",
          opponent: "TBD",
          active: true,
        },
      });
    }
  }

  await recordManualImport({
    adminUserId: input.adminUserId,
    weekId: week.id,
    importType: "SCHEDULE",
    rowCount: parsed.rows.length,
    createdCount: created,
    updatedCount: updated,
  });

  return { created, updated, games: parsed.rows.length };
}

export async function buildDefensePoolFromSchedule(input: {
  weekId: string;
  adminUserId: string;
}) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true, games: true },
  });

  const scheduledTeams = new Set<string>();
  for (const game of week.games) {
    scheduledTeams.add(game.homeTeam);
    scheduledTeams.add(game.awayTeam);
  }

  for (const team of scheduledTeams) {
    const canonical = await prisma.rankableEntry.findFirst({
      where: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: canonicalDefenseExternalId(team),
        position: "DEF",
      },
    });
    const manual = await prisma.rankableEntry.findFirst({
      where: {
        provider: "manual",
        externalId: `manual-def-${team}`,
        position: "DEF",
      },
    });
    const defenseEntry = canonical ?? manual;
    if (!defenseEntry) continue;

    await enrollSeasonPlayer({
      seasonId: week.seasonId,
      rankableEntryId: defenseEntry.id,
      team,
    });
  }

  const result = await syncWeeklyEligibleFieldFromSeason({
    weekId: input.weekId,
    position: "DEF",
    scheduledTeamsOnly: true,
  });

  await recordManualImport({
    adminUserId: input.adminUserId,
    weekId: input.weekId,
    importType: "DEF_POOL_FROM_SCHEDULE",
    rowCount: result.candidates,
    createdCount: result.created,
    updatedCount: result.updated,
    excludedCount: result.pruned,
    metadata: { pruneReasons: result.pruneReasons },
  });

  return {
    created: result.created,
    updated: result.updated,
    pruned: result.pruned,
    contestId: result.contestId,
  };
}
