import { prisma } from "@/lib/db";
import { addPlayerAliases, parsePlayerAliases } from "@/lib/nfl/player-aliases";
import { mergeRankableEntryIntoCanonical } from "@/lib/nfl/player-consolidation";

export type PlayerIdentityMergeResult = {
  canonicalId: string;
  duplicateIds: string[];
  displayName: string;
  aliases: string[];
  referencesRepointed: number;
};

/**
 * Merge duplicate rankable identities into one canonical player.
 * Preserves historical ContestEntry.weekTeam and stores import aliases on canonical.
 */
export async function mergePlayerIdentities(input: {
  canonicalId: string;
  duplicateIds: string[];
  displayName: string;
  aliases?: string[];
}): Promise<PlayerIdentityMergeResult> {
  const canonical = await prisma.rankableEntry.findUniqueOrThrow({
    where: { id: input.canonicalId },
  });

  let referencesRepointed = 0;
  const mergedIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const duplicateId of input.duplicateIds) {
      if (duplicateId === input.canonicalId) continue;
      const result = await mergeRankableEntryIntoCanonical({
        canonicalId: input.canonicalId,
        duplicateId,
        reason: `Merged into canonical identity ${input.canonicalId}`,
        tx,
      });
      referencesRepointed += result.repointed;
      mergedIds.push(duplicateId);
    }

    const aliasSet = new Set([
      ...(input.aliases ?? []),
      ...mergedIds.length
        ? (
            await tx.rankableEntry.findMany({
              where: { id: { in: mergedIds } },
              select: { name: true },
            })
          ).map((row) => row.name)
        : [],
    ]);
    aliasSet.delete(input.displayName);

    await tx.rankableEntry.update({
      where: { id: input.canonicalId },
      data: {
        name: input.displayName,
        shortName: input.displayName.split(/\s+/).pop() ?? input.displayName,
        active: true,
        adminNotes: addPlayerAliases(canonical.adminNotes, [...aliasSet]),
      },
    });

    await tx.seasonPlayer.updateMany({
      where: { rankableEntryId: input.canonicalId },
      data: { displayName: input.displayName },
    });
  });

  const canonicalRow = await prisma.rankableEntry.findUniqueOrThrow({
    where: { id: input.canonicalId },
  });

  return {
    canonicalId: input.canonicalId,
    duplicateIds: mergedIds,
    displayName: input.displayName,
    aliases: parsePlayerAliases(canonicalRow.adminNotes),
    referencesRepointed,
  };
}

export async function mergeAaronJonesIdentities() {
  const entries = await prisma.rankableEntry.findMany({
    where: {
      type: "PLAYER",
      position: "RB",
      OR: [
        { name: { contains: "Aaron Jones", mode: "insensitive" } },
        { externalId: "aaron-jones" },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const canonical =
    entries.find(
      (row) =>
        row.provider === "nflcom-bootstrap" && row.externalId === "aaron-jones",
    ) ??
    entries.find((row) => row.name === "Aaron Jones" && row.active) ??
    entries.find((row) => row.name === "Aaron Jones");

  if (!canonical) {
    throw new Error("Canonical Aaron Jones entry not found");
  }

  const duplicates = entries
    .filter((row) => row.id !== canonical.id)
    .map((row) => row.id);

  return mergePlayerIdentities({
    canonicalId: canonical.id,
    duplicateIds: duplicates,
    displayName: "Aaron Jones",
    aliases: ["Aaron Jones Sr.", "Aaron Jones, Sr."],
  });
}

export async function mergeBrianRobinsonIdentities() {
  const entries = await prisma.rankableEntry.findMany({
    where: {
      type: "PLAYER",
      name: { contains: "Brian Robinson", mode: "insensitive" },
      position: "RB",
    },
    orderBy: { createdAt: "asc" },
  });

  const canonical =
    entries.find(
      (row) => row.provider === "nflcom-bootstrap" && row.name === "Brian Robinson",
    ) ?? entries.find((row) => row.name === "Brian Robinson");

  if (!canonical) {
    throw new Error("Canonical Brian Robinson entry not found");
  }

  const duplicates = entries
    .filter((row) => row.id !== canonical.id)
    .map((row) => row.id);

  const result = await mergePlayerIdentities({
    canonicalId: canonical.id,
    duplicateIds: duplicates,
    displayName: "Brian Robinson",
    aliases: ["Brian Robinson Jr.", "Brian Robinson, Jr."],
  });

  return {
    ...result,
    aliases: result.aliases,
  };
}
