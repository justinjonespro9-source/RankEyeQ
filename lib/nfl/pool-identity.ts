import type { ContestPosition, RankableEntryType } from "@/lib/generated/prisma/client";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { defenseEntryIdentityKey } from "@/lib/nfl/defense-identity";
import {
  pickPreferredRankableEntry,
  playerIdentityGroupKey,
  playerNamesCanMerge,
} from "@/lib/nfl/player-identity";

export type PoolIdentityMeta = {
  name: string;
  position: ContestPosition;
  provider: string;
  externalId: string;
  team: string;
  type: string;
};

/** Canonical identity key for an active weekly pool row. */
export function poolEntryIdentityKey(input: PoolIdentityMeta): string {
  if (input.position === "DEF") {
    return defenseEntryIdentityKey(input);
  }
  if (
    input.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
    input.externalId &&
    !input.externalId.includes("-merge-")
  ) {
    return `${input.position}|nflcom:${input.externalId}`;
  }
  return playerIdentityGroupKey(input.name, input.position);
}

export function groupPoolRowsByIdentity<
  T extends { meta: PoolIdentityMeta },
>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  const add = (key: string, row: T) => {
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  };

  for (const row of rows) {
    add(poolEntryIdentityKey(row.meta), row);
  }

  let merged = true;
  while (merged) {
    merged = false;
    const keys = [...groups.keys()];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const leftKey = keys[i]!;
        const rightKey = keys[j]!;
        const left = groups.get(leftKey) ?? [];
        const right = groups.get(rightKey) ?? [];
        if (left.length === 0 || right.length === 0) continue;
        const sampleLeft = left[0]!.meta;
        const sampleRight = right[0]!.meta;
        if (
          sampleLeft.position === sampleRight.position &&
          playerNamesCanMerge(sampleLeft.name, sampleRight.name)
        ) {
          groups.set(`merged:${leftKey}:${rightKey}`, [...left, ...right]);
          groups.delete(leftKey);
          groups.delete(rightKey);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  return groups;
}

export function pickPreferredPoolRow<
  T extends {
    meta: PoolIdentityMeta;
    rankableEntryId: string;
    manuallyAdded?: boolean;
  },
>(rows: T[]): T {
  const preferred = pickPreferredRankableEntry(
    rows.map((row) => ({
      id: row.rankableEntryId,
      name: row.meta.name,
      team: row.meta.team,
      position: row.meta.position,
      provider: row.meta.provider,
      externalId: row.meta.externalId,
      type: row.meta.type as RankableEntryType,
      active: true,
      shortName: row.meta.name,
      opponent: "",
      availability: "ACTIVE",
      headshotUrl: null,
      gameId: null,
      gameStartsAt: null,
      adminNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    rows.find((row) => row.meta.provider === NFL_COM_BOOTSTRAP_PROVIDER)?.meta
      .externalId,
  );
  return (
    rows.find((row) => row.rankableEntryId === preferred?.id) ??
    rows.find((row) => !row.manuallyAdded) ??
    rows[0]!
  );
}
