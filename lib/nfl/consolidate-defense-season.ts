import { prisma } from "@/lib/db";
import {
  canonicalDefenseExternalId,
  defenseFranchiseKey,
  isCanonicalDefenseRankableEntry,
} from "@/lib/nfl/defense-identity";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { NFL_TEAMS } from "@/lib/nfl-schedule";

export type DefenseSeasonConsolidationReport = {
  franchises: number;
  seasonPlayersRemoved: number;
  rankableDeactivated: number;
  details: string[];
};

/**
 * Ensure each NFL franchise has one canonical DEF SeasonPlayer (nflcom-bootstrap def-{TEAM}).
 * Removes duplicate legacy/mock/manual DEF season rows.
 */
export async function consolidateDefenseSeasonPlayers(
  seasonId: string,
): Promise<DefenseSeasonConsolidationReport> {
  const report: DefenseSeasonConsolidationReport = {
    franchises: 0,
    seasonPlayersRemoved: 0,
    rankableDeactivated: 0,
    details: [],
  };

  await prisma.$transaction(async (tx) => {
    for (const team of NFL_TEAMS) {
      const franchise = defenseFranchiseKey(team.abbr);
      const canonicalExternalId = canonicalDefenseExternalId(team.abbr);

      const defRows = await tx.rankableEntry.findMany({
        where: {
          position: "DEF",
          type: "DEFENSE",
          team: franchise,
        },
        orderBy: { createdAt: "asc" },
      });

      let canonical =
        defRows.find(
          (row) =>
            row.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
            row.externalId === canonicalExternalId,
        ) ?? defRows.find((row) => isCanonicalDefenseRankableEntry(row));

      if (!canonical && defRows.length > 0) {
        canonical = defRows[0]!;
        await tx.rankableEntry.update({
          where: { id: canonical.id },
          data: {
            provider: NFL_COM_BOOTSTRAP_PROVIDER,
            externalId: canonicalExternalId,
            name: `${team.name} D/ST`,
            shortName: team.abbr,
            team: franchise,
            active: true,
          },
        });
      }

      if (!canonical) continue;
      report.franchises += 1;

      for (const row of defRows) {
        if (row.id === canonical.id) continue;
        await tx.rankableEntry.update({
          where: { id: row.id },
          data: {
            active: false,
            adminNotes: `Superseded by ${NFL_COM_BOOTSTRAP_PROVIDER}:${canonicalExternalId}`,
          },
        });
        report.rankableDeactivated += 1;
      }

      const seasonPlayers = await tx.seasonPlayer.findMany({
        where: {
          seasonId,
          position: "DEF",
          team: franchise,
        },
      });

      for (const row of seasonPlayers) {
        if (row.rankableEntryId === canonical.id) continue;
        await tx.seasonPlayer.delete({ where: { id: row.id } });
        report.seasonPlayersRemoved += 1;
        report.details.push(
          `Removed duplicate DEF season row for ${franchise} (${row.displayName})`,
        );
      }

      const existingCanonicalSeason = await tx.seasonPlayer.findUnique({
        where: {
          seasonId_rankableEntryId: {
            seasonId,
            rankableEntryId: canonical.id,
          },
        },
      });

      if (!existingCanonicalSeason) {
        await tx.seasonPlayer.create({
          data: {
            seasonId,
            rankableEntryId: canonical.id,
            displayName: `${team.name} D/ST`,
            team: franchise,
            position: "DEF",
            nflStatus: "ACTIVE",
            activeOnNFLRoster: true,
            sourcePosition: "DEF",
            sourceNflStatus: "ACT",
          },
        });
      }
    }
  });

  return report;
}
