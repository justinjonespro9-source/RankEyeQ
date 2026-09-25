/**
 * Incremental in-season NFL.com roster *status* refresh.
 *
 * Unlike bootstrapSeasonRosterFromNflCom this does NOT:
 * - create RankableEntries
 * - deactivate duplicates
 * - rewrite ContestEntries / RankingPicks / historical weeks
 * - change teams without a confident externalId match
 *
 * Identity match order: externalId → unique name+team → unique alias+team.
 * Conflicts are classified and skipped on apply.
 */

import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { mapNflComStatusToSeasonFields } from "@/lib/nfl/roster-status";
import {
  normalizePlayerName,
  playerNamesCanMerge,
} from "@/lib/nfl/player-identity";
import { parsePlayerAliases } from "@/lib/nfl/player-aliases";
import {
  fetchNormalizedNflComRosters,
  NFL_COM_BOOTSTRAP_PROVIDER,
  type FetchLike,
  type NormalizedRosterBundle,
  type NormalizedRosterPlayer,
} from "@/lib/providers/nfl/nflcom/fetch-rosters";

export const ROSTER_SYNC_SOURCE_LABEL =
  "NFL.com team roster pages (incremental status sync)";

/** Warn operators when Season.rosterSyncedAt is older than this. */
export const ROSTER_STALE_AFTER_MS = 72 * 60 * 60 * 1000;

export type RosterIdentityMatchClass =
  | "MATCHED"
  | "UNMATCHED"
  | "AMBIGUOUS"
  | "TEAM_CONFLICT"
  | "IDENTITY_CONFLICT";

export type RosterStatusPoolEntry = {
  rankableEntryId: string;
  seasonPlayerId: string;
  name: string;
  team: string;
  position: ContestPosition;
  externalId: string;
  provider: string;
  adminNotes: string | null;
  nflStatus: string;
  sourceNflStatus: string | null;
  activeOnNFLRoster: boolean;
};

export type RosterStatusMatch = {
  matchClass: RosterIdentityMatchClass;
  pool: RosterStatusPoolEntry;
  live: NormalizedRosterPlayer | null;
  previous: {
    nflStatus: string;
    sourceNflStatus: string | null;
    activeOnNFLRoster: boolean;
  };
  next: {
    nflStatus: string;
    sourceNflStatus: string;
    activeOnNFLRoster: boolean;
  } | null;
  changed: boolean;
  reason?: string;
};

export type RosterStatusSyncSummary = {
  ok: boolean;
  apply: boolean;
  syncedAt: Date;
  source: string;
  teamCount: number;
  liveFantasyPlayers: number;
  poolSize: number;
  matched: number;
  unchanged: number;
  updated: number;
  skippedConflicts: number;
  unmatchedLive: number;
  byNextStatus: Record<string, number>;
  matches: RosterStatusMatch[];
  fetchErrors: Array<{ team: string; url: string; error: string }>;
  errors: string[];
};

function countByStatus(matches: RosterStatusMatch[]) {
  const counts: Record<string, number> = {};
  for (const m of matches) {
    if (m.matchClass !== "MATCHED" || !m.next || !m.changed) continue;
    counts[m.next.nflStatus] = (counts[m.next.nflStatus] ?? 0) + 1;
  }
  return counts;
}

export function matchRosterPlayerToPool(
  live: NormalizedRosterPlayer,
  pool: RosterStatusPoolEntry[],
): Omit<RosterStatusMatch, "previous" | "next" | "changed"> & {
  poolEntry: RosterStatusPoolEntry | null;
} {
  const scoped = pool.filter((p) => p.position === live.fantasyPosition);

  if (live.externalId) {
    const byExt = scoped.filter(
      (p) =>
        p.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
        p.externalId === live.externalId,
    );
    if (byExt.length === 1) {
      const hit = byExt[0]!;
      if (hit.team !== live.team) {
        return {
          matchClass: "TEAM_CONFLICT",
          pool: hit,
          poolEntry: hit,
          live,
          reason: `DB team ${hit.team} vs live ${live.team}`,
        };
      }
      return { matchClass: "MATCHED", pool: hit, poolEntry: hit, live };
    }
    if (byExt.length > 1) {
      return {
        matchClass: "AMBIGUOUS",
        pool: byExt[0]!,
        poolEntry: null,
        live,
        reason: "Multiple externalId hits",
      };
    }
  }

  const normalized = normalizePlayerName(live.name);
  const exact = scoped.filter(
    (p) =>
      p.team === live.team && normalizePlayerName(p.name) === normalized,
  );
  if (exact.length === 1) {
    return {
      matchClass: "MATCHED",
      pool: exact[0]!,
      poolEntry: exact[0]!,
      live,
    };
  }
  if (exact.length > 1) {
    return {
      matchClass: "AMBIGUOUS",
      pool: exact[0]!,
      poolEntry: null,
      live,
      reason: "Multiple name+team hits",
    };
  }

  const aliasHits = scoped.filter((p) => {
    if (p.team !== live.team) return false;
    const aliases = parsePlayerAliases(p.adminNotes);
    return (
      playerNamesCanMerge(p.name, live.name) ||
      aliases.some((a) => playerNamesCanMerge(a, live.name))
    );
  });
  if (aliasHits.length === 1) {
    return {
      matchClass: "MATCHED",
      pool: aliasHits[0]!,
      poolEntry: aliasHits[0]!,
      live,
    };
  }
  if (aliasHits.length > 1) {
    return {
      matchClass: "AMBIGUOUS",
      pool: aliasHits[0]!,
      poolEntry: null,
      live,
      reason: "Multiple alias hits",
    };
  }

  // Same externalId wrong team already handled; same name different team:
  const nameOnly = scoped.filter(
    (p) => normalizePlayerName(p.name) === normalized,
  );
  if (nameOnly.length >= 1) {
    return {
      matchClass: "IDENTITY_CONFLICT",
      pool: nameOnly[0]!,
      poolEntry: null,
      live,
      reason: `Name match without team agreement (live ${live.team})`,
    };
  }

  return {
    matchClass: "UNMATCHED",
    pool: pool[0]!,
    poolEntry: null,
    live,
  };
}

export async function loadSeasonRosterStatusPool(seasonId: string) {
  const rows = await prisma.seasonPlayer.findMany({
    where: {
      seasonId,
      position: { in: ["QB", "RB", "WR", "TE"] },
    },
    select: {
      id: true,
      nflStatus: true,
      sourceNflStatus: true,
      activeOnNFLRoster: true,
      team: true,
      position: true,
      rankableEntry: {
        select: {
          id: true,
          name: true,
          team: true,
          position: true,
          externalId: true,
          provider: true,
          adminNotes: true,
        },
      },
    },
  });

  return rows.map((row): RosterStatusPoolEntry => ({
    rankableEntryId: row.rankableEntry.id,
    seasonPlayerId: row.id,
    name: row.rankableEntry.name,
    team: row.team || row.rankableEntry.team,
    position: row.position,
    externalId: row.rankableEntry.externalId,
    provider: row.rankableEntry.provider,
    adminNotes: row.rankableEntry.adminNotes,
    nflStatus: row.nflStatus,
    sourceNflStatus: row.sourceNflStatus,
    activeOnNFLRoster: row.activeOnNFLRoster,
  }));
}

/** Stable identity keys for conflict suppression (externalId first). */
export function rosterIdentityKeys(entry: {
  externalId?: string | null;
  seasonPlayerId?: string | null;
  rankableEntryId?: string | null;
}): string[] {
  const keys: string[] = [];
  const ext = entry.externalId?.trim();
  if (ext) keys.push(`ext:${ext}`);
  if (entry.seasonPlayerId) keys.push(`sp:${entry.seasonPlayerId}`);
  if (entry.rankableEntryId) keys.push(`re:${entry.rankableEntryId}`);
  return keys;
}

function liveRowLabel(live: NormalizedRosterPlayer | null | undefined) {
  if (!live) return "unknown";
  return `${live.team}/${live.sourceStatus}`;
}

/**
 * If ANY TEAM_CONFLICT (or same-externalId IDENTITY_CONFLICT) touches a
 * canonical identity, suppress ALL roster-status writes for that identity.
 *
 * Name-only IDENTITY_CONFLICT against a different externalId must NOT suppress
 * a clean match for another person.
 */
export function applyConflictWriteSuppression(
  matches: RosterStatusMatch[],
): RosterStatusMatch[] {
  const conflictedKeys = new Set<string>();
  const rowsByKey = new Map<string, string[]>();

  const remember = (keys: string[], row: string) => {
    for (const key of keys) {
      conflictedKeys.add(key);
      const list = rowsByKey.get(key) ?? [];
      if (!list.includes(row)) list.push(row);
      rowsByKey.set(key, list);
    }
  };

  for (const m of matches) {
    const row = liveRowLabel(m.live);
    if (m.matchClass === "TEAM_CONFLICT") {
      remember(
        [
          ...rosterIdentityKeys(m.pool),
          ...(m.live?.externalId?.trim()
            ? [`ext:${m.live.externalId.trim()}`]
            : []),
        ],
        row,
      );
      continue;
    }
    // Same external ID on both sides without team agreement — treat as conflict.
    if (
      m.matchClass === "IDENTITY_CONFLICT" &&
      m.live?.externalId?.trim() &&
      m.pool.externalId?.trim() &&
      m.live.externalId.trim() === m.pool.externalId.trim()
    ) {
      remember(rosterIdentityKeys(m.pool), row);
    }
  }

  if (conflictedKeys.size === 0) return matches;

  return matches.map((m) => {
    const keys = [
      ...rosterIdentityKeys(m.pool),
      ...(m.live?.externalId?.trim()
        ? [`ext:${m.live.externalId.trim()}`]
        : []),
    ];
    const hit = keys.some((k) => conflictedKeys.has(k));
    if (!hit) return m;

    const conflictingRows = [
      ...new Set(keys.flatMap((k) => rowsByKey.get(k) ?? [])),
    ];
    if (m.live) {
      const self = liveRowLabel(m.live);
      if (!conflictingRows.includes(self)) conflictingRows.unshift(self);
    }

    const reason = `SKIP — TEAM/IDENTITY CONFLICT. Conflicting live rows: ${conflictingRows.join("; ")}. No roster-status write.`;

    // Non-MATCHED conflict rows keep class; MATCHED writes are suppressed.
    if (m.matchClass !== "MATCHED") {
      return {
        ...m,
        next: null,
        changed: false,
        reason: m.reason?.includes("SKIP — TEAM/IDENTITY CONFLICT")
          ? m.reason
          : reason,
      };
    }

    return {
      ...m,
      matchClass: "TEAM_CONFLICT",
      next: null,
      changed: false,
      reason,
    };
  });
}

export function buildRosterStatusMatches(
  pool: RosterStatusPoolEntry[],
  livePlayers: NormalizedRosterPlayer[],
): RosterStatusMatch[] {
  const matches: RosterStatusMatch[] = [];
  const claimed = new Set<string>();

  for (const live of livePlayers) {
    const result = matchRosterPlayerToPool(live, pool);
    if (result.matchClass !== "MATCHED" || !result.poolEntry) {
      if (result.matchClass === "UNMATCHED") continue;
      matches.push({
        matchClass: result.matchClass,
        pool: result.pool,
        live,
        previous: {
          nflStatus: result.pool.nflStatus,
          sourceNflStatus: result.pool.sourceNflStatus,
          activeOnNFLRoster: result.pool.activeOnNFLRoster,
        },
        next: null,
        changed: false,
        reason: result.reason,
      });
      continue;
    }

    const entry = result.poolEntry;
    if (claimed.has(entry.rankableEntryId)) {
      matches.push({
        matchClass: "AMBIGUOUS",
        pool: entry,
        live,
        previous: {
          nflStatus: entry.nflStatus,
          sourceNflStatus: entry.sourceNflStatus,
          activeOnNFLRoster: entry.activeOnNFLRoster,
        },
        next: null,
        changed: false,
        reason: "Pool entry already claimed by another live row",
      });
      continue;
    }
    claimed.add(entry.rankableEntryId);

    const mapped = mapNflComStatusToSeasonFields(live.sourceStatus);
    const next = {
      nflStatus: mapped.nflStatus,
      sourceNflStatus: live.sourceStatus,
      activeOnNFLRoster: mapped.activeOnNFLRoster,
    };
    const changed =
      entry.nflStatus !== next.nflStatus ||
      (entry.sourceNflStatus ?? "") !== next.sourceNflStatus ||
      entry.activeOnNFLRoster !== next.activeOnNFLRoster;

    matches.push({
      matchClass: "MATCHED",
      pool: entry,
      live,
      previous: {
        nflStatus: entry.nflStatus,
        sourceNflStatus: entry.sourceNflStatus,
        activeOnNFLRoster: entry.activeOnNFLRoster,
      },
      next,
      changed,
    });
  }

  return applyConflictWriteSuppression(matches);
}

export async function syncCurrentSeasonRosterStatusesFromNflCom(input: {
  seasonId: string;
  apply?: boolean;
  bundle?: NormalizedRosterBundle;
  fetchFn?: FetchLike;
}): Promise<RosterStatusSyncSummary> {
  const apply = input.apply === true;
  const errors: string[] = [];

  let bundle: NormalizedRosterBundle;
  try {
    bundle =
      input.bundle ??
      (await fetchNormalizedNflComRosters({ fetchFn: input.fetchFn }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch NFL.com rosters";
    return {
      ok: false,
      apply,
      syncedAt: new Date(),
      source: "none",
      teamCount: 0,
      liveFantasyPlayers: 0,
      poolSize: 0,
      matched: 0,
      unchanged: 0,
      updated: 0,
      skippedConflicts: 0,
      unmatchedLive: 0,
      byNextStatus: {},
      matches: [],
      fetchErrors: [],
      errors: [message],
    };
  }

  const pool = await loadSeasonRosterStatusPool(input.seasonId);
  const matches = buildRosterStatusMatches(pool, bundle.players);

  let matched = 0;
  let unchanged = 0;
  let updated = 0;
  let skippedConflicts = 0;
  let unmatchedLive = 0;

  for (const m of matches) {
    if (m.matchClass === "MATCHED") {
      matched += 1;
      if (!m.changed || !m.next) {
        unchanged += 1;
        continue;
      }
      if (!apply) {
        updated += 1;
        continue;
      }
      try {
        await prisma.seasonPlayer.update({
          where: { id: m.pool.seasonPlayerId },
          data: {
            nflStatus: m.next.nflStatus,
            sourceNflStatus: m.next.sourceNflStatus,
            activeOnNFLRoster: m.next.activeOnNFLRoster,
          },
        });
        updated += 1;
      } catch (error) {
        errors.push(
          `${m.pool.name}: ${
            error instanceof Error ? error.message : "update failed"
          }`,
        );
      }
      continue;
    }
    if (m.matchClass === "UNMATCHED") {
      unmatchedLive += 1;
      continue;
    }
    skippedConflicts += 1;
  }

  // Live players with no match at all aren't in matches when UNMATCHED skipped above
  // Count unmatched as live players not claiming a pool MATCHED row.
  const matchedLiveIds = new Set(
    matches
      .filter((m) => m.matchClass === "MATCHED" && m.live)
      .map((m) => m.live!.externalId || `${m.live!.name}|${m.live!.team}`),
  );
  unmatchedLive = bundle.players.filter(
    (p) => !matchedLiveIds.has(p.externalId || `${p.name}|${p.team}`),
  ).length;

  if (apply && errors.length === 0) {
    await prisma.season.update({
      where: { id: input.seasonId },
      data: {
        rosterSyncedAt: bundle.syncedAt,
        rosterSyncSource: ROSTER_SYNC_SOURCE_LABEL,
      },
    });
  }

  return {
    ok: errors.length === 0 && bundle.fetchErrors.length < 32,
    apply,
    syncedAt: bundle.syncedAt,
    source: bundle.source,
    teamCount: bundle.teamCount,
    liveFantasyPlayers: bundle.players.length,
    poolSize: pool.length,
    matched,
    unchanged,
    updated,
    skippedConflicts,
    unmatchedLive,
    byNextStatus: countByStatus(matches),
    matches,
    fetchErrors: bundle.fetchErrors,
    errors,
  };
}
