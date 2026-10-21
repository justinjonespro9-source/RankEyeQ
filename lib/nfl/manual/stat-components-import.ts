import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  LIVE_MANUAL_PROVIDER,
} from "@/lib/admin/live-scoring-shared";
import { resolveFantasyScoringVersion } from "@/lib/fantasy/shared-engine";
import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import type { ContestPosition, Prisma } from "@/lib/generated/prisma/client";
import {
  parseStatComponentsCsv,
  type ParsedStatComponentRow,
} from "@/lib/nfl/manual/parse-stat-components";
import {
  assertUniqueStatCsvHeaders,
  csvJoin,
  DEFENSE_CSV_COLUMNS,
  PLAYER_CSV_COLUMNS,
  STAT_COMPONENTS_COMMON_COLUMNS,
  STAT_COMPONENTS_FORMAT_VERSION,
  STAT_COMPONENTS_IMPORT_TYPE,
} from "@/lib/nfl/manual/stat-components-format";

assertUniqueStatCsvHeaders();

/** Soft operational limits — full NFL weeks (~456) fit comfortably. */
export const STAT_COMPONENTS_MAX_CSV_BYTES = 2_000_000;
export const STAT_COMPONENTS_MAX_ROWS = 2_000;

export type PoolEntrySnapshot = {
  contestEntryId: string;
  contestId: string;
  contestStatus: string;
  contestPosition: ContestPosition;
  rankableEntryId: string;
  provider: string;
  externalId: string;
  name: string;
  team: string;
  gameId: string | null;
  gameExternalId: string | null;
  gameStatus: string | null;
  gameStatsFinalizedAt: string | null;
  fantasyPoints: number | null;
  actualRank: number | null;
  existingStat: {
    isProvisional: boolean;
    fantasyPoints: number;
    components: Record<string, number>;
  } | null;
};

function sha256Text(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function componentsEqual(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (Number(a[key] ?? NaN) !== Number(b[key] ?? NaN)) return false;
  }
  return true;
}

/** Domain-field component map (WeekStat / scoring), not CSV headers. */
function playerComponents(stats: Required<PlayerStatLine>): Record<string, number> {
  return {
    passingYards: stats.passingYards,
    passingTds: stats.passingTds,
    interceptions: stats.interceptions,
    rushingYards: stats.rushingYards,
    rushingTds: stats.rushingTds,
    receptions: stats.receptions,
    receivingYards: stats.receivingYards,
    receivingTds: stats.receivingTds,
    twoPointConversions: stats.twoPointConversions,
    fumblesLost: stats.fumblesLost,
    returnTds: stats.returnTds,
  };
}

function defenseComponents(stats: Required<DefenseStatLine>): Record<string, number> {
  return {
    sacks: stats.sacks,
    interceptions: stats.interceptions,
    fumbleRecoveries: stats.fumbleRecoveries,
    defensiveTds: stats.defensiveTds,
    specialTeamsTds: stats.specialTeamsTds,
    safeties: stats.safeties,
    blockedKicks: stats.blockedKicks,
    pointsAllowed: stats.pointsAllowed,
  };
}

async function loadPoolSnapshot(weekId: string): Promise<{
  week: {
    id: string;
    weekNumber: number;
    status: string;
    updatedAt: Date;
    seasonYear: number;
    fantasyScoringVersion: string;
  };
  entries: PoolEntrySnapshot[];
  games: Array<{
    id: string;
    externalId: string;
    status: string;
    statsFinalizedAt: Date | null;
    updatedAt: Date;
    awayTeam: string;
    homeTeam: string;
  }>;
}> {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      season: true,
      games: { orderBy: { startsAt: "asc" } },
      contests: {
        include: {
          entries: {
            where: { excluded: false },
            include: {
              rankableEntry: true,
              game: true,
            },
          },
        },
      },
    },
  });

  const scoringVersion = resolveFantasyScoringVersion({
    weekVersion: week.fantasyScoringVersion,
    seasonVersion: week.season.fantasyScoringVersion,
  });

  const rankableIds = week.contests.flatMap((contest) =>
    contest.entries.map((entry) => entry.rankableEntryId),
  );

  const [playerStats, defenseStats] = await Promise.all([
    prisma.playerWeekStat.findMany({
      where: {
        weekId,
        provider: LIVE_MANUAL_PROVIDER,
        rankableEntryId: { in: rankableIds },
      },
    }),
    prisma.defenseWeekStat.findMany({
      where: {
        weekId,
        provider: LIVE_MANUAL_PROVIDER,
        rankableEntryId: { in: rankableIds },
      },
    }),
  ]);

  const playerByRankable = new Map(
    playerStats.map((row) => [row.rankableEntryId ?? "", row]),
  );
  const defenseByRankable = new Map(
    defenseStats.map((row) => [row.rankableEntryId ?? "", row]),
  );

  const entries: PoolEntrySnapshot[] = [];
  for (const contest of week.contests) {
    for (const entry of contest.entries) {
      const isDef = contest.position === "DEF";
      const player = playerByRankable.get(entry.rankableEntryId) ?? null;
      const defense = defenseByRankable.get(entry.rankableEntryId) ?? null;
      const existing = isDef ? defense : player;
      entries.push({
        contestEntryId: entry.id,
        contestId: contest.id,
        contestStatus: contest.status,
        contestPosition: contest.position,
        rankableEntryId: entry.rankableEntryId,
        provider: entry.rankableEntry.provider,
        externalId: entry.rankableEntry.externalId,
        name: entry.rankableEntry.name,
        team: entry.rankableEntry.team,
        gameId: entry.gameId,
        gameExternalId: entry.game?.externalId ?? null,
        gameStatus: entry.game?.status ?? null,
        gameStatsFinalizedAt: entry.game?.statsFinalizedAt?.toISOString() ?? null,
        fantasyPoints: entry.fantasyPoints,
        actualRank: entry.actualRank,
        existingStat: existing
          ? {
              isProvisional: existing.isProvisional,
              fantasyPoints: existing.fantasyPoints,
              components: isDef
                ? defenseComponents({
                    sacks: defense!.sacks,
                    interceptions: defense!.interceptions,
                    fumbleRecoveries: defense!.fumbleRecoveries,
                    defensiveTds: defense!.defensiveTds,
                    specialTeamsTds: defense!.specialTeamsTds,
                    safeties: defense!.safeties,
                    blockedKicks: defense!.blockedKicks,
                    pointsAllowed: defense!.pointsAllowed,
                  })
                : playerComponents({
                    passingYards: player!.passingYards,
                    passingTds: player!.passingTds,
                    interceptions: player!.interceptions,
                    rushingYards: player!.rushingYards,
                    rushingTds: player!.rushingTds,
                    receptions: player!.receptions,
                    receivingYards: player!.receivingYards,
                    receivingTds: player!.receivingTds,
                    twoPointConversions: player!.twoPointConversions,
                    fumblesLost: player!.fumblesLost,
                    returnTds: player!.returnTds,
                  }),
            }
          : null,
      });
    }
  }

  return {
    week: {
      id: week.id,
      weekNumber: week.weekNumber,
      status: week.status,
      updatedAt: week.updatedAt,
      seasonYear: week.season.year,
      fantasyScoringVersion: scoringVersion,
    },
    entries,
    games: week.games.map((game) => ({
      id: game.id,
      externalId: game.externalId,
      status: game.status,
      statsFinalizedAt: game.statsFinalizedAt,
      updatedAt: game.updatedAt,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
    })),
  };
}

function buildStateFingerprint(input: {
  contentSha256: string;
  week: { id: string; status: string; updatedAt: Date };
  entries: PoolEntrySnapshot[];
  games: Array<{
    id: string;
    externalId: string;
    status: string;
    statsFinalizedAt: Date | null;
    updatedAt: Date;
  }>;
}) {
  const pool = [...input.entries]
    .map(
      (entry) =>
        [
          entry.contestEntryId,
          entry.rankableEntryId,
          entry.provider,
          entry.externalId,
          entry.gameId ?? "",
          entry.gameExternalId ?? "",
          entry.gameStatus ?? "",
          entry.gameStatsFinalizedAt ?? "",
          entry.contestStatus,
          entry.team,
          entry.contestPosition,
          entry.fantasyPoints ?? "null",
          entry.actualRank ?? "null",
        ].join("|"),
    )
    .sort();
  const games = [...input.games]
    .map(
      (game) =>
        [
          game.id,
          game.externalId,
          game.status,
          game.statsFinalizedAt?.toISOString() ?? "",
          game.updatedAt.toISOString(),
        ].join("|"),
    )
    .sort();
  const stats = [...input.entries]
    .map((entry) => {
      const existing = entry.existingStat;
      if (!existing) return `${entry.rankableEntryId}|none`;
      return `${entry.rankableEntryId}|${existing.isProvisional ? "P" : "F"}|${sha256Json(existing.components)}|${existing.fantasyPoints}`;
    })
    .sort();

  return sha256Json({
    v: 2,
    contentSha256: input.contentSha256,
    weekId: input.week.id,
    weekStatus: input.week.status,
    weekUpdatedAt: input.week.updatedAt.toISOString(),
    pool,
    games,
    stats,
  });
}

export async function exportStatComponentsTemplate(weekId: string): Promise<{
  filename: string;
  csv: string;
  rowCount: number;
}> {
  const snapshot = await loadPoolSnapshot(weekId);
  const header = [
    ...STAT_COMPONENTS_COMMON_COLUMNS,
    ...PLAYER_CSV_COLUMNS,
    ...DEFENSE_CSV_COLUMNS,
  ];
  const lines = [csvJoin(header)];

  for (const entry of snapshot.entries.sort(
    (a, b) =>
      a.contestPosition.localeCompare(b.contestPosition) ||
      a.name.localeCompare(b.name),
  )) {
    const isDef = entry.contestPosition === "DEF";
    const common = [
      isDef ? "DEF" : "PLAYER",
      STAT_COMPONENTS_FORMAT_VERSION,
      snapshot.week.seasonYear,
      snapshot.week.weekNumber,
      entry.rankableEntryId,
      entry.provider,
      entry.externalId,
      entry.gameExternalId ?? "",
      entry.team,
      entry.contestPosition,
      entry.name,
      "", // sourceLabel — operator fills
      "", // sourceUrl
      "", // observedAt
    ];
    const playerCells = PLAYER_CSV_COLUMNS.map(() => "");
    const defenseCells = DEFENSE_CSV_COLUMNS.map(() => "");
    lines.push(csvJoin([...common, ...playerCells, ...defenseCells]));
  }

  return {
    filename: `rankeyeq-stat-components-w${snapshot.week.weekNumber}-template.csv`,
    csv: `${lines.join("\n")}\n`,
    rowCount: snapshot.entries.length,
  };
}

export type StatComponentsMatchedRow = {
  lineNumber: number;
  contestEntryId: string;
  rankableEntryId: string;
  name: string;
  team: string;
  position: ContestPosition;
  gameExternalId: string;
  fantasyPoints: number;
  action: "create" | "update" | "unchanged";
  playerStats: Required<PlayerStatLine> | null;
  defenseStats: Required<DefenseStatLine> | null;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
};

export type StatComponentsPreview = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  contentSha256: string;
  previewToken: string;
  scoringVersion: string;
  matched: StatComponentsMatchedRow[];
  missingPoolEntries: Array<{
    contestEntryId: string;
    rankableEntryId: string;
    name: string;
    position: ContestPosition;
    gameExternalId: string | null;
  }>;
  finalizedBlocked: Array<{ name: string; reason: string }>;
  conflicts: Array<{ name: string; detail: string }>;
  coverage: {
    poolSize: number;
    matchedCount: number;
    missingCount: number;
  };
};

function matchRowToPool(
  row: ParsedStatComponentRow,
  byRankableId: Map<string, PoolEntrySnapshot>,
  byProviderExternal: Map<string, PoolEntrySnapshot>,
): { entry: PoolEntrySnapshot | null; issues: string[] } {
  const issues: string[] = [];
  let entry: PoolEntrySnapshot | null = null;
  if (row.rankableEntryId) {
    entry = byRankableId.get(row.rankableEntryId) ?? null;
    if (!entry) issues.push(`Unknown rankableEntryId ${row.rankableEntryId}`);
  } else {
    entry =
      byProviderExternal.get(`${row.provider}|${row.externalId}`) ?? null;
    if (!entry) {
      issues.push(`Unknown provider/externalId ${row.provider}/${row.externalId}`);
    }
  }
  if (!entry) return { entry: null, issues };

  if (row.provider && row.provider !== entry.provider) {
    issues.push(`provider mismatch for ${entry.name}`);
  }
  if (row.externalId && row.externalId !== entry.externalId) {
    issues.push(`externalId mismatch for ${entry.name}`);
  }
  if (row.team && row.team.toUpperCase() !== entry.team.toUpperCase()) {
    issues.push(`team mismatch for ${entry.name}`);
  }
  if (row.position && row.position !== entry.contestPosition) {
    issues.push(`position mismatch for ${entry.name}`);
  }
  if (row.displayName && row.displayName !== entry.name) {
    issues.push(`displayName mismatch for ${entry.name} (expected exact pool name)`);
  }
  if (!entry.gameExternalId) {
    issues.push(`${entry.name} has no game assignment`);
  } else if (row.gameExternalId !== entry.gameExternalId) {
    issues.push(
      `wrong game for ${entry.name}: file ${row.gameExternalId}, pool ${entry.gameExternalId}`,
    );
  }

  const expectType = entry.contestPosition === "DEF" ? "DEF" : "PLAYER";
  if (row.recordType !== expectType) {
    issues.push(`recordType ${row.recordType} invalid for ${entry.contestPosition}`);
  }
  if (expectType === "PLAYER" && !row.playerStats) {
    issues.push(`missing player components for ${entry.name}`);
  }
  if (expectType === "DEF" && !row.defenseStats) {
    issues.push(`missing defense components for ${entry.name}`);
  }

  return { entry, issues };
}

export async function previewStatComponentsImport(input: {
  weekId: string;
  csvText: string;
  /** When true, differing provisional WeekStat lines may be replaced on commit. */
  replaceProvisional?: boolean;
}): Promise<StatComponentsPreview> {
  const csvBytes = Buffer.byteLength(input.csvText, "utf8");
  if (csvBytes > STAT_COMPONENTS_MAX_CSV_BYTES) {
    return {
      ready: false,
      blockers: [
        `CSV exceeds ${STAT_COMPONENTS_MAX_CSV_BYTES} byte limit (${csvBytes} bytes)`,
      ],
      warnings: [],
      contentSha256: sha256Text(input.csvText),
      previewToken: "",
      scoringVersion: "",
      matched: [],
      missingPoolEntries: [],
      finalizedBlocked: [],
      conflicts: [],
      coverage: { poolSize: 0, matchedCount: 0, missingCount: 0 },
    };
  }

  const contentSha256 = sha256Text(input.csvText);
  const parsed = parseStatComponentsCsv(input.csvText);
  const snapshot = await loadPoolSnapshot(input.weekId);
  const blockers = [...parsed.blockers];
  const warnings: string[] = [];

  if (snapshot.week.status === "COMPLETE" || snapshot.week.status === "ARCHIVED") {
    blockers.push(`Week status ${snapshot.week.status} does not allow component import`);
  }
  if (snapshot.entries.some((entry) => entry.contestStatus === "FINAL" || entry.contestStatus === "ARCHIVED")) {
    blockers.push("One or more position contests are FINAL/ARCHIVED — import refused");
  }

  const byRankableId = new Map(
    snapshot.entries.map((entry) => [entry.rankableEntryId, entry]),
  );
  const byProviderExternal = new Map(
    snapshot.entries.map((entry) => [`${entry.provider}|${entry.externalId}`, entry]),
  );

  const matched: StatComponentsMatchedRow[] = [];
  const finalizedBlocked: StatComponentsPreview["finalizedBlocked"] = [];
  const conflicts: StatComponentsPreview["conflicts"] = [];
  const matchedIds = new Set<string>();

  if (parsed.readyForMatch) {
    for (const row of parsed.rows) {
      if (row.seasonYear != null && row.seasonYear !== snapshot.week.seasonYear) {
        blockers.push(`Row ${row.lineNumber}: seasonYear does not match week`);
      }
      if (row.weekNumber != null && row.weekNumber !== snapshot.week.weekNumber) {
        blockers.push(`Row ${row.lineNumber}: weekNumber does not match week`);
      }

      const { entry, issues } = matchRowToPool(row, byRankableId, byProviderExternal);
      if (issues.length) {
        blockers.push(...issues.map((issue) => `Row ${row.lineNumber}: ${issue}`));
        continue;
      }
      if (!entry) continue;

      if (matchedIds.has(entry.rankableEntryId)) {
        blockers.push(`Row ${row.lineNumber}: duplicate match for ${entry.name}`);
        continue;
      }
      matchedIds.add(entry.rankableEntryId);

      const locked =
        entry.actualRank != null ||
        entry.contestStatus === "FINAL" ||
        entry.contestStatus === "ARCHIVED" ||
        entry.gameStatsFinalizedAt != null ||
        (entry.existingStat != null && !entry.existingStat.isProvisional);

      const incomingComponents =
        entry.contestPosition === "DEF"
          ? defenseComponents(row.defenseStats!)
          : playerComponents(row.playerStats!);

      const fantasyPoints =
        entry.contestPosition === "DEF"
          ? calculateDefenseLiveFantasyPoints(
              row.defenseStats!,
              snapshot.week.fantasyScoringVersion,
            )
          : calculatePlayerLiveFantasyPoints(
              row.playerStats!,
              snapshot.week.fantasyScoringVersion,
            );

      if (locked) {
        finalizedBlocked.push({
          name: entry.name,
          reason: "Finalized or verified stats — use Correct Verified Stats",
        });
        blockers.push(`${entry.name}: finalized stats cannot be overwritten by import`);
        continue;
      }

      let action: StatComponentsMatchedRow["action"] = "create";
      if (entry.existingStat) {
        if (componentsEqual(entry.existingStat.components, incomingComponents)) {
          action = "unchanged";
        } else if (entry.existingStat.isProvisional) {
          action = "update";
          conflicts.push({
            name: entry.name,
            detail:
              "Provisional components differ from import — set replaceProvisional to allow replace",
          });
        }
      }

      matched.push({
        lineNumber: row.lineNumber,
        contestEntryId: entry.contestEntryId,
        rankableEntryId: entry.rankableEntryId,
        name: entry.name,
        team: entry.team,
        position: entry.contestPosition,
        gameExternalId: entry.gameExternalId!,
        fantasyPoints,
        action,
        playerStats: row.playerStats,
        defenseStats: row.defenseStats,
        sourceLabel: row.sourceLabel,
        sourceUrl: row.sourceUrl,
        observedAt: row.observedAt,
      });
    }
  }

  const missingPoolEntries = snapshot.entries
    .filter((entry) => !matchedIds.has(entry.rankableEntryId))
    .map((entry) => ({
      contestEntryId: entry.contestEntryId,
      rankableEntryId: entry.rankableEntryId,
      name: entry.name,
      position: entry.contestPosition,
      gameExternalId: entry.gameExternalId,
    }));

  if (missingPoolEntries.length > 0) {
    blockers.push(
      `Incomplete coverage: ${missingPoolEntries.length} active pool entr${missingPoolEntries.length === 1 ? "y" : "ies"} missing from file (zeros must be explicit rows)`,
    );
  }

  if (conflicts.length > 0) {
    if (input.replaceProvisional) {
      warnings.push(
        `${conflicts.length} provisional conflict(s) will be replaced on commit`,
      );
    } else {
      blockers.push(
        `${conflicts.length} provisional conflict(s) — re-preview with replaceProvisional to overwrite`,
      );
    }
  }

  const previewToken = buildStateFingerprint({
    contentSha256,
    week: snapshot.week,
    entries: snapshot.entries,
    games: snapshot.games,
  });

  const ready =
    blockers.length === 0 &&
    matched.length === snapshot.entries.length &&
    missingPoolEntries.length === 0;

  return {
    ready,
    blockers,
    warnings,
    contentSha256,
    previewToken,
    scoringVersion: snapshot.week.fantasyScoringVersion,
    matched,
    missingPoolEntries: missingPoolEntries.slice(0, 50),
    finalizedBlocked,
    conflicts,
    coverage: {
      poolSize: snapshot.entries.length,
      matchedCount: matched.length,
      missingCount: missingPoolEntries.length,
    },
  };
}

export async function commitStatComponentsImport(input: {
  weekId: string;
  csvText: string;
  adminUserId: string;
  previewToken: string;
  approved: boolean;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  replaceProvisional?: boolean;
  /**
   * Test-only: throw after N successful row writes inside the transaction
   * to prove atomic rollback. Ignored outside vitest/test.
   */
  __testFailAfterWrites?: number;
}): Promise<{
  created: number;
  updated: number;
  unchanged: number;
  importLogId: string;
  auditLogId: string;
  contentSha256: string;
}> {
  if (!input.approved) {
    throw new Error("Explicit operator approval is required before commit");
  }
  if (!input.sourceLabel.trim() || !input.sourceUrl.trim() || !input.observedAt.trim()) {
    throw new Error("sourceLabel, sourceUrl, and observedAt are required");
  }
  if (Number.isNaN(Date.parse(input.observedAt))) {
    throw new Error("observedAt must be a valid ISO-8601 timestamp");
  }
  const csvBytes = Buffer.byteLength(input.csvText, "utf8");
  if (csvBytes > STAT_COMPONENTS_MAX_CSV_BYTES) {
    throw new Error(
      `CSV exceeds ${STAT_COMPONENTS_MAX_CSV_BYTES} byte limit (${csvBytes} bytes)`,
    );
  }

  // Fresh server-side validation (no reliance on client preview state).
  const preview = await previewStatComponentsImport({
    weekId: input.weekId,
    csvText: input.csvText,
    replaceProvisional: input.replaceProvisional,
  });

  if (preview.previewToken !== input.previewToken) {
    throw new Error(
      "Stale preview: file, pool, games, week status, or existing stats changed since Preview — re-preview and approve again",
    );
  }
  if (preview.contentSha256 !== sha256Text(input.csvText)) {
    throw new Error("File content changed since Preview");
  }
  if (!preview.ready) {
    throw new Error(preview.blockers[0] ?? "Import preview is not ready");
  }
  if (preview.matched.length > STAT_COMPONENTS_MAX_ROWS) {
    throw new Error(
      `CSV exceeds ${STAT_COMPONENTS_MAX_ROWS} row limit (${preview.matched.length} matched)`,
    );
  }

  // Re-check source fields on every row match header-level operator attestation.
  for (const row of preview.matched) {
    if (
      row.sourceLabel !== input.sourceLabel.trim() ||
      row.sourceUrl !== input.sourceUrl.trim() ||
      row.observedAt !== input.observedAt.trim()
    ) {
      throw new Error(
        "CSV sourceLabel/sourceUrl/observedAt must match the approved attestation fields on every row",
      );
    }
  }

  const snapshot = await loadPoolSnapshot(input.weekId);
  const entryById = new Map(
    snapshot.entries.map((entry) => [entry.contestEntryId, entry]),
  );

  const result = await prisma.$transaction(
    async (tx) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let writes = 0;
      const touchedGameIds = new Set<string>();
      const allowTestFail =
        process.env.VITEST === "true" || process.env.NODE_ENV === "test";

      for (const row of preview.matched) {
        const entry = entryById.get(row.contestEntryId);
        if (!entry) {
          throw new Error(`Pool entry disappeared: ${row.contestEntryId}`);
        }

        // Re-read lock state inside the transaction.
        const contest = await tx.rankIQContest.findUniqueOrThrow({
          where: { id: entry.contestId },
          select: { status: true },
        });
        if (contest.status === "FINAL" || contest.status === "ARCHIVED") {
          throw new Error(`Contest became FINAL during import (${entry.name})`);
        }

        const liveEntry = await tx.contestEntry.findUniqueOrThrow({
          where: { id: entry.contestEntryId },
          include: { rankableEntry: true, game: true },
        });
        if (liveEntry.actualRank != null) {
          throw new Error(`Entry has actualRank; import refused (${entry.name})`);
        }
        if (liveEntry.game?.statsFinalizedAt != null) {
          throw new Error(`Game stats finalized; import refused (${entry.name})`);
        }

        if (entry.contestPosition === "DEF") {
          const existing = await tx.defenseWeekStat.findUnique({
            where: {
              provider_weekId_team: {
                provider: LIVE_MANUAL_PROVIDER,
                weekId: input.weekId,
                team: entry.team,
              },
            },
          });
          if (existing && !existing.isProvisional) {
            throw new Error(`Finalized DEF stats locked (${entry.name})`);
          }
          const stats = row.defenseStats!;
          const fantasyPoints = calculateDefenseLiveFantasyPoints(
            stats,
            snapshot.week.fantasyScoringVersion,
          );
          if (
            existing &&
            componentsEqual(defenseComponents({
              sacks: existing.sacks,
              interceptions: existing.interceptions,
              fumbleRecoveries: existing.fumbleRecoveries,
              defensiveTds: existing.defensiveTds,
              specialTeamsTds: existing.specialTeamsTds,
              safeties: existing.safeties,
              blockedKicks: existing.blockedKicks,
              pointsAllowed: existing.pointsAllowed,
            }), defenseComponents(stats))
          ) {
            unchanged += 1;
          } else {
            await tx.defenseWeekStat.upsert({
              where: {
                provider_weekId_team: {
                  provider: LIVE_MANUAL_PROVIDER,
                  weekId: input.weekId,
                  team: entry.team,
                },
              },
              update: {
                rankableEntryId: entry.rankableEntryId,
                gameId: entry.gameId,
                externalId: entry.externalId,
                scoringVersion: snapshot.week.fantasyScoringVersion,
                ...stats,
                fantasyPoints,
                isProvisional: true,
                leagueActualRank: null,
              },
              create: {
                provider: LIVE_MANUAL_PROVIDER,
                weekId: input.weekId,
                rankableEntryId: entry.rankableEntryId,
                gameId: entry.gameId,
                team: entry.team,
                externalId: entry.externalId,
                scoringVersion: snapshot.week.fantasyScoringVersion,
                ...stats,
                fantasyPoints,
                isProvisional: true,
              },
            });
            if (existing) updated += 1;
            else created += 1;
          }
        } else {
          const existing = await tx.playerWeekStat.findUnique({
            where: {
              provider_weekId_externalPlayerId: {
                provider: LIVE_MANUAL_PROVIDER,
                weekId: input.weekId,
                externalPlayerId: entry.externalId,
              },
            },
          });
          if (existing && !existing.isProvisional) {
            throw new Error(`Finalized player stats locked (${entry.name})`);
          }
          const stats = row.playerStats!;
          const fantasyPoints = calculatePlayerLiveFantasyPoints(
            stats,
            snapshot.week.fantasyScoringVersion,
          );
          if (
            existing &&
            componentsEqual(playerComponents({
              passingYards: existing.passingYards,
              passingTds: existing.passingTds,
              interceptions: existing.interceptions,
              rushingYards: existing.rushingYards,
              rushingTds: existing.rushingTds,
              receptions: existing.receptions,
              receivingYards: existing.receivingYards,
              receivingTds: existing.receivingTds,
              twoPointConversions: existing.twoPointConversions,
              fumblesLost: existing.fumblesLost,
              returnTds: existing.returnTds,
            }), playerComponents(stats))
          ) {
            unchanged += 1;
          } else {
            await tx.playerWeekStat.upsert({
              where: {
                provider_weekId_externalPlayerId: {
                  provider: LIVE_MANUAL_PROVIDER,
                  weekId: input.weekId,
                  externalPlayerId: entry.externalId,
                },
              },
              update: {
                rankableEntryId: entry.rankableEntryId,
                gameId: entry.gameId,
                scoringVersion: snapshot.week.fantasyScoringVersion,
                ...stats,
                fantasyPoints,
                isProvisional: true,
                leagueActualRank: null,
              },
              create: {
                provider: LIVE_MANUAL_PROVIDER,
                weekId: input.weekId,
                rankableEntryId: entry.rankableEntryId,
                gameId: entry.gameId,
                externalPlayerId: entry.externalId,
                scoringVersion: snapshot.week.fantasyScoringVersion,
                ...stats,
                fantasyPoints,
                isProvisional: true,
              },
            });
            if (existing) updated += 1;
            else created += 1;
          }
        }

        await tx.contestEntry.update({
          where: { id: entry.contestEntryId },
          data: {
            fantasyPoints: row.fantasyPoints,
            // Preserve any existing actualRank (should be null for importable rows).
            actualRank: liveEntry.actualRank,
          },
        });

        if (entry.gameId) touchedGameIds.add(entry.gameId);

        if (row.action !== "unchanged") {
          writes += 1;
          if (
            allowTestFail &&
            input.__testFailAfterWrites != null &&
            writes >= input.__testFailAfterWrites
          ) {
            throw new Error("TEST_FORCED_ROLLBACK");
          }
        }
      }

      for (const gameId of touchedGameIds) {
        const game = await tx.nflGame.findUniqueOrThrow({ where: { id: gameId } });
        if (game.statsFinalizedAt != null) {
          throw new Error(`Game ${game.externalId} was finalized during import`);
        }
        if (game.status === "SCHEDULED") {
          await tx.nflGame.update({
            where: { id: gameId },
            data: { status: "IN_PROGRESS" },
          });
        }
      }

      const importLog = await tx.manualImportLog.create({
        data: {
          adminUserId: input.adminUserId,
          weekId: input.weekId,
          importType: STAT_COMPONENTS_IMPORT_TYPE,
          rowCount: preview.matched.length,
          createdCount: created,
          updatedCount: updated,
          excludedCount: unchanged,
          warnings: preview.warnings,
          metadata: {
            formatVersion: STAT_COMPONENTS_FORMAT_VERSION,
            contentSha256: preview.contentSha256,
            previewToken: input.previewToken,
            sourceLabel: input.sourceLabel.trim(),
            sourceUrl: input.sourceUrl.trim(),
            observedAt: input.observedAt.trim(),
            scoringVersion: preview.scoringVersion,
            coverage: preview.coverage,
            unchanged,
          } satisfies Prisma.InputJsonValue,
        },
      });

      // Audit must commit atomically with stats — never leave a successful
      // import without its AdminAuditLog row.
      const audit = await tx.adminAuditLog.create({
        data: {
          adminUserId: input.adminUserId,
          action: "live_scoring.stat_components_imported",
          entityType: "Week",
          entityId: input.weekId,
          metadata: {
            importLogId: importLog.id,
            created,
            updated,
            unchanged,
            contentSha256: preview.contentSha256,
            previewToken: input.previewToken,
            sourceLabel: input.sourceLabel.trim(),
            sourceUrl: input.sourceUrl.trim(),
            observedAt: input.observedAt.trim(),
            replaceProvisional: Boolean(input.replaceProvisional),
            scoringVersion: preview.scoringVersion,
            coverage: preview.coverage,
            formatVersion: STAT_COMPONENTS_FORMAT_VERSION,
          } satisfies Prisma.InputJsonValue,
        },
      });

      return {
        created,
        updated,
        unchanged,
        importLogId: importLog.id,
        auditLogId: audit.id,
      };
    },
    { timeout: 120_000 },
  );

  return {
    ...result,
    contentSha256: preview.contentSha256,
  };
}
