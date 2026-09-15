import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_MANUAL_PROVIDER } from "@/lib/admin/live-scoring-shared";
import { prisma } from "@/lib/db";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import {
  calculateLeagueActualFinishesForWeek,
  calculateLeagueActualFinishesForContest,
} from "@/lib/nfl/actual-finishes";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

const suffix = `fin${Date.now()}`;

/**
 * Manual Week path: ContestEntry.fantasyPoints are canonical.
 * WeekStats may exist (live scoring) but must not gate / replace finish calc.
 */
describe("manual calculateLeagueActualFinishesForWeek", () => {
  let seasonId = "";
  let weekId = "";
  let adminUserId = "";
  const contestIds = new Map<ContestPosition, string>();
  /** Enough rows to clear Top-N preflight depth (WR=15, others=10). */
  const expectedCounts: Record<ContestPosition, number> = {
    QB: 12,
    RB: 12,
    WR: 18,
    TE: 12,
    DEF: 12,
  };

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        email: `fin-admin-${suffix}@rankiq.local`,
        name: "Finishes Admin",
      },
    });
    adminUserId = admin.id;

    const season = await prisma.season.create({
      data: {
        year: 2098,
        sport: `NFL-FIN-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: `[TEST] Manual finishes ${suffix}`,
        startsAt: new Date("2098-09-07T00:00:00Z"),
        endsAt: new Date("2098-09-15T00:00:00Z"),
        status: "LOCKED",
        isTest: true,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        fullLockAt: new Date("2098-09-14T15:00:00Z"),
      },
    });
    weekId = week.id;

    const gameA = await prisma.nflGame.create({
      data: {
        provider: "manual",
        externalId: `fin-g-a-${suffix}`,
        weekId,
        seasonYear: 2098,
        weekNumber: 1,
        homeTeam: "AAA",
        awayTeam: "BBB",
        startsAt: new Date("2098-09-14T17:00:00Z"),
        status: "FINAL",
        statsFinalizedAt: new Date("2098-09-14T21:00:00Z"),
      },
    });
    const gameB = await prisma.nflGame.create({
      data: {
        provider: "manual",
        externalId: `fin-g-b-${suffix}`,
        weekId,
        seasonYear: 2098,
        weekNumber: 1,
        homeTeam: "CCC",
        awayTeam: "DDD",
        startsAt: new Date("2098-09-14T20:00:00Z"),
        status: "FINAL",
        statsFinalizedAt: new Date("2098-09-14T23:00:00Z"),
      },
    });

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

      const count = expectedCounts[position];
      for (let i = 0; i < count; i += 1) {
        // Unique team codes for DEF WeekStat uniqueness (provider, weekId, team).
        const team =
          position === "DEF"
            ? `D${String(i).padStart(2, "0")}`
            : i % 4 === 0
              ? "AAA"
              : i % 4 === 1
                ? "BBB"
                : i % 4 === 2
                  ? "CCC"
                  : "DDD";
        const gameId =
          position === "DEF"
            ? i % 2 === 0
              ? gameA.id
              : gameB.id
            : team === "AAA" || team === "BBB"
              ? gameA.id
              : gameB.id;
        const entry = await prisma.rankableEntry.create({
          data: {
            provider: "manual",
            externalId: `fin-${position}-${i}-${suffix}`,
            type: position === "DEF" ? "DEFENSE" : "PLAYER",
            name:
              position === "DEF"
                ? `${team} Defense`
                : `${position} Player ${i}`,
            shortName: `${position}${i}`,
            team,
            opponent: "vs OPP",
            position,
            gameId,
            gameStartsAt: gameA.startsAt,
            active: true,
          },
        });

        // Tie at the top (i=0 and i=1 share 100 pts); rest strictly descending.
        const fantasyPoints = i === 0 || i === 1 ? 100 : 100 - i;

        await prisma.contestEntry.create({
          data: {
            contestId: contest.id,
            rankableEntryId: entry.id,
            gameId,
            fantasyPoints,
            actualRank: null,
            excluded: false,
          },
        });

        if (position === "DEF") {
          await prisma.defenseWeekStat.create({
            data: {
              provider: LIVE_MANUAL_PROVIDER,
              weekId,
              rankableEntryId: entry.id,
              gameId,
              team,
              externalId: entry.externalId,
              scoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
              fantasyPoints,
              isProvisional: false,
            },
          });
        } else {
          await prisma.playerWeekStat.create({
            data: {
              provider: LIVE_MANUAL_PROVIDER,
              weekId,
              rankableEntryId: entry.id,
              gameId,
              externalPlayerId: entry.externalId,
              scoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
              fantasyPoints,
              isProvisional: false,
            },
          });
        }
      }

      // Orphan WeekStat (not in contest pool) — must not replace ContestEntry ranking.
      if (position === "QB") {
        const orphan = await prisma.rankableEntry.create({
          data: {
            provider: "manual",
            externalId: `fin-orphan-qb-${suffix}`,
            type: "PLAYER",
            name: "Orphan QB",
            shortName: "ORPH",
            team: "ZZZ",
            opponent: "vs OPP",
            position: "QB",
            active: true,
          },
        });
        await prisma.playerWeekStat.create({
          data: {
            provider: LIVE_MANUAL_PROVIDER,
            weekId,
            rankableEntryId: orphan.id,
            externalPlayerId: orphan.externalId,
            scoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
            fantasyPoints: 99,
            isProvisional: false,
          },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.contestEntry.deleteMany({ where: { contest: { weekId } } });
    await prisma.playerWeekStat.deleteMany({ where: { weekId } });
    await prisma.defenseWeekStat.deleteMany({ where: { weekId } });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: `fin-` }, provider: "manual" },
    });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.$disconnect();
  });

  it("preflight is BLOCKED before ranks exist", async () => {
    const readiness = await getFinalizeWeekReadiness(weekId);
    expect(readiness.ready).toBe(false);
    for (const row of readiness.positions) {
      expect(row.withPoints).toBe(expectedCounts[row.position]);
      expect(row.withRanks).toBe(0);
      expect(row.status).toBe("BLOCKED");
    }
  });

  it("ranks every scored ContestEntry from canonical fantasyPoints", async () => {
    const results = await calculateLeagueActualFinishesForWeek(weekId);

    expect(results).toHaveLength(5);
    for (const row of results) {
      expect(row.contestEntriesWithPoints).toBe(expectedCounts[row.position]);
      expect(row.contestEntriesRanked).toBe(expectedCounts[row.position]);
      expect(row.ranked).toBe(expectedCounts[row.position]);
      expect(row.tiedGroups).toBeGreaterThanOrEqual(1);
    }

    for (const position of CONTEST_POSITIONS) {
      const contestId = contestIds.get(position)!;
      const entries = await prisma.contestEntry.findMany({
        where: { contestId, excluded: false },
        orderBy: [{ fantasyPoints: "desc" }, { id: "asc" }],
      });
      expect(entries).toHaveLength(expectedCounts[position]);
      expect(entries.every((entry) => entry.actualRank != null)).toBe(true);

      // Competition rank: tied 100-pt leaders both get actualRank 1; next is 3.
      expect(entries[0]?.fantasyPoints).toBe(100);
      expect(entries[1]?.fantasyPoints).toBe(100);
      expect(entries[0]?.actualRank).toBe(1);
      expect(entries[1]?.actualRank).toBe(1);
      expect(entries[2]?.actualRank).toBe(3);
    }
  });

  it("mirrors leagueActualRank onto manual WeekStats without requiring them", async () => {
    const qbContestId = contestIds.get("QB")!;
    const entry = await prisma.contestEntry.findFirstOrThrow({
      where: { contestId: qbContestId, actualRank: 1 },
    });
    const weekStat = await prisma.playerWeekStat.findFirstOrThrow({
      where: {
        weekId,
        provider: LIVE_MANUAL_PROVIDER,
        rankableEntryId: entry.rankableEntryId,
      },
    });
    expect(weekStat.leagueActualRank).toBe(1);
    expect(weekStat.isProvisional).toBe(false);
  });

  it("is idempotent on rerun and does not grade contests", async () => {
    const before = await prisma.contestEntry.findMany({
      where: { contestId: contestIds.get("RB")! },
      select: { id: true, actualRank: true, fantasyPoints: true },
      orderBy: { id: "asc" },
    });

    const second = await calculateLeagueActualFinishesForWeek(weekId);
    expect(
      second.find((row) => row.position === "RB")?.contestEntriesRanked,
    ).toBe(expectedCounts.RB);

    const after = await prisma.contestEntry.findMany({
      where: { contestId: contestIds.get("RB")! },
      select: { id: true, actualRank: true, fantasyPoints: true },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);

    const contests = await prisma.rankIQContest.findMany({ where: { weekId } });
    expect(contests.every((contest) => contest.status === "LOCKED")).toBe(true);
  });

  it("moves position rank preflight from BLOCKED to PASS", async () => {
    const readiness = await getFinalizeWeekReadiness(weekId);
    for (const row of readiness.positions) {
      expect(row.withRanks).toBe(expectedCounts[row.position]);
      expect(row.readyToGrade).toBe(true);
      expect(row.notes.some((note) => note.includes("actualRank"))).toBe(false);
      // Rank depth itself is satisfied; overall week may still warn (snapshots).
      expect(["PASS", "WARNING"]).toContain(row.status);
    }
  });

  it("throws when a scored contest has no fantasyPoints (no silent empty)", async () => {
    await expect(
      calculateLeagueActualFinishesForContest("missing-contest-id"),
    ).rejects.toThrow();

    const defId = contestIds.get("DEF")!;
    const prior = await prisma.contestEntry.findMany({
      where: { contestId: defId },
      orderBy: { id: "asc" },
      select: { id: true, fantasyPoints: true, actualRank: true },
    });

    await prisma.contestEntry.updateMany({
      where: { contestId: defId },
      data: { fantasyPoints: null, actualRank: null },
    });
    await expect(calculateLeagueActualFinishesForContest(defId)).rejects.toThrow(
      /No ContestEntry fantasyPoints/,
    );

    for (const row of prior) {
      await prisma.contestEntry.update({
        where: { id: row.id },
        data: {
          fantasyPoints: row.fantasyPoints,
          actualRank: row.actualRank,
        },
      });
    }
  });

  it("never leaves scored entries without actualRank after a successful run", async () => {
    await calculateLeagueActualFinishesForWeek(weekId);

    for (const position of CONTEST_POSITIONS) {
      const orphaned = await prisma.contestEntry.count({
        where: {
          contestId: contestIds.get(position)!,
          excluded: false,
          fantasyPoints: { not: null },
          actualRank: null,
        },
      });
      expect(orphaned).toBe(0);
    }
  });
});
