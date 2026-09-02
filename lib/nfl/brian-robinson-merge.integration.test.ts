import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { findNameMatches, toEligibleParserEntry } from "@/lib/admin/ai-parser";
import { mergeBrianRobinsonIdentities } from "@/lib/nfl/merge-player-identity";
import { parsePlayerAliases, rankableEntryMatchesImportName } from "@/lib/nfl/player-aliases";
import { findWeeklyPoolCanonicalDuplicates } from "@/lib/nfl/pool-canonical-uniqueness";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

describe("Brian Robinson identity merge", () => {
  it("merges legacy Jr identity into canonical Brian Robinson and preserves aliases", async () => {
    const suffix = `br-merge-${Date.now()}`;
    const season = await prisma.season.create({
      data: {
        year: 2099,
        sport: `TEST-BR-${suffix}`,
        active: false,
      },
    });
    const week = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber: 1,
        label: `Week 1 ${suffix}`,
        startsAt: new Date("2099-09-07T00:00:00Z"),
        endsAt: new Date("2099-09-14T00:00:00Z"),
        status: "OPEN",
        isTest: true,
      },
    });
    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId: season.id,
        weekId: week.id,
        position: "RB",
        title: `RB ${suffix}`,
        rankingDepth: 24,
        status: "OPEN",
      },
    });

    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `brian-robinson-${suffix}`,
        type: "PLAYER",
        name: "Brian Robinson",
        shortName: "Robinson",
        team: "ATL",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });
    const legacy = await prisma.rankableEntry.create({
      data: {
        provider: "mock",
        externalId: `mock-rb-br-${suffix}`,
        type: "PLAYER",
        name: "Brian Robinson Jr.",
        shortName: "Robinson",
        team: "WAS",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });

    await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        rankableEntryId: legacy.id,
        weekTeam: "WAS",
        excluded: false,
      },
    });
    await prisma.rankingPick.create({
      data: {
        submissionId: (
          await prisma.rankingSubmission.create({
            data: {
              contestId: contest.id,
              universalProfileId: (
                await prisma.universalProfile.create({
                  data: {
                    displayName: `Tester ${suffix}`,
                    profileType: "HUMAN",
                    username: `tester-${suffix}`,
                  },
                })
              ).id,
              status: "SUBMITTED",
            },
          })
        ).id,
        rankableEntryId: legacy.id,
        predictedRank: 5,
      },
    });

    await mergePlayerIdentitiesForTest(canonical.id, [legacy.id]);

    const mergedCanonical = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: canonical.id },
    });
    expect(mergedCanonical.name).toBe("Brian Robinson");
    expect(mergedCanonical.active).toBe(true);
    expect(parsePlayerAliases(mergedCanonical.adminNotes)).toEqual(
      expect.arrayContaining(["Brian Robinson Jr.", "Brian Robinson, Jr."]),
    );

    const weekEntry = await prisma.contestEntry.findFirst({
      where: { contestId: contest.id, rankableEntryId: canonical.id },
    });
    expect(weekEntry?.weekTeam).toBe("WAS");

    const pick = await prisma.rankingPick.findFirst({
      where: { rankableEntryId: canonical.id },
    });
    expect(pick?.predictedRank).toBe(5);

    for (const variant of [
      "Brian Robinson",
      "Brian Robinson Jr.",
      "Brian Robinson, Jr.",
    ]) {
      expect(rankableEntryMatchesImportName(mergedCanonical, variant)).toBe(true);
      expect(
        findNameMatches(variant, [toEligibleParserEntry(mergedCanonical)]),
      ).toHaveLength(1);
    }

    const duplicates = await findWeeklyPoolCanonicalDuplicates(week.id);
    expect(duplicates).toEqual([]);

    await prisma.season.delete({ where: { id: season.id } });
  });

  it("runs production Brian Robinson cleanup when identities exist", async () => {
    const before = await prisma.rankableEntry.count({
      where: {
        type: "PLAYER",
        position: "RB",
        active: true,
        name: { contains: "Brian Robinson", mode: "insensitive" },
      },
    });
    if (before < 2) return;

    const result = await mergeBrianRobinsonIdentities();
    const after = await prisma.rankableEntry.findMany({
      where: {
        type: "PLAYER",
        position: "RB",
        active: true,
        name: { contains: "Brian Robinson", mode: "insensitive" },
      },
    });

    expect(after).toHaveLength(1);
    expect(after[0]?.name).toBe("Brian Robinson");
    expect(result.aliases).toEqual(
      expect.arrayContaining(["Brian Robinson Jr.", "Brian Robinson, Jr."]),
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

async function mergePlayerIdentitiesForTest(
  canonicalId: string,
  duplicateIds: string[],
) {
  const { mergePlayerIdentities } = await import("@/lib/nfl/merge-player-identity");
  return mergePlayerIdentities({
    canonicalId,
    duplicateIds,
    displayName: "Brian Robinson",
    aliases: ["Brian Robinson Jr.", "Brian Robinson, Jr."],
  });
}
