import { prisma } from "@/lib/db";
import type { ContestPosition, Prisma } from "@/lib/generated/prisma/client";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  parsePlayerNameIdentity,
  pickPreferredRankableEntry,
  playerIdentityGroupKey,
  playerNamesCanMerge,
} from "@/lib/nfl/player-identity";

export type DuplicateCandidateGroup = {
  groupKey: string;
  position: ContestPosition;
  entries: Array<{
    id: string;
    name: string;
    team: string;
    provider: string;
    externalId: string;
    active: boolean;
    seasonTeams: string[];
    sourceStatuses: string[];
  }>;
  suggestedCanonicalId: string | null;
  confidence: "confirmed" | "ambiguous" | "legitimate_same_name";
  reason: string;
};

export type ConsolidationReport = {
  groupsFound: number;
  merged: number;
  ambiguous: number;
  legitimateSameName: number;
  referencesRepointed: number;
  identitiesDeactivated: number;
  details: Array<{
    canonicalId: string;
    duplicateId: string;
    name: string;
    reason: string;
  }>;
};

type Tx = Prisma.TransactionClient;

async function repointReferences(tx: Tx, canonicalId: string, duplicateId: string) {
  let repointed = 0;

  const seasonRows = await tx.seasonPlayer.findMany({
    where: { rankableEntryId: duplicateId },
  });
  for (const row of seasonRows) {
    const existing = await tx.seasonPlayer.findUnique({
      where: {
        seasonId_rankableEntryId: {
          seasonId: row.seasonId,
          rankableEntryId: canonicalId,
        },
      },
    });
    if (existing) {
      await tx.seasonPlayer.delete({ where: { id: row.id } });
    } else {
      await tx.seasonPlayer.update({
        where: { id: row.id },
        data: { rankableEntryId: canonicalId },
      });
      repointed += 1;
    }
  }

  const contestRows = await tx.contestEntry.findMany({
    where: { rankableEntryId: duplicateId },
  });
  for (const row of contestRows) {
    const existing = await tx.contestEntry.findUnique({
      where: {
        contestId_rankableEntryId: {
          contestId: row.contestId,
          rankableEntryId: canonicalId,
        },
      },
    });
    if (existing) {
      await tx.contestEntry.update({
        where: { id: row.id },
        data: {
          excluded: true,
          inactiveReason: "Merged duplicate player identity",
        },
      });
    } else {
      await tx.contestEntry.update({
        where: { id: row.id },
        data: { rankableEntryId: canonicalId },
      });
      repointed += 1;
    }
  }

  const rankingPicks = await tx.rankingPick.findMany({
    where: { rankableEntryId: duplicateId },
  });
  for (const row of rankingPicks) {
    const existing = await tx.rankingPick.findFirst({
      where: {
        submissionId: row.submissionId,
        rankableEntryId: canonicalId,
      },
    });
    if (existing) {
      await tx.rankingPick.delete({ where: { id: row.id } });
    } else {
      await tx.rankingPick.update({
        where: { id: row.id },
        data: { rankableEntryId: canonicalId },
      });
      repointed += 1;
    }
  }

  const repointSimple = async (
    model: "playerWeekStat" | "defenseWeekStat" | "benchmarkSnapshotPick" | "contestPregameSnapshotEntry",
    field: "rankableEntryId",
  ) => {
    const rows = await (tx[model] as {
      findMany: (args: object) => Promise<Array<{ id: string }>>;
      update: (args: object) => Promise<unknown>;
    }).findMany({
      where: { [field]: duplicateId },
      select: { id: true },
    });
    for (const row of rows) {
      await (tx[model] as { update: (args: object) => Promise<unknown> }).update({
        where: { id: row.id },
        data: { [field]: canonicalId },
      });
      repointed += 1;
    }
  };

  await repointSimple("playerWeekStat", "rankableEntryId");
  await repointSimple("defenseWeekStat", "rankableEntryId");
  await repointSimple("benchmarkSnapshotPick", "rankableEntryId");
  await repointSimple("contestPregameSnapshotEntry", "rankableEntryId");

  return repointed;
}

export async function mergeRankableEntryIntoCanonical(input: {
  canonicalId: string;
  duplicateId: string;
  reason: string;
  tx?: Tx;
}) {
  if (input.canonicalId === input.duplicateId) {
    return { repointed: 0 };
  }

  const run = async (tx: Tx) => {
    const repointed = await repointReferences(tx, input.canonicalId, input.duplicateId);
    await tx.rankableEntry.update({
      where: { id: input.duplicateId },
      data: {
        active: false,
        adminNotes: `Merged into ${input.canonicalId}: ${input.reason}`,
      },
    });
    return { repointed };
  };

  if (input.tx) return run(input.tx);
  return prisma.$transaction(run);
}

export async function auditPlayerDuplicateGroups(input?: {
  seasonYear?: number;
  names?: string[];
}): Promise<DuplicateCandidateGroup[]> {
  const seasonYear = input?.seasonYear ?? 2026;
  const season = await prisma.season.findFirst({
    where: { year: seasonYear, sport: "NFL" },
  });

  const entries = await prisma.rankableEntry.findMany({
    where: {
      type: "PLAYER",
      ...(input?.names
        ? {
            OR: input.names.map((name) => ({
              name: { contains: name, mode: "insensitive" as const },
            })),
          }
        : {}),
    },
    include: {
      seasonPlayers: season
        ? { where: { seasonId: season.id } }
        : false,
    },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });

  const byExternal = new Map<string, typeof entries>();
  const byIdentity = new Map<string, typeof entries>();

  for (const entry of entries) {
    if (entry.provider === NFL_COM_BOOTSTRAP_PROVIDER) {
      const key = `${entry.position}|${entry.externalId}`;
      const list = byExternal.get(key) ?? [];
      list.push(entry);
      byExternal.set(key, list);
    }

    const identityKey = playerIdentityGroupKey(entry.name, entry.position);
    const list = byIdentity.get(identityKey) ?? [];
    list.push(entry);
    byIdentity.set(identityKey, list);
  }

  const groups = new Map<string, DuplicateCandidateGroup>();

  function addGroup(
    key: string,
    position: ContestPosition,
    rows: typeof entries,
    confidence: DuplicateCandidateGroup["confidence"],
    reason: string,
  ) {
    if (rows.length < 2) return;
    const suggested = pickPreferredRankableEntry(
      rows,
      rows.find((row) => row.provider === NFL_COM_BOOTSTRAP_PROVIDER)?.externalId,
    );
    groups.set(key, {
      groupKey: key,
      position,
      entries: rows.map((row) => ({
        id: row.id,
        name: row.name,
        team: row.team,
        provider: row.provider,
        externalId: row.externalId,
        active: row.active,
        seasonTeams:
          row.seasonPlayers?.map((sp) => sp.team) ??
          [],
        sourceStatuses:
          row.seasonPlayers?.map((sp) => sp.sourceNflStatus ?? sp.nflStatus) ??
          [],
      })),
      suggestedCanonicalId: suggested?.id ?? null,
      confidence,
      reason,
    });
  }

  for (const [key, rows] of byExternal) {
    if (rows.length > 1) {
      addGroup(`external:${key}`, rows[0]!.position, rows, "confirmed", "duplicate externalId");
    }
  }

  for (const [identityKey, rows] of byIdentity) {
    if (rows.length < 2) continue;

    const nflcom = rows.filter((row) => row.provider === NFL_COM_BOOTSTRAP_PROVIDER);
    const legacy = rows.filter((row) => row.provider !== NFL_COM_BOOTSTRAP_PROVIDER);

    if (nflcom.length === 1 && legacy.length > 0) {
      const canonical = nflcom[0]!;
      const mergeableLegacy = legacy.filter((row) =>
        playerNamesCanMerge(row.name, canonical.name),
      );
      if (mergeableLegacy.length > 0) {
        addGroup(
          `identity:${identityKey}`,
          canonical.position,
          [canonical, ...mergeableLegacy],
          "confirmed",
          "nflcom-bootstrap canonical with legacy/mock duplicate",
        );
        continue;
      }
    }

    if (nflcom.length > 1) {
      addGroup(
        `identity:${identityKey}`,
        rows[0]!.position,
        rows,
        "ambiguous",
        "multiple nflcom-bootstrap identities",
      );
      continue;
    }

    if (nflcom.length === 0 && legacy.length > 1) {
      const activeLegacy = legacy.filter((row) => row.active);
      if (activeLegacy.length > 1) {
        addGroup(
          `identity:${identityKey}`,
          rows[0]!.position,
          activeLegacy,
          "confirmed",
          "multiple active legacy-only identities",
        );
        continue;
      }
    }

    const active = rows.filter((row) => row.active);
    if (active.length > 1) {
      const distinctExternal = new Set(
        active.map((row) => row.externalId).filter(Boolean),
      );
      if (distinctExternal.size > 1) {
        addGroup(
          `identity:${identityKey}`,
          rows[0]!.position,
          active,
          "legitimate_same_name",
          "same normalized name with distinct provider IDs",
        );
        continue;
      }
      addGroup(
        `identity:${identityKey}`,
        rows[0]!.position,
        rows,
        "confirmed",
        "multiple active legacy identities",
      );
    }
  }

  return [...groups.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey));
}

export async function consolidateConfirmedPlayerDuplicates(input?: {
  seasonYear?: number;
  dryRun?: boolean;
}): Promise<ConsolidationReport> {
  const groups = await auditPlayerDuplicateGroups({
    seasonYear: input?.seasonYear,
  });
  const confirmed = groups.filter((group) => group.confidence === "confirmed");

  const report: ConsolidationReport = {
    groupsFound: groups.length,
    merged: 0,
    ambiguous: groups.filter((group) => group.confidence === "ambiguous").length,
    legitimateSameName: groups.filter(
      (group) => group.confidence === "legitimate_same_name",
    ).length,
    referencesRepointed: 0,
    identitiesDeactivated: 0,
    details: [],
  };

  for (const group of confirmed) {
    const canonicalId =
      group.suggestedCanonicalId ??
      group.entries.find((entry) => entry.provider === "nflcom-bootstrap")?.id ??
      group.entries[0]?.id;
    if (!canonicalId) continue;

    const duplicates = group.entries.filter((entry) => entry.id !== canonicalId);
    for (const duplicate of duplicates) {
      if (input?.dryRun) {
        report.details.push({
          canonicalId,
          duplicateId: duplicate.id,
          name: duplicate.name,
          reason: group.reason,
        });
        report.merged += 1;
        continue;
      }

      const result = await mergeRankableEntryIntoCanonical({
        canonicalId,
        duplicateId: duplicate.id,
        reason: group.reason,
      });
      report.referencesRepointed += result.repointed;
      report.identitiesDeactivated += 1;
      report.merged += 1;
      report.details.push({
        canonicalId,
        duplicateId: duplicate.id,
        name: duplicate.name,
        reason: group.reason,
      });
    }
  }

  return report;
}

export function explainIdentityDifference(left: string, right: string) {
  return {
    left: parsePlayerNameIdentity(left),
    right: parsePlayerNameIdentity(right),
    canMerge: playerNamesCanMerge(left, right),
  };
}
