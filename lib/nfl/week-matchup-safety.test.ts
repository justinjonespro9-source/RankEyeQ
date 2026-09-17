import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  assessWeekMatchupHealth,
  assertWeekMatchupsStamped,
  WeekMatchupNotStampedError,
} from "@/lib/nfl/week-matchup-health";
import { cleanupOrphanNflGames } from "@/lib/nfl/orphan-game-cleanup";
import { resolveWeekScopedKickoff } from "@/lib/timing/resolve-contest-kickoff";
import { matchupNotStampedMessage } from "@/lib/timing/resolve-contest-kickoff";

const suffix = `safe-${Date.now()}`;

describe("fail-closed matchup health + safe orphan cleanup", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let entryId = "";
  let orphanUnreferencedId = "";
  let orphanReferencedId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: 2088, sport: `SAFE-${suffix}`, active: false },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 7,
        label: `Bye-capable ${suffix}`,
        startsAt: new Date("2088-10-01T00:00:00Z"),
        endsAt: new Date("2088-10-08T00:00:00Z"),
        status: "OPEN",
        isTest: false,
      },
    });
    weekId = week.id;
    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "WR",
        title: "Safe WR",
        rankingDepth: 15,
        status: "DRAFT",
      },
    });
    contestId = contest.id;

    const keepGame = await prisma.nflGame.create({
      data: {
        provider: "manual",
        externalId: `manual-2088-w7-NYG-LAR`,
        seasonId,
        weekId,
        seasonYear: 2088,
        weekNumber: 7,
        homeTeam: "LAR",
        awayTeam: "NYG",
        startsAt: new Date("2088-10-06T00:15:00Z"),
      },
    });

    const entry = await prisma.rankableEntry.create({
      data: {
        provider: "test",
        externalId: `safe-puka-${suffix}`,
        type: "PLAYER",
        name: "Puka Safety",
        shortName: "Puka",
        team: "LAR",
        opponent: "TBD",
        position: "WR",
        gameStartsAt: new Date("2088-09-01T00:20:00Z"), // stale prior-week-like
      },
    });
    entryId = entry.id;
    await prisma.contestEntry.create({
      data: {
        contestId,
        rankableEntryId: entry.id,
        gameId: keepGame.id,
        weekTeam: "LAR",
      },
    });

    const orphanUnreferenced = await prisma.nflGame.create({
      data: {
        provider: "manual-acceptance",
        externalId: `accept-orphan-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2088,
        weekNumber: 7,
        homeTeam: "SEA",
        awayTeam: "PIT",
        startsAt: new Date("2088-10-05T20:25:00Z"),
      },
    });
    orphanUnreferencedId = orphanUnreferenced.id;

    const orphanReferenced = await prisma.nflGame.create({
      data: {
        provider: "manual-acceptance",
        externalId: `accept-referenced-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2088,
        weekNumber: 7,
        homeTeam: "DET",
        awayTeam: "CHI",
        startsAt: new Date("2088-10-05T17:00:00Z"),
      },
    });
    orphanReferencedId = orphanReferenced.id;
    await prisma.rankableEntry.update({
      where: { id: entry.id },
      data: { gameId: orphanReferenced.id },
    });
  });

  afterAll(async () => {
    await prisma.contestEntry.deleteMany({ where: { contestId } });
    await prisma.rankableEntry.deleteMany({ where: { id: entryId } });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.rankIQContest.deleteMany({ where: { id: contestId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
  });

  it("blocks zero-game NFL weeks", async () => {
    const emptyWeek = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 99,
        label: `Empty ${suffix}`,
        startsAt: new Date("2088-12-01T00:00:00Z"),
        endsAt: new Date("2088-12-08T00:00:00Z"),
        status: "UPCOMING",
        isTest: false,
      },
    });
    const health = await assessWeekMatchupHealth(emptyWeek.id);
    expect(health.gameCount).toBe(0);
    expect(health.ready).toBe(false);
    expect(health.blockers[0]).toBe(matchupNotStampedMessage(99));
    await expect(assertWeekMatchupsStamped(emptyWeek.id)).rejects.toBeInstanceOf(
      WeekMatchupNotStampedError,
    );
    await prisma.week.delete({ where: { id: emptyWeek.id } });
  });

  it("blocks partial schedules when pool teams lack week games", async () => {
    // Add a second active entry with no matching game on this week's slate.
    const byePlayer = await prisma.rankableEntry.create({
      data: {
        provider: "test",
        externalId: `safe-bye-${suffix}`,
        type: "PLAYER",
        name: "Bye WR",
        shortName: "Bye",
        team: "KC",
        opponent: "TBD",
        position: "WR",
      },
    });
    await prisma.contestEntry.create({
      data: {
        contestId,
        rankableEntryId: byePlayer.id,
        weekTeam: "KC",
      },
    });

    const health = await assessWeekMatchupHealth(weekId);
    expect(health.gameCount).toBeGreaterThan(0);
    expect(health.gameCount).toBeLessThan(16);
    expect(health.ready).toBe(false);
    expect(health.totals.unmatchedTeam).toBeGreaterThan(0);
    expect(health.blockers[0]).toBe(matchupNotStampedMessage(7));

    await prisma.contestEntry.deleteMany({
      where: { rankableEntryId: byePlayer.id },
    });
    await prisma.rankableEntry.delete({ where: { id: byePlayer.id } });
  });

  it("passes a complete canonical slate for the pool without requiring 16 games", async () => {
    const health = await assessWeekMatchupHealth(weekId);
    expect(health.gameCount).toBeLessThan(16);
    expect(health.ready).toBe(true);
    expect(health.totals.correct).toBe(1);
    await assertWeekMatchupsStamped(weekId);
  });

  it("resolves Puka only through week-scoped ContestEntry.game", async () => {
    const entry = await prisma.contestEntry.findFirstOrThrow({
      where: { rankableEntryId: entryId, contestId },
      include: { game: true, rankableEntry: true },
    });
    // Poison master with a fake prior-week kickoff — must be ignored.
    await prisma.rankableEntry.update({
      where: { id: entryId },
      data: { gameStartsAt: new Date("2088-09-01T00:20:00Z") },
    });
    const kickoff = resolveWeekScopedKickoff({
      weekId,
      contestGame: entry.game,
    });
    expect(kickoff?.toISOString()).toBe("2088-10-06T00:15:00.000Z");
    expect(entry.game?.homeTeam).toBe("LAR");
    expect(entry.game?.awayTeam).toBe("NYG");
  });

  it("dry-run orphan cleanup lists deletions and preserves referenced games", async () => {
    const beforeCount = await prisma.nflGame.count({ where: { weekId } });
    const plan = await cleanupOrphanNflGames({
      weekId,
      keepExternalIds: [`manual-2088-w7-NYG-LAR`],
      apply: false,
    });
    expect(plan.applied).toBe(false);
    expect(plan.proposedDeletions.some((row) => row.id === orphanUnreferencedId)).toBe(
      true,
    );
    expect(plan.conflicts.some((row) => row.id === orphanReferencedId)).toBe(true);
    const conflict = plan.conflicts.find((row) => row.id === orphanReferencedId)!;
    expect(conflict.references.rankableEntries).toBeGreaterThan(0);
    expect(conflict.action).toBe("conflict_preserve");
    expect(await prisma.nflGame.count({ where: { weekId } })).toBe(beforeCount);

    const applied = await cleanupOrphanNflGames({
      weekId,
      keepExternalIds: [`manual-2088-w7-NYG-LAR`],
      apply: true,
    });
    expect(applied.deletedIds).toContain(orphanUnreferencedId);
    expect(applied.deletedIds).not.toContain(orphanReferencedId);
    expect(applied.conflicts.some((row) => row.id === orphanReferencedId)).toBe(true);
    expect(
      await prisma.nflGame.findUnique({ where: { id: orphanReferencedId } }),
    ).toBeTruthy();
    expect(
      await prisma.nflGame.findUnique({ where: { id: orphanUnreferencedId } }),
    ).toBeNull();

    // Idempotent second apply
    const again = await cleanupOrphanNflGames({
      weekId,
      keepExternalIds: [`manual-2088-w7-NYG-LAR`],
      apply: true,
    });
    expect(again.proposedDeletions).toHaveLength(0);
    expect(again.deletedIds).toHaveLength(0);
  });
});
