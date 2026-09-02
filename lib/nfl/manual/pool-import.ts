import { prisma } from "@/lib/db";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { formatOpponentLabel } from "@/lib/providers/nfl/eligibility";
import {
  parseWeeklyPoolPaste,
  shortNameFromFull,
  type ParsedPoolRow,
  type PoolMasterCandidate,
} from "@/lib/nfl/manual/parse-pool";
import {
  slugifyExternalId,
} from "@/lib/nfl/manual/parse-common";
import { recordManualImport } from "@/lib/nfl/manual/schedule-import";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export async function listMasterCandidates(input?: {
  position?: ContestPosition;
}): Promise<PoolMasterCandidate[]> {
  const rows = await prisma.rankableEntry.findMany({
    where: {
      ...(input?.position ? { position: input.position } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      team: true,
      position: true,
      shortName: true,
      active: true,
    },
  });
  return rows;
}

export async function previewManualPoolPaste(input: {
  text: string;
  fixedPosition?: ContestPosition;
}) {
  const masters = await listMasterCandidates({
    position: input.fixedPosition,
  });
  // Also load all positions for mismatch detection when fixed
  const allMasters =
    input.fixedPosition != null
      ? await listMasterCandidates()
      : masters;
  return parseWeeklyPoolPaste({
    text: input.text,
    masters: input.fixedPosition ? allMasters : masters,
    fixedPosition: input.fixedPosition,
  });
}

async function ensureContest(weekId: string, position: ContestPosition) {
  const week = await prisma.week.findUniqueOrThrow({ where: { id: weekId } });
  return prisma.rankIQContest.upsert({
    where: { weekId_position: { weekId, position } },
    update: {},
    create: {
      seasonId: week.seasonId,
      weekId,
      position,
      title: `Week ${week.weekNumber} ${position} Top ${rankingDepthForPosition(position)}`,
      rankingDepth: rankingDepthForPosition(position),
      status: "DRAFT",
    },
  });
}

async function resolveOrCreateMaster(row: ParsedPoolRow, allowCreate: boolean) {
  if (row.matchedEntryId) {
    return prisma.rankableEntry.findUniqueOrThrow({
      where: { id: row.matchedEntryId },
    });
  }
  if (!allowCreate || !row.createNew || !row.position) {
    throw new Error(`Cannot commit unmatched row: ${row.name}`);
  }
  const externalId = slugifyExternalId(row.name, row.team, row.position);
  return prisma.rankableEntry.upsert({
    where: {
      provider_externalId: { provider: "manual", externalId },
    },
    update: {
      name: row.name,
      shortName: shortNameFromFull(row.name),
      team: row.team,
      position: row.position,
      type: row.position === "DEF" ? "DEFENSE" : "PLAYER",
      active: true,
    },
    create: {
      provider: "manual",
      externalId,
      type: row.position === "DEF" ? "DEFENSE" : "PLAYER",
      name: row.name,
      shortName: shortNameFromFull(row.name),
      team: row.team,
      position: row.position,
      opponent: "TBD",
      active: true,
    },
  });
}

export async function commitManualPoolPaste(input: {
  weekId: string;
  text: string;
  adminUserId: string;
  fixedPosition?: ContestPosition;
  /** Confirmed create-new rows (admin accepted preview). */
  confirmCreates?: boolean;
  confirmedExclusions?: never;
}) {
  const preview = await previewManualPoolPaste({
    text: input.text,
    fixedPosition: input.fixedPosition,
  });
  const blockers = preview.blockers;
  if (blockers.length > 0) {
    throw new Error(`Pool paste is not ready: ${blockers[0]}`);
  }
  if (preview.createCount > 0 && !input.confirmCreates) {
    throw new Error(
      `${preview.createCount} new master player(s) require confirmation before commit`,
    );
  }

  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { games: true },
  });
  const gameByTeam = new Map<string, (typeof week.games)[number]>();
  for (const game of week.games) {
    gameByTeam.set(game.homeTeam, game);
    gameByTeam.set(game.awayTeam, game);
  }

  let created = 0;
  let updated = 0;
  let masterCreated = 0;

  for (const row of preview.rows) {
    if (!row.position) continue;
    const before = row.matchedEntryId;
    const master = await resolveOrCreateMaster(row, Boolean(input.confirmCreates));
    if (!before) masterCreated += 1;

    const scheduleGame = gameByTeam.get(row.team);
    const kickoff = row.kickoff ?? scheduleGame?.startsAt ?? null;
    const opponentLabel = scheduleGame
      ? formatOpponentLabel(row.team, scheduleGame.homeTeam, scheduleGame.awayTeam)
      : row.opponent
        ? row.opponent.startsWith("@") || row.opponent.startsWith("vs")
          ? row.opponent
          : `@ ${row.opponent}`
        : "TBD";

    await prisma.rankableEntry.update({
      where: { id: master.id },
      data: {
        team: row.team,
        opponent: opponentLabel,
        gameStartsAt: kickoff,
        gameId: scheduleGame?.id ?? null,
        active: true,
      },
    });

    const contest = await ensureContest(week.id, row.position);
    const existing = await prisma.contestEntry.findUnique({
      where: {
        contestId_rankableEntryId: {
          contestId: contest.id,
          rankableEntryId: master.id,
        },
      },
    });
    if (existing?.excluded) {
      // Preserve manual exclusions — do not re-add.
      continue;
    }
    if (!existing) {
      await prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          rankableEntryId: master.id,
          gameId: scheduleGame?.id ?? null,
          excluded: false,
          manuallyAdded: true,
        },
      });
      created += 1;
    } else {
      await prisma.contestEntry.update({
        where: { id: existing.id },
        data: { gameId: scheduleGame?.id ?? existing.gameId },
      });
      updated += 1;
    }
  }

  await recordManualImport({
    adminUserId: input.adminUserId,
    weekId: week.id,
    importType: input.fixedPosition
      ? `POSITION_POOL_${input.fixedPosition}`
      : "POOL",
    rowCount: preview.rows.length,
    createdCount: created + masterCreated,
    updatedCount: updated,
    metadata: {
      masterCreated,
      confirmCreates: Boolean(input.confirmCreates),
      fixedPosition: input.fixedPosition ?? null,
    },
  });

  return {
    created,
    updated,
    masterCreated,
    rowCount: preview.rows.length,
  };
}

/**
 * Copy previous week's contest pools into the target week.
 * Preserves excluded / manuallyAdded. Does NOT carry opponent or kickoff.
 */
export async function copyPreviousWeekPools(input: {
  targetWeekId: string;
  sourceWeekId?: string;
  adminUserId: string;
}) {
  const target = await prisma.week.findUniqueOrThrow({
    where: { id: input.targetWeekId },
    include: {
      season: true,
      games: true,
    },
  });

  const source =
    input.sourceWeekId
      ? await prisma.week.findUniqueOrThrow({
          where: { id: input.sourceWeekId },
          include: {
            contests: {
              include: {
                entries: { include: { rankableEntry: true } },
              },
            },
          },
        })
      : await prisma.week.findFirst({
          where: {
            seasonId: target.seasonId,
            weekNumber: { lt: target.weekNumber },
          },
          orderBy: { weekNumber: "desc" },
          include: {
            contests: {
              include: {
                entries: { include: { rankableEntry: true } },
              },
            },
          },
        });

  if (!source) {
    throw new Error("No previous week found to copy pools from");
  }

  const gameByTeam = new Map<string, (typeof target.games)[number]>();
  for (const game of target.games) {
    gameByTeam.set(game.homeTeam, game);
    gameByTeam.set(game.awayTeam, game);
  }

  let retained = 0;
  let added = 0;
  let exclusionsPreserved = 0;
  const teamChanges: string[] = [];
  const missingGame: string[] = [];
  const missingKickoff: string[] = [];

  for (const sourceContest of source.contests) {
    const contest = await ensureContest(target.id, sourceContest.position);
    for (const sourceEntry of sourceContest.entries) {
      const entry = sourceEntry.rankableEntry;
      const game = gameByTeam.get(entry.team);

      // Clear stale week display fields; only apply this week's schedule.
      await prisma.rankableEntry.update({
        where: { id: entry.id },
        data: {
          opponent: game
            ? formatOpponentLabel(entry.team, game.homeTeam, game.awayTeam)
            : "TBD",
          gameStartsAt: game?.startsAt ?? null,
          gameId: game?.id ?? null,
        },
      });

      if (!game) {
        missingGame.push(`${entry.name} (${entry.team})`);
      } else if (!game.startsAt) {
        missingKickoff.push(entry.name);
      }

      const existing = await prisma.contestEntry.findUnique({
        where: {
          contestId_rankableEntryId: {
            contestId: contest.id,
            rankableEntryId: entry.id,
          },
        },
      });

      if (existing) {
        await prisma.contestEntry.update({
          where: { id: existing.id },
          data: {
            excluded: sourceEntry.excluded,
            manuallyAdded: sourceEntry.manuallyAdded,
            gameId: game?.id ?? null,
            // Never copy fantasy points / ranks from prior week
            fantasyPoints: null,
            actualRank: null,
          },
        });
        retained += 1;
        if (sourceEntry.excluded) exclusionsPreserved += 1;
      } else {
        await prisma.contestEntry.create({
          data: {
            contestId: contest.id,
            rankableEntryId: entry.id,
            gameId: game?.id ?? null,
            excluded: sourceEntry.excluded,
            manuallyAdded: sourceEntry.manuallyAdded,
          },
        });
        added += 1;
        if (sourceEntry.excluded) exclusionsPreserved += 1;
      }
    }
  }

  await recordManualImport({
    adminUserId: input.adminUserId,
    weekId: target.id,
    importType: "COPY_PREVIOUS_POOLS",
    rowCount: retained + added,
    createdCount: added,
    updatedCount: retained,
    excludedCount: exclusionsPreserved,
    metadata: {
      sourceWeekId: source.id,
      sourceWeekNumber: source.weekNumber,
      missingGame,
      missingKickoff,
      teamChanges,
    },
    warnings: [
      ...missingGame.slice(0, 20).map((name) => `No game for ${name}`),
      ...missingKickoff.slice(0, 20).map((name) => `Missing kickoff for ${name}`),
    ],
  });

  return {
    sourceWeekId: source.id,
    sourceWeekNumber: source.weekNumber,
    retained,
    added,
    exclusionsPreserved,
    missingGame,
    missingKickoff,
  };
}
