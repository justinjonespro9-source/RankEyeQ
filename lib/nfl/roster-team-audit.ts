import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { mapNflComStatusToSeasonFields } from "@/lib/nfl/roster-status";
import { autoSyncWeeklyEligibilityForWeek } from "@/lib/nfl/weekly-auto-sync";
import { validateWeeklyPoolCanonicalUniqueness } from "@/lib/nfl/pool-canonical-uniqueness";
import {
  fetchNormalizedNflComRosters,
  NFL_COM_BOOTSTRAP_PROVIDER,
  type NormalizedRosterBundle,
  type NormalizedRosterPlayer,
} from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { NFL_TEAMS } from "@/lib/nfl-schedule";
import { enrollSeasonPlayer } from "@/lib/season-players";

const OFFENSIVE_POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE"];

export type TeamMismatchCause =
  | "source_html_team_page"
  | "parser_team_assignment"
  | "legacy_consolidation_team"
  | "stale_season_player"
  | "rankable_season_desync"
  | "source_missing_player"
  | "source_inactive_status"
  | "unknown";

export type RosterTeamMismatch = {
  rankableEntryId: string;
  name: string;
  position: ContestPosition;
  provider: string;
  externalId: string;
  seasonPlayerTeam: string;
  rankableEntryTeam: string;
  sourceTeam: string | null;
  sourceNflStatus: string | null;
  cause: TeamMismatchCause;
  legacyTeamHint: string | null;
};

export type RosterTeamAuditReport = {
  seasonId: string;
  seasonYear: number;
  syncedAt: string;
  sourcePlayerCount: number;
  activeSeasonPlayers: number;
  mismatches: RosterTeamMismatch[];
  rankableSeasonDesync: Array<{
    rankableEntryId: string;
    name: string;
    seasonPlayerTeam: string;
    rankableEntryTeam: string;
  }>;
  duplicateProviderTeams: Array<{
    externalId: string;
    name: string;
    teams: string[];
  }>;
  notOnSourceRoster: Array<{
    rankableEntryId: string;
    name: string;
    team: string;
    externalId: string;
  }>;
  sourceInactiveButActive: Array<{
    rankableEntryId: string;
    name: string;
    team: string;
    sourceNflStatus: string;
  }>;
  weekPoolTeamDrift: Array<{
    rankableEntryId: string;
    name: string;
    seasonPlayerTeam: string;
    weekTeam: string;
    contestEntryId: string;
  }>;
  knownPlayers: Record<
    string,
    {
      found: boolean;
      seasonPlayerTeam: string | null;
      rankableEntryTeam: string | null;
      sourceTeam: string | null;
      sourceNflStatus: string | null;
      aligned: boolean;
    }
  >;
  teamCounts: Record<
    string,
    { QB: number; RB: number; WR: number; TE: number; flags: string[] }
  >;
  sourceQuality: {
    sourceMultiTeamIds: Array<{
      externalId: string;
      name: string;
      teams: string[];
    }>;
    primaryCause:
      | "aligned_with_source"
      | "legacy_consolidation"
      | "stale_import"
      | "source_html_team_page"
      | "mixed";
    notes: string[];
  };
};

export type RosterTeamReconcileReport = RosterTeamAuditReport & {
  corrected: number;
  correctedPlayers: Array<{
    name: string;
    externalId: string;
    fromTeam: string;
    toTeam: string;
    cause: TeamMismatchCause;
  }>;
  week1Counts: Partial<Record<ContestPosition, number>>;
  poolUniquenessOk: boolean;
};

const KNOWN_PLAYER_EXTERNAL_IDS = [
  "a-j-brown",
  "aaron-jones",
  "david-montgomery",
  "brian-robinson",
  "bijan-robinson",
] as const;

function sourceByExternalId(bundle: NormalizedRosterBundle) {
  const map = new Map<string, NormalizedRosterPlayer>();
  for (const player of bundle.players) {
    if (!map.has(player.externalId)) {
      map.set(player.externalId, player);
    }
  }
  return map;
}

function classifyMismatchCause(input: {
  rankableProvider: string;
  rankableExternalId: string;
  seasonTeam: string;
  rankableTeam: string;
  sourceTeam: string | null;
  legacyTeamHint: string | null;
}): TeamMismatchCause {
  if (input.seasonTeam !== input.rankableTeam) {
    return "rankable_season_desync";
  }
  if (!input.sourceTeam) {
    return "source_missing_player";
  }
  if (input.legacyTeamHint && input.legacyTeamHint !== input.sourceTeam) {
    return "legacy_consolidation_team";
  }
  if (input.rankableProvider !== NFL_COM_BOOTSTRAP_PROVIDER) {
    return "stale_season_player";
  }
  return "stale_season_player";
}

async function findLegacyTeamHint(rankableEntryId: string, externalId: string) {
  const entry = await prisma.rankableEntry.findUnique({
    where: { id: rankableEntryId },
    select: { name: true, position: true, team: true },
  });
  if (!entry) return null;

  const legacy = await prisma.rankableEntry.findFirst({
    where: {
      id: { not: rankableEntryId },
      type: "PLAYER",
      position: entry.position,
      provider: { in: ["mock", "manual"] },
      OR: [
        { externalId },
        { name: { equals: entry.name, mode: "insensitive" } },
      ],
      active: false,
    },
    orderBy: { updatedAt: "desc" },
    select: { team: true },
  });
  return legacy?.team ?? null;
}

export async function auditRosterTeamAccuracy(input: {
  seasonId: string;
  bundle?: NormalizedRosterBundle;
  weekId?: string;
}): Promise<RosterTeamAuditReport> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: input.seasonId },
  });
  const bundle = input.bundle ?? (await fetchNormalizedNflComRosters());
  const source = sourceByExternalId(bundle);

  const seasonPlayers = await prisma.seasonPlayer.findMany({
    where: {
      seasonId: season.id,
      position: { in: OFFENSIVE_POSITIONS },
      activeOnNFLRoster: true,
      rankableEntry: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        active: true,
        type: "PLAYER",
      },
    },
    include: { rankableEntry: true },
    orderBy: { displayName: "asc" },
  });

  const mismatches: RosterTeamMismatch[] = [];
  const rankableSeasonDesync: RosterTeamAuditReport["rankableSeasonDesync"] =
    [];
  const notOnSourceRoster: RosterTeamAuditReport["notOnSourceRoster"] = [];
  const sourceInactiveButActive: RosterTeamAuditReport["sourceInactiveButActive"] =
    [];

  for (const row of seasonPlayers) {
    const rankable = row.rankableEntry;
    const sourcePlayer = source.get(rankable.externalId) ?? null;
    const sourceTeam = sourcePlayer?.team ?? null;
    const sourceNflStatus = sourcePlayer?.sourceStatus ?? null;

    if (row.team !== rankable.team) {
      rankableSeasonDesync.push({
        rankableEntryId: rankable.id,
        name: row.displayName,
        seasonPlayerTeam: row.team,
        rankableEntryTeam: rankable.team,
      });
    }

    if (!sourcePlayer) {
      notOnSourceRoster.push({
        rankableEntryId: rankable.id,
        name: row.displayName,
        team: row.team,
        externalId: rankable.externalId,
      });
      continue;
    }

    const mapped = mapNflComStatusToSeasonFields(sourcePlayer.sourceStatus);
    if (!mapped.activeOnNFLRoster) {
      sourceInactiveButActive.push({
        rankableEntryId: rankable.id,
        name: row.displayName,
        team: row.team,
        sourceNflStatus: sourcePlayer.sourceStatus,
      });
    }

    if (row.team === sourceTeam && rankable.team === sourceTeam) {
      continue;
    }

    const legacyTeamHint = await findLegacyTeamHint(rankable.id, rankable.externalId);
    mismatches.push({
      rankableEntryId: rankable.id,
      name: row.displayName,
      position: row.position,
      provider: rankable.provider,
      externalId: rankable.externalId,
      seasonPlayerTeam: row.team,
      rankableEntryTeam: rankable.team,
      sourceTeam,
      sourceNflStatus,
      legacyTeamHint,
      cause: classifyMismatchCause({
        rankableProvider: rankable.provider,
        rankableExternalId: rankable.externalId,
        seasonTeam: row.team,
        rankableTeam: rankable.team,
        sourceTeam,
        legacyTeamHint,
      }),
    });
  }

  const providerTeamMap = new Map<string, Set<string>>();
  for (const row of seasonPlayers) {
    const ext = row.rankableEntry.externalId;
    const teams = providerTeamMap.get(ext) ?? new Set<string>();
    teams.add(row.team);
    providerTeamMap.set(ext, teams);
  }
  const duplicateProviderTeams = [...providerTeamMap.entries()]
    .filter(([, teams]) => teams.size > 1)
    .map(([externalId, teams]) => {
      const sample = seasonPlayers.find(
        (row) => row.rankableEntry.externalId === externalId,
      );
      return {
        externalId,
        name: sample?.displayName ?? externalId,
        teams: [...teams].sort(),
      };
    });

  const weekPoolTeamDrift: RosterTeamAuditReport["weekPoolTeamDrift"] = [];
  if (input.weekId) {
    const poolEntries = await prisma.contestEntry.findMany({
      where: {
        excluded: false,
        contest: { weekId: input.weekId },
        rankableEntry: { position: { in: OFFENSIVE_POSITIONS } },
      },
      include: { rankableEntry: true },
    });
    const seasonByRankable = new Map(
      seasonPlayers.map((row) => [row.rankableEntryId, row]),
    );
    for (const entry of poolEntries) {
      const seasonRow = seasonByRankable.get(entry.rankableEntryId);
      if (!seasonRow) continue;
      const weekTeam = entry.weekTeam ?? seasonRow.team;
      if (weekTeam !== seasonRow.team) {
        weekPoolTeamDrift.push({
          rankableEntryId: entry.rankableEntryId,
          name: seasonRow.displayName,
          seasonPlayerTeam: seasonRow.team,
          weekTeam,
          contestEntryId: entry.id,
        });
      }
    }
  }

  const knownPlayers: RosterTeamAuditReport["knownPlayers"] = {};
  for (const externalId of KNOWN_PLAYER_EXTERNAL_IDS) {
    const seasonRow = seasonPlayers.find(
      (row) => row.rankableEntry.externalId === externalId,
    );
    const sourcePlayer = source.get(externalId) ?? null;
    knownPlayers[externalId] = {
      found: Boolean(seasonRow),
      seasonPlayerTeam: seasonRow?.team ?? null,
      rankableEntryTeam: seasonRow?.rankableEntry.team ?? null,
      sourceTeam: sourcePlayer?.team ?? null,
      sourceNflStatus: sourcePlayer?.sourceStatus ?? null,
      aligned:
        Boolean(seasonRow) &&
        Boolean(sourcePlayer) &&
        seasonRow!.team === sourcePlayer!.team &&
        seasonRow!.rankableEntry.team === sourcePlayer!.team,
    };
  }

  const teamCounts: RosterTeamAuditReport["teamCounts"] = {};
  for (const team of NFL_TEAMS) {
    teamCounts[team.abbr] = { QB: 0, RB: 0, WR: 0, TE: 0, flags: [] };
  }
  for (const row of seasonPlayers) {
    const bucket = teamCounts[row.team];
    if (!bucket) {
      const flags = teamCounts[row.team]?.flags ?? [];
      if (!teamCounts[row.team]) {
        teamCounts[row.team] = { QB: 0, RB: 0, WR: 0, TE: 0, flags: [] };
      }
      teamCounts[row.team]!.flags.push("unknown_team_abbreviation");
      continue;
    }
    if (row.position === "QB" || row.position === "RB" || row.position === "WR" || row.position === "TE") {
      bucket[row.position] += 1;
    }
  }

  const playersByTeam = new Map<string, string[]>();
  for (const row of seasonPlayers) {
    const list = playersByTeam.get(row.team) ?? [];
    list.push(row.rankableEntry.externalId);
    playersByTeam.set(row.team, list);
  }
  for (const [externalId, teams] of providerTeamMap) {
    if (teams.size > 1) {
      for (const team of teams) {
        teamCounts[team]?.flags.push(`provider_id_on_multiple_teams:${externalId}`);
      }
    }
  }

  const sourceMultiTeamIds: RosterTeamAuditReport["sourceQuality"]["sourceMultiTeamIds"] =
    [];
  const sourceTeamsById = new Map<string, Set<string>>();
  for (const player of bundle.players) {
    const teams = sourceTeamsById.get(player.externalId) ?? new Set<string>();
    teams.add(player.team);
    sourceTeamsById.set(player.externalId, teams);
  }
  for (const [externalId, teams] of sourceTeamsById) {
    if (teams.size <= 1) continue;
    const sample = bundle.players.find((row) => row.externalId === externalId);
    sourceMultiTeamIds.push({
      externalId,
      name: sample?.name ?? externalId,
      teams: [...teams].sort(),
    });
  }

  const causeCounts = summarizeTeamMismatchCauses(mismatches);
  const notes: string[] = [];
  if (mismatches.length === 0) {
    notes.push(
      "All active nflcom-bootstrap offensive SeasonPlayers match the current NFL.com roster source.",
    );
  }
  if (sourceMultiTeamIds.length > 0) {
    notes.push(
      `${sourceMultiTeamIds.length} provider IDs appear on multiple NFL.com team roster pages.`,
    );
  }
  if (causeCounts.legacy_consolidation_team > 0) {
    notes.push(
      `${causeCounts.legacy_consolidation_team} mismatches trace to legacy/mock team pollution.`,
    );
  }

  let primaryCause: RosterTeamAuditReport["sourceQuality"]["primaryCause"] =
    "aligned_with_source";
  if (mismatches.length === 0) {
    primaryCause = "aligned_with_source";
  } else if (
    causeCounts.legacy_consolidation_team > 0 &&
    causeCounts.stale_season_player === 0
  ) {
    primaryCause = "legacy_consolidation";
  } else if (causeCounts.stale_season_player > 0 && causeCounts.legacy_consolidation_team === 0) {
    primaryCause = "stale_import";
  } else if (sourceMultiTeamIds.length > 0) {
    primaryCause = "source_html_team_page";
  } else if (mismatches.length > 0) {
    primaryCause = "mixed";
  }

  return {
    seasonId: season.id,
    seasonYear: season.year,
    syncedAt: bundle.syncedAt.toISOString(),
    sourcePlayerCount: source.size,
    activeSeasonPlayers: seasonPlayers.length,
    mismatches,
    rankableSeasonDesync,
    duplicateProviderTeams,
    notOnSourceRoster,
    sourceInactiveButActive,
    weekPoolTeamDrift,
    knownPlayers,
    teamCounts,
    sourceQuality: {
      sourceMultiTeamIds,
      primaryCause,
      notes,
    },
  };
}

async function applyCurrentTeamCorrection(input: {
  seasonId: string;
  rankableEntryId: string;
  sourcePlayer: NormalizedRosterPlayer;
}) {
  const mapped = mapNflComStatusToSeasonFields(input.sourcePlayer.sourceStatus);

  await prisma.rankableEntry.update({
    where: { id: input.rankableEntryId },
    data: {
      team: input.sourcePlayer.team,
      name: input.sourcePlayer.name,
      position: input.sourcePlayer.fantasyPosition,
      active: mapped.activeOnNFLRoster,
    },
  });

  await enrollSeasonPlayer({
    seasonId: input.seasonId,
    rankableEntryId: input.rankableEntryId,
    team: input.sourcePlayer.team,
    nflStatus: mapped.nflStatus,
    activeOnNFLRoster: mapped.activeOnNFLRoster,
    sourcePosition: input.sourcePlayer.sourcePosition,
    sourceNflStatus: input.sourcePlayer.sourceStatus,
  });
}

export async function reconcileRosterTeamAccuracy(input: {
  seasonId: string;
  bundle?: NormalizedRosterBundle;
  weekId?: string;
  resyncWeek?: boolean;
}): Promise<RosterTeamReconcileReport> {
  const bundle = input.bundle ?? (await fetchNormalizedNflComRosters());
  const before = await auditRosterTeamAccuracy({
    seasonId: input.seasonId,
    bundle,
    weekId: input.weekId,
  });

  const source = sourceByExternalId(bundle);
  const correctedPlayers: RosterTeamReconcileReport["correctedPlayers"] = [];

  for (const mismatch of before.mismatches) {
    const sourcePlayer = source.get(mismatch.externalId);
    if (!sourcePlayer) continue;

    await applyCurrentTeamCorrection({
      seasonId: input.seasonId,
      rankableEntryId: mismatch.rankableEntryId,
      sourcePlayer,
    });

    correctedPlayers.push({
      name: mismatch.name,
      externalId: mismatch.externalId,
      fromTeam: mismatch.seasonPlayerTeam,
      toTeam: sourcePlayer.team,
      cause: mismatch.cause,
    });
  }

  for (const row of before.rankableSeasonDesync) {
    const sourcePlayer = source.get(
      before.mismatches.find((m) => m.rankableEntryId === row.rankableEntryId)
        ?.externalId ?? "",
    );
    if (!sourcePlayer) continue;
    if (correctedPlayers.some((c) => c.externalId === sourcePlayer.externalId)) {
      continue;
    }
    await applyCurrentTeamCorrection({
      seasonId: input.seasonId,
      rankableEntryId: row.rankableEntryId,
      sourcePlayer,
    });
    correctedPlayers.push({
      name: row.name,
      externalId: sourcePlayer.externalId,
      fromTeam: row.seasonPlayerTeam,
      toTeam: sourcePlayer.team,
      cause: "rankable_season_desync",
    });
  }

  if (input.resyncWeek !== false && input.weekId) {
    await autoSyncWeeklyEligibilityForWeek(input.weekId);
  }

  const after = await auditRosterTeamAccuracy({
    seasonId: input.seasonId,
    bundle,
    weekId: input.weekId,
  });

  let week1Counts: Partial<Record<ContestPosition, number>> | undefined;
  if (input.weekId) {
    const contests = await prisma.rankIQContest.findMany({
      where: { weekId: input.weekId },
      include: {
        entries: { where: { excluded: false }, select: { id: true } },
      },
    });
    week1Counts = Object.fromEntries(
      contests.map((contest) => [contest.position, contest.entries.length]),
    ) as Partial<Record<ContestPosition, number>>;
  }

  const poolUniqueness = input.weekId
    ? (await validateWeeklyPoolCanonicalUniqueness(input.weekId)).ok
    : true;

  return {
    ...after,
    corrected: correctedPlayers.length,
    correctedPlayers,
    week1Counts: week1Counts ?? {},
    poolUniquenessOk: poolUniqueness,
  };
}

export function summarizeTeamMismatchCauses(
  mismatches: RosterTeamMismatch[],
): Record<TeamMismatchCause, number> {
  const counts: Record<TeamMismatchCause, number> = {
    source_html_team_page: 0,
    parser_team_assignment: 0,
    legacy_consolidation_team: 0,
    stale_season_player: 0,
    rankable_season_desync: 0,
    source_missing_player: 0,
    source_inactive_status: 0,
    unknown: 0,
  };
  for (const row of mismatches) {
    counts[row.cause] += 1;
  }
  return counts;
}
