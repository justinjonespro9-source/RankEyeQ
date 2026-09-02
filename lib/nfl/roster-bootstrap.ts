import { rankableEntryMatchesImportName } from "@/lib/nfl/player-aliases";
import {
  resolvePlayerMatchFromCandidates,
  type PlayerMatchInput,
} from "@/lib/nfl/player-identity";
import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { NFL_TEAMS } from "@/lib/nfl-schedule";
import { mapNflComStatusToSeasonFields } from "@/lib/nfl/roster-status";
import { autoSyncWeeklyEligibilityForSeason } from "@/lib/nfl/weekly-auto-sync";
import {
  fetchNormalizedNflComRosters,
  NFL_COM_BOOTSTRAP_PROVIDER,
  type NormalizedRosterBundle,
  type NormalizedRosterPlayer,
} from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  NFL_COM_ROSTER_SOURCE_LABEL,
  teamNameForAbbreviation,
} from "@/lib/providers/nfl/nflcom/teams";
import { enrollSeasonPlayer } from "@/lib/season-players";

export type RosterBootstrapAmbiguous = {
  name: string;
  team: string;
  position: ContestPosition;
  externalId: string;
  candidateIds: string[];
  candidateNames: string[];
};

export type RosterBootstrapReport = {
  source: string;
  syncedAt: string;
  seasonId: string;
  seasonYear: number;
  teams: { imported: number; expected: 32; missing: string[] };
  counts: {
    QB: number;
    RB_FB: number;
    WR: number;
    TE: number;
    DEF: number;
  };
  activeOnRoster: number;
  inactiveOnRoster: number;
  matchedExisting: number;
  newlyCreated: number;
  updated: number;
  unchanged: number;
  skipped: number;
  fbMapped: number;
  ambiguous: RosterBootstrapAmbiguous[];
  duplicates: Array<{ externalId: string; name: string; team: string }>;
  errors: Array<{ team?: string; name?: string; message: string }>;
  minnesota?: {
    activeQb: string[];
    activeRb: string[];
    activeWr: string[];
    activeTe: string[];
    fbMappedPlayers: string[];
  };
  weeklySync?: {
    weeksSynced: number;
    week1Eligible?: Partial<Record<ContestPosition, number>>;
  };
};

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function countByFantasyPosition(players: NormalizedRosterPlayer[]) {
  const counts = { QB: 0, RB_FB: 0, WR: 0, TE: 0 };
  for (const player of players) {
    if (player.fantasyPosition === "QB") counts.QB += 1;
    else if (player.fantasyPosition === "RB") counts.RB_FB += 1;
    else if (player.fantasyPosition === "WR") counts.WR += 1;
    else if (player.fantasyPosition === "TE") counts.TE += 1;
  }
  return counts;
}

async function findMatchingRankableEntry(player: NormalizedRosterPlayer) {
  const byExternal = await prisma.rankableEntry.findUnique({
    where: {
      provider_externalId: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: player.externalId,
      },
    },
  });
  if (byExternal) {
    return { kind: "matched" as const, entry: byExternal, strategy: "externalId" };
  }

  const bySharedExternal = await prisma.rankableEntry.findFirst({
    where: {
      type: "PLAYER",
      externalId: player.externalId,
      position: player.fantasyPosition,
    },
  });
  if (bySharedExternal) {
    return {
      kind: "matched" as const,
      entry: bySharedExternal,
      strategy: "sharedExternalId",
    };
  }

  const candidates = await prisma.rankableEntry.findMany({
    where: {
      type: "PLAYER",
      position: player.fantasyPosition,
    },
  });

  const matchInput: PlayerMatchInput = {
    externalId: player.externalId,
    name: player.name,
    team: player.team,
    fantasyPosition: player.fantasyPosition,
  };

  const nameCandidates = candidates.filter((entry) =>
    rankableEntryMatchesImportName(entry, player.name),
  );
  const resolution = resolvePlayerMatchFromCandidates(nameCandidates, matchInput);
  if (resolution.kind === "matched") {
    return resolution;
  }
  if (resolution.kind === "ambiguous") {
    return resolution;
  }
  return { kind: "create" as const };
}

async function upsertDefenseEntries(seasonId: string) {
  let created = 0;
  let updated = 0;

  for (const team of NFL_TEAMS) {
    const externalId = `def-${team.abbr}`;
    const name = `${team.name} D/ST`;
    const existingRows = await prisma.rankableEntry.findMany({
      where: {
        position: "DEF",
        team: team.abbr,
        type: "DEFENSE",
      },
      orderBy: { createdAt: "asc" },
    });

    const preferred =
      existingRows.find(
        (row) =>
          row.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
          row.externalId === externalId,
      ) ??
      existingRows.find((row) => row.externalId === externalId) ??
      existingRows[0];

    let entryId: string;
    if (preferred) {
      await prisma.rankableEntry.update({
        where: { id: preferred.id },
        data: {
          provider: NFL_COM_BOOTSTRAP_PROVIDER,
          externalId,
          name,
          shortName: team.abbr,
          team: team.abbr,
          active: true,
          adminNotes: preferred.adminNotes ?? NFL_COM_ROSTER_SOURCE_LABEL,
        },
      });
      entryId = preferred.id;
      updated += 1;

      for (const duplicate of existingRows) {
        if (duplicate.id === preferred.id) continue;
        await prisma.rankableEntry.update({
          where: { id: duplicate.id },
          data: {
            active: false,
            adminNotes: `Superseded by ${NFL_COM_BOOTSTRAP_PROVIDER}:${externalId}`,
          },
        });
      }
    } else {
      const createdEntry = await prisma.rankableEntry.create({
        data: {
          provider: NFL_COM_BOOTSTRAP_PROVIDER,
          externalId,
          type: "DEFENSE",
          name,
          shortName: team.abbr,
          team: team.abbr,
          position: "DEF",
          opponent: "TBD",
          active: true,
          adminNotes: NFL_COM_ROSTER_SOURCE_LABEL,
        },
      });
      entryId = createdEntry.id;
      created += 1;
    }

    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: entryId,
      team: team.abbr,
      nflStatus: "ACTIVE",
      activeOnNFLRoster: true,
      sourcePosition: "DEF",
      sourceNflStatus: "ACT",
    });
  }

  return { created, updated, total: NFL_TEAMS.length };
}

async function syncPlayerRecord(input: {
  seasonId: string;
  player: NormalizedRosterPlayer;
  rankableEntryId: string;
  isNewEntry: boolean;
}) {
  const mapped = mapNflComStatusToSeasonFields(input.player.sourceStatus);
  const existingSeason = await prisma.seasonPlayer.findUnique({
    where: {
      seasonId_rankableEntryId: {
        seasonId: input.seasonId,
        rankableEntryId: input.rankableEntryId,
      },
    },
  });

  await enrollSeasonPlayer({
    seasonId: input.seasonId,
    rankableEntryId: input.rankableEntryId,
    team: input.player.team,
    nflStatus: mapped.nflStatus,
    activeOnNFLRoster: mapped.activeOnNFLRoster,
    sourcePosition: input.player.sourcePosition,
    sourceNflStatus: input.player.sourceStatus,
  });

  const entryBefore = await prisma.rankableEntry.findUniqueOrThrow({
    where: { id: input.rankableEntryId },
  });

  const entryChanged =
    entryBefore.name !== input.player.name ||
    entryBefore.team !== input.player.team ||
    entryBefore.position !== input.player.fantasyPosition ||
    entryBefore.provider !== NFL_COM_BOOTSTRAP_PROVIDER ||
    entryBefore.externalId !== input.player.externalId;

  if (entryChanged) {
    await prisma.rankableEntry.update({
      where: { id: input.rankableEntryId },
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: input.player.externalId,
        name: input.player.name,
        shortName: shortName(input.player.name),
        team: input.player.team,
        position: input.player.fantasyPosition,
        active: mapped.activeOnNFLRoster,
        adminNotes: entryBefore.adminNotes ?? NFL_COM_ROSTER_SOURCE_LABEL,
      },
    });
  }

  if (input.isNewEntry) return "created" as const;
  if (!existingSeason) return "created" as const;
  if (entryChanged) return "updated" as const;

  const seasonChanged =
    existingSeason.team !== input.player.team ||
    existingSeason.nflStatus !== mapped.nflStatus ||
    existingSeason.activeOnNFLRoster !== mapped.activeOnNFLRoster ||
    existingSeason.sourcePosition !== input.player.sourcePosition ||
    existingSeason.sourceNflStatus !== input.player.sourceStatus ||
    existingSeason.position !== input.player.fantasyPosition;

  return seasonChanged ? ("updated" as const) : ("unchanged" as const);
}

function buildMinnesotaValidation(players: NormalizedRosterPlayer[]) {
  const minPlayers = players.filter((player) => player.team === "MIN");
  const active = (pos: ContestPosition | "RB") =>
    minPlayers
      .filter(
        (player) =>
          player.fantasyPosition === pos &&
          mapNflComStatusToSeasonFields(player.sourceStatus).activeOnNFLRoster,
      )
      .map((player) => player.name)
      .sort();

  return {
    activeQb: active("QB"),
    activeRb: active("RB"),
    activeWr: active("WR"),
    activeTe: active("TE"),
    fbMappedPlayers: minPlayers
      .filter((player) => player.sourcePosition === "FB")
      .map((player) => player.name)
      .sort(),
  };
}

export async function bootstrapSeasonRosterFromNflCom(input: {
  seasonId: string;
  bundle?: NormalizedRosterBundle;
  runWeeklySync?: boolean;
}): Promise<RosterBootstrapReport> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: input.seasonId },
    include: {
      weeks: { orderBy: { weekNumber: "asc" } },
    },
  });

  const bundle =
    input.bundle ?? (await fetchNormalizedNflComRosters());

  const report: RosterBootstrapReport = {
    source: NFL_COM_ROSTER_SOURCE_LABEL,
    syncedAt: bundle.syncedAt.toISOString(),
    seasonId: season.id,
    seasonYear: season.year,
    teams: {
      imported: bundle.teamCount,
      expected: 32,
      missing: NFL_TEAMS.map((team) => team.abbr).filter(
        (abbr) => !bundle.teams.includes(abbr),
      ),
    },
    counts: { QB: 0, RB_FB: 0, WR: 0, TE: 0, DEF: 32 },
    activeOnRoster: 0,
    inactiveOnRoster: 0,
    matchedExisting: 0,
    newlyCreated: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    fbMapped: 0,
    ambiguous: [],
    duplicates: [],
    errors: bundle.fetchErrors.map((row) => ({
      team: row.team,
      message: row.error,
    })),
  };

  const positionCounts = countByFantasyPosition(bundle.players);
  report.counts.QB = positionCounts.QB;
  report.counts.RB_FB = positionCounts.RB_FB;
  report.counts.WR = positionCounts.WR;
  report.counts.TE = positionCounts.TE;

  const seenExternal = new Set<string>();

  for (const player of bundle.players) {
    if (player.sourcePosition === "FB") {
      report.fbMapped += 1;
    }

    const mapped = mapNflComStatusToSeasonFields(player.sourceStatus);
    if (mapped.activeOnNFLRoster) report.activeOnRoster += 1;
    else report.inactiveOnRoster += 1;

    if (seenExternal.has(player.externalId)) {
      report.duplicates.push({
        externalId: player.externalId,
        name: player.name,
        team: player.team,
      });
      report.skipped += 1;
      continue;
    }
    seenExternal.add(player.externalId);

    try {
      const resolution = await findMatchingRankableEntry(player);
      if (resolution.kind === "ambiguous") {
        report.ambiguous.push({
          name: player.name,
          team: player.team,
          position: player.fantasyPosition,
          externalId: player.externalId,
          candidateIds: resolution.candidates.map((row) => row.id),
          candidateNames: resolution.candidates.map((row) => row.name),
        });
        report.skipped += 1;
        continue;
      }

      let rankableEntryId: string;
      let isNewEntry = false;

      if (resolution.kind === "matched") {
        rankableEntryId = resolution.entry.id;
        report.matchedExisting += 1;
      } else {
        const created = await prisma.rankableEntry.create({
          data: {
            provider: NFL_COM_BOOTSTRAP_PROVIDER,
            externalId: player.externalId,
            type: "PLAYER",
            name: player.name,
            shortName: shortName(player.name),
            team: player.team,
            position: player.fantasyPosition,
            opponent: "TBD",
            active: mapped.activeOnNFLRoster,
            adminNotes: NFL_COM_ROSTER_SOURCE_LABEL,
          },
        });
        rankableEntryId = created.id;
        isNewEntry = true;
        report.newlyCreated += 1;
      }

      const outcome = await syncPlayerRecord({
        seasonId: season.id,
        player,
        rankableEntryId,
        isNewEntry,
      });

      // Deactivate other merge-compatible duplicates at the same position (any team).
      const duplicates = await prisma.rankableEntry.findMany({
        where: {
          type: "PLAYER",
          position: player.fantasyPosition,
          id: { not: rankableEntryId },
          active: true,
        },
      });
      for (const dup of duplicates) {
        if (!rankableEntryMatchesImportName(dup, player.name)) {
          continue;
        }
        if (
          dup.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
          dup.externalId !== player.externalId
        ) {
          continue;
        }
        await prisma.rankableEntry.update({
          where: { id: dup.id },
          data: {
            active: false,
            adminNotes: `Superseded by ${NFL_COM_BOOTSTRAP_PROVIDER}:${player.externalId}`,
          },
        });
        await prisma.contestEntry.updateMany({
          where: {
            rankableEntryId: dup.id,
            excluded: false,
          },
          data: {
            excluded: true,
            inactiveReason: "Superseded duplicate player identity",
          },
        });
      }

      if (outcome === "updated") report.updated += 1;
      else if (outcome === "unchanged") report.unchanged += 1;
    } catch (error) {
      report.errors.push({
        team: player.team,
        name: player.name,
        message: error instanceof Error ? error.message : "Import failed",
      });
      report.skipped += 1;
    }
  }

  await upsertDefenseEntries(season.id);

  await prisma.contestEntry.updateMany({
    where: {
      excluded: false,
      rankableEntry: { active: false },
      contest: {
        status: { in: ["DRAFT", "OPEN"] },
        week: { status: { in: ["UPCOMING", "OPEN"] } },
      },
    },
    data: {
      excluded: true,
      inactiveReason: "Inactive master directory entry",
    },
  });

  await prisma.season.update({
    where: { id: season.id },
    data: {
      rosterSyncSource: NFL_COM_ROSTER_SOURCE_LABEL,
      rosterSyncedAt: bundle.syncedAt,
    },
  });

  report.minnesota = buildMinnesotaValidation(bundle.players);

  if (input.runWeeklySync !== false) {
    const weeklyResults = await autoSyncWeeklyEligibilityForSeason(season.id);
    const week1 = season.weeks.find((week) => week.weekNumber === 1);
    let week1Eligible: Partial<Record<ContestPosition, number>> | undefined;

    if (week1) {
      const contests = await prisma.rankIQContest.findMany({
        where: { weekId: week1.id },
        include: {
          entries: { where: { excluded: false }, select: { id: true } },
        },
      });
      week1Eligible = Object.fromEntries(
        contests.map((contest) => [contest.position, contest.entries.length]),
      ) as Partial<Record<ContestPosition, number>>;
    }

    report.weeklySync = {
      weeksSynced: weeklyResults.length,
      week1Eligible,
    };
  }

  return report;
}

export function formatRosterBootstrapSummary(report: RosterBootstrapReport) {
  const lines = [
    "2026 NFL Roster Sync",
    "",
    `Source: ${report.source}`,
    `Synced at: ${report.syncedAt}`,
    "",
    `Teams: ${report.teams.imported} / ${report.teams.expected}`,
    `QB: ${report.counts.QB}`,
    `RB/FB: ${report.counts.RB_FB}`,
    `WR: ${report.counts.WR}`,
    `TE: ${report.counts.TE}`,
    `DEF: ${report.counts.DEF}`,
    "",
    `Active on roster: ${report.activeOnRoster}`,
    `Inactive/released: ${report.inactiveOnRoster}`,
    `FB → RB mapped: ${report.fbMapped}`,
    "",
    `Matched existing: ${report.matchedExisting}`,
    `New players: ${report.newlyCreated}`,
    `Updated: ${report.updated}`,
    `Unchanged: ${report.unchanged}`,
    `Skipped: ${report.skipped}`,
    `Ambiguous: ${report.ambiguous.length}`,
    `Duplicates: ${report.duplicates.length}`,
    `Errors: ${report.errors.length}`,
  ];

  if (report.teams.missing.length > 0) {
    lines.push("", `Missing teams: ${report.teams.missing.join(", ")}`);
  }

  if (report.minnesota) {
    lines.push(
      "",
      "Minnesota validation (active):",
      `  QB: ${report.minnesota.activeQb.join(", ") || "—"}`,
      `  RB: ${report.minnesota.activeRb.join(", ") || "—"}`,
      `  WR: ${report.minnesota.activeWr.join(", ") || "—"}`,
      `  TE: ${report.minnesota.activeTe.join(", ") || "—"}`,
    );
    if (report.minnesota.fbMappedPlayers.length > 0) {
      lines.push(
        `  FB→RB: ${report.minnesota.fbMappedPlayers.join(", ")}`,
      );
    }
  }

  if (report.weeklySync?.week1Eligible) {
    lines.push(
      "",
      "Week 1 eligible field:",
      ...Object.entries(report.weeklySync.week1Eligible).map(
        ([position, count]) => `  ${position}: ${count}`,
      ),
    );
  }

  if (report.ambiguous.length > 0) {
    lines.push("", "Ambiguous mappings:");
    for (const row of report.ambiguous.slice(0, 20)) {
      lines.push(
        `  ${row.name} (${row.team} ${row.position}) → ${row.candidateNames.join(" | ")}`,
      );
    }
  }

  return lines.join("\n");
}

export { teamNameForAbbreviation };
