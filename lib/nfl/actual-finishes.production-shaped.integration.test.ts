import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import {
  calculateLeagueActualFinishesForWeek,
  summarizeActualFinishCounts,
} from "@/lib/nfl/actual-finishes";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

const suffix = `prod535-${Date.now()}`;

/** Production Week 1 pool sizes that previously stalled after QB. */
const PROD_COUNTS: Record<ContestPosition, number> = {
  QB: 87,
  RB: 114,
  WR: 182,
  TE: 120,
  DEF: 32,
};

describe("production-shaped calculateLeagueActualFinishesForWeek (535)", () => {
  let seasonId = "";
  let weekId = "";
  const contestIds = new Map<ContestPosition, string>();

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2097,
        sport: `NFL-535-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: `[TEST] Prod finishes 535 ${suffix}`,
        startsAt: new Date("2097-09-07T00:00:00Z"),
        endsAt: new Date("2097-09-15T00:00:00Z"),
        status: "LOCKED",
        isTest: true,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    weekId = week.id;

    // Seed contests + ContestEntry.fantasyPoints only (canonical source).
    // No WeekStats — mirrors the risk surface that must not gate finishes.
    for (const position of CONTEST_POSITIONS) {
      const contest = await prisma.rankIQContest.create({
        data: {
          seasonId,
          weekId,
          position,
          title: `${position} Top ${position === "WR" ? 15 : 10}`,
          rankingDepth: position === "WR" ? 15 : 10,
          status: "LOCKED",
        },
      });
      contestIds.set(position, contest.id);

      const count = PROD_COUNTS[position];
      const entryRows = Array.from({ length: count }, (_, i) => ({
        provider: "manual" as const,
        externalId: `p535-${position}-${i}-${suffix}`,
        type: (position === "DEF" ? "DEFENSE" : "PLAYER") as
          | "DEFENSE"
          | "PLAYER",
        name: `${position} ${i}`,
        shortName: `${position}${i}`,
        team: position === "DEF" ? `T${String(i).padStart(2, "0")}` : "AAA",
        opponent: "vs OPP",
        position,
        active: true,
      }));

      // createMany RankableEntry then ContestEntry in batches.
      for (let i = 0; i < entryRows.length; i += 50) {
        const chunk = entryRows.slice(i, i + 50);
        await prisma.rankableEntry.createMany({ data: chunk });
      }

      const created = await prisma.rankableEntry.findMany({
        where: {
          provider: "manual",
          externalId: { startsWith: `p535-${position}-`, endsWith: suffix },
        },
        select: { id: true, externalId: true },
      });
      const byExternal = new Map(
        created.map((row) => [row.externalId, row.id]),
      );

      const contestRows = entryRows.map((row, i) => {
        const rankableEntryId = byExternal.get(row.externalId);
        if (!rankableEntryId) {
          throw new Error(`missing rankable ${row.externalId}`);
        }
        // Tie the top two at each position for competition-rank coverage.
        const fantasyPoints = i === 0 || i === 1 ? 100 : Math.max(0.1, 99 - i * 0.25);
        return {
          contestId: contest.id,
          rankableEntryId,
          fantasyPoints,
          actualRank: null as number | null,
          excluded: false,
        };
      });

      for (let i = 0; i < contestRows.length; i += 50) {
        await prisma.contestEntry.createMany({
          data: contestRows.slice(i, i + 50),
        });
      }
    }

    // Simulate production mid-run state: QB already ranked, others not.
    const qbId = contestIds.get("QB")!;
    const qbEntries = await prisma.contestEntry.findMany({
      where: { contestId: qbId, excluded: false },
      orderBy: [{ fantasyPoints: "desc" }, { id: "asc" }],
      select: { id: true, fantasyPoints: true },
    });
    for (let i = 0; i < qbEntries.length; i += 1) {
      // Temporary stale ranks — week rerun must overwrite deterministically.
      await prisma.contestEntry.update({
        where: { id: qbEntries[i].id },
        data: { actualRank: i + 1 },
      });
    }
  }, 120_000);

  afterAll(async () => {
    await prisma.contestEntry.deleteMany({ where: { contest: { weekId } } });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: "p535-" }, provider: "manual" },
    });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.$disconnect();
  });

  it("ranks all five positions in one week pass (535 total)", async () => {
    const started = Date.now();
    const results = await calculateLeagueActualFinishesForWeek(weekId);
    const elapsedMs = Date.now() - started;

    expect(results).toHaveLength(5);
    const summary = summarizeActualFinishCounts(results);
    expect(summary.byPosition).toEqual({
      QB: 87,
      RB: 114,
      WR: 182,
      TE: 120,
      DEF: 32,
    });
    expect(summary.total).toBe(535);
    expect(summary.summary).toContain("QB: 87 ranked");
    expect(summary.summary).toContain("RB: 114 ranked");
    expect(summary.summary).toContain("WR: 182 ranked");
    expect(summary.summary).toContain("TE: 120 ranked");
    expect(summary.summary).toContain("DEF: 32 ranked");

    // Must finish well under the old 5s interactive-tx cliff across positions.
    expect(elapsedMs).toBeLessThan(60_000);

    for (const position of CONTEST_POSITIONS) {
      const withRank = await prisma.contestEntry.count({
        where: {
          contestId: contestIds.get(position)!,
          excluded: false,
          fantasyPoints: { not: null },
          actualRank: { not: null },
        },
      });
      expect(withRank).toBe(PROD_COUNTS[position]);
    }

    // Competition ties at the top.
    const qbTop = await prisma.contestEntry.findMany({
      where: { contestId: contestIds.get("QB")!, fantasyPoints: 100 },
      select: { actualRank: true },
    });
    expect(qbTop).toHaveLength(2);
    expect(qbTop.every((row) => row.actualRank === 1)).toBe(true);
  }, 120_000);

  it("rerun is idempotent and does not grade contests", async () => {
    const before = await prisma.contestEntry.findMany({
      where: { contest: { weekId } },
      select: {
        id: true,
        actualRank: true,
        fantasyPoints: true,
        contestId: true,
      },
      orderBy: { id: "asc" },
    });

    const second = await calculateLeagueActualFinishesForWeek(weekId);
    expect(summarizeActualFinishCounts(second).total).toBe(535);

    const after = await prisma.contestEntry.findMany({
      where: { contest: { weekId } },
      select: {
        id: true,
        actualRank: true,
        fantasyPoints: true,
        contestId: true,
      },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);

    const contests = await prisma.rankIQContest.findMany({ where: { weekId } });
    expect(contests.every((contest) => contest.status === "LOCKED")).toBe(true);
  }, 120_000);

  it("continues remaining positions when one contest fails", async () => {
    const rbId = contestIds.get("RB")!;
    const priorRb = await prisma.contestEntry.findMany({
      where: { contestId: rbId },
      select: { id: true, fantasyPoints: true, actualRank: true },
    });

    await prisma.contestEntry.updateMany({
      where: { contestId: rbId },
      data: { fantasyPoints: null, actualRank: null },
    });

    await expect(calculateLeagueActualFinishesForWeek(weekId)).rejects.toThrow(
      /failed for 1 position/,
    );

    // Other positions still refreshed even though RB failed.
    for (const position of ["QB", "WR", "TE", "DEF"] as ContestPosition[]) {
      const ranked = await prisma.contestEntry.count({
        where: {
          contestId: contestIds.get(position)!,
          actualRank: { not: null },
        },
      });
      expect(ranked).toBe(PROD_COUNTS[position]);
    }

    const rbRanked = await prisma.contestEntry.count({
      where: { contestId: rbId, actualRank: { not: null } },
    });
    expect(rbRanked).toBe(0);

    // Restore RB for cleanup / any later assertions.
    for (const row of priorRb) {
      await prisma.contestEntry.update({
        where: { id: row.id },
        data: {
          fantasyPoints: row.fantasyPoints,
          actualRank: row.actualRank,
        },
      });
    }
    await calculateLeagueActualFinishesForWeek(weekId);
  }, 120_000);

  it("summary payload is JSON-serializable plain data", () => {
    const payload = summarizeActualFinishCounts([
      {
        contestId: "c1",
        position: "QB",
        ranked: 87,
        tiedGroups: 1,
        contestEntriesRanked: 87,
        contestEntriesWithPoints: 87,
        poolCount: 87,
      },
      {
        contestId: "c2",
        position: "RB",
        ranked: 114,
        tiedGroups: 0,
        contestEntriesRanked: 114,
        contestEntriesWithPoints: 114,
        poolCount: 114,
      },
    ]);
    const roundTripped = JSON.parse(JSON.stringify(payload));
    expect(roundTripped).toEqual(payload);
    expect(roundTripped.total).toBe(201);
  });
});
