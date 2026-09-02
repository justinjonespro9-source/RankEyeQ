import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mergeAaronJonesIdentities } from "@/lib/nfl/merge-player-identity";
import { parsePlayerAliases, rankableEntryMatchesImportName } from "@/lib/nfl/player-aliases";
import { findWeeklyPoolCanonicalDuplicates } from "@/lib/nfl/pool-canonical-uniqueness";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

describe("Aaron Jones identity merge integration", () => {
  it("merges legacy Sr rows and preserves aliases", async () => {
    const suffix = `aj-merge-${Date.now()}`;
    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `aaron-jones-${suffix}`,
        type: "PLAYER",
        name: "Aaron Jones",
        shortName: "Jones",
        team: "MIN",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });
    const legacy = await prisma.rankableEntry.create({
      data: {
        provider: "manual",
        externalId: `manual-aaron-jones-${suffix}`,
        type: "PLAYER",
        name: "Aaron Jones Sr.",
        shortName: "Jones",
        team: "MIN",
        position: "RB",
        opponent: "TBD",
        active: false,
      },
    });

    const { mergePlayerIdentities } = await import("@/lib/nfl/merge-player-identity");
    await mergePlayerIdentities({
      canonicalId: canonical.id,
      duplicateIds: [legacy.id],
      displayName: "Aaron Jones",
      aliases: ["Aaron Jones Sr.", "Aaron Jones, Sr."],
    });

    const merged = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: canonical.id },
    });
    expect(merged.name).toBe("Aaron Jones");
    expect(parsePlayerAliases(merged.adminNotes)).toEqual(
      expect.arrayContaining(["Aaron Jones Sr.", "Aaron Jones, Sr."]),
    );

    for (const variant of [
      "Aaron Jones",
      "Aaron Jones Sr.",
      "Aaron Jones, Sr.",
    ]) {
      expect(rankableEntryMatchesImportName(merged, variant)).toBe(true);
    }

    await prisma.rankableEntry.delete({ where: { id: canonical.id } });
  });

  it("runs production Aaron Jones cleanup when duplicates exist", async () => {
    const activeAaron = await prisma.rankableEntry.count({
      where: {
        type: "PLAYER",
        position: "RB",
        active: true,
        name: { contains: "Aaron Jones", mode: "insensitive" },
      },
    });
    if (activeAaron < 2) return;

    const result = await mergeAaronJonesIdentities();
    const after = await prisma.rankableEntry.findMany({
      where: {
        type: "PLAYER",
        position: "RB",
        active: true,
        name: { contains: "Aaron Jones", mode: "insensitive" },
      },
    });

    expect(after).toHaveLength(1);
    expect(after[0]?.name).toBe("Aaron Jones");
    expect(result.aliases).toEqual(
      expect.arrayContaining(["Aaron Jones Sr.", "Aaron Jones, Sr."]),
    );

    const week1 = await prisma.week.findFirst({
      where: {
        weekNumber: 1,
        isTest: false,
        season: { active: true, sport: "NFL" },
      },
    });
    if (week1) {
      const duplicates = await findWeeklyPoolCanonicalDuplicates(week1.id);
      expect(duplicates).toEqual([]);
    }
  });
});
