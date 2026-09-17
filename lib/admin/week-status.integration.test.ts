import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadWeekStatusBoard,
  syncWeekAvailabilityFromSeasonPlayers,
} from "@/lib/admin/week-status";
import { syncWeekInjuriesFromNflCom } from "@/lib/nfl/injury-sync";
import { prisma } from "@/lib/db";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `wstat${Date.now().toString(36)}`;

describe("Week Status board — week-scoped matchups", () => {
  let seasonId = "";
  let week1Id = "";
  let week2Id = "";
  let week2GameId = "";
  let purdyId = "";
  let contestEntryId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: 2094, sport: `WSTAT-${suffix}`, active: false },
    });
    seasonId = season.id;

    const week1 = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "W1",
        startsAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
        endsAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
        status: "COMPLETE",
        isTest: true,
      },
    });
    week1Id = week1.id;

    const week2 = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 2,
        label: "W2",
        startsAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
        endsAt: zonedLocalToUtc(2026, 9, 22, 0, 0),
        status: "OPEN",
        isTest: true,
      },
    });
    week2Id = week2.id;

    const week1Game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `w1-sf-${suffix}`,
        seasonId,
        weekId: week1Id,
        seasonYear: 2094,
        weekNumber: 1,
        homeTeam: "SF",
        awayTeam: "SEA",
        startsAt: zonedLocalToUtc(2026, 9, 10, 19, 20), // Thursday
      },
    });

    const week2Game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `w2-sf-${suffix}`,
        seasonId,
        weekId: week2Id,
        seasonYear: 2094,
        weekNumber: 2,
        homeTeam: "SF",
        awayTeam: "PHI",
        startsAt: zonedLocalToUtc(2026, 9, 21, 15, 25), // Sunday
      },
    });
    week2GameId = week2Game.id;

    const purdy = await prisma.rankableEntry.create({
      data: {
        provider: "test",
        externalId: `purdy-${suffix}`,
        type: "PLAYER",
        name: `Brock Purdy ${suffix}`,
        shortName: "B. Purdy",
        team: "SF",
        position: "QB",
        availability: "ACTIVE",
        // Deliberately poisoned Week 1 master fields:
        gameId: week1Game.id,
        opponent: "vs SEA",
        gameStartsAt: week1Game.startsAt,
      },
    });
    purdyId = purdy.id;

    await prisma.seasonPlayer.create({
      data: {
        seasonId,
        rankableEntryId: purdyId,
        displayName: `Brock Purdy ${suffix}`,
        nflStatus: "ACTIVE",
        team: "SF",
        position: "QB",
      },
    });

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId: week2Id,
        position: "QB",
        title: `QB ${suffix}`,
        rankingDepth: 10,
        status: "OPEN",
      },
    });

    const contestEntry = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        rankableEntryId: purdyId,
        gameId: week2GameId,
        excluded: false,
      },
    });
    contestEntryId = contestEntry.id;
  });

  afterAll(async () => {
    if (!seasonId) return;
    await prisma.rankingPick.deleteMany({
      where: { rankableEntry: { externalId: { contains: suffix } } },
    });
    await prisma.playerWeekAvailability.deleteMany({
      where: { week: { seasonId } },
    });
    await prisma.contestEntry.deleteMany({
      where: { contest: { seasonId } },
    });
    await prisma.rankIQContest.deleteMany({ where: { seasonId } });
    await prisma.seasonPlayer.deleteMany({ where: { seasonId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { contains: suffix } },
    });
    await prisma.nflGame.deleteMany({ where: { seasonId } });
    await prisma.week.deleteMany({ where: { seasonId } });
    await prisma.season.delete({ where: { id: seasonId } }).catch(() => undefined);
  });

  it("shows Week 2 kickoff/opponent despite poisoned RankableEntry Week 1 fields", async () => {
    const rows = await loadWeekStatusBoard({ weekId: week2Id, position: "QB" });
    const row = rows.find((r) => r.rankableEntryId === purdyId);
    expect(row).toBeTruthy();
    expect(row!.contestEntryId).toBe(contestEntryId);
    expect(row!.matchupMissing).toBe(false);
    expect(row!.opponent).toBe("vs PHI");
    expect(row!.kickoffAt?.toISOString()).toBe(
      zonedLocalToUtc(2026, 9, 21, 15, 25).toISOString(),
    );
    // Must not surface Thursday Week 1 kickoff
    expect(row!.kickoffAt?.toISOString()).not.toBe(
      zonedLocalToUtc(2026, 9, 10, 19, 20).toISOString(),
    );
  });

  it("fails visibly when ContestEntry has no week-specific game", async () => {
    await prisma.contestEntry.update({
      where: { id: contestEntryId },
      data: { gameId: null },
    });
    const rows = await loadWeekStatusBoard({ weekId: week2Id, position: "QB" });
    const row = rows.find((r) => r.rankableEntryId === purdyId);
    expect(row!.matchupMissing).toBe(true);
    expect(row!.kickoffAt).toBeNull();
    expect(row!.opponent).toBe("MISSING");

    // Restore for later tests
    await prisma.contestEntry.update({
      where: { id: contestEntryId },
      data: { gameId: week2GameId },
    });
  });

  it("injury sync with blank Game Status reports unchanged and does not touch matchups", async () => {
    const before = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: contestEntryId },
      select: {
        gameId: true,
        rankableEntry: {
          select: { gameId: true, gameStartsAt: true, opponent: true },
        },
      },
    });

    const html = `
<!DOCTYPE html>
<html><body>
<div class="d3-o-section-sub-title"><span>49ers</span></div>
<table class="d3-o-table d3-o-table--detailed d3-o-reports--detailed">
<thead><tr><th>Player</th><th>Position</th><th>Injuries</th><th>Practice Status</th><th>Game Status</th></tr></thead>
<tbody>
<tr><td scope="row"><a href="/players/brock-purdy/" class="nfl-o-cta--link"> Brock Purdy ${suffix} </a></td><td>QB</td><td></td><td>Full Participation in Practice</td><td></td></tr>
</tbody></table>
</body></html>
    `;

    const result = await syncWeekInjuriesFromNflCom({
      weekId: week2Id,
      apply: true,
      nflHtml: html,
    });

    expect(result.ok).toBe(true);
    expect(result.unchanged).toBeGreaterThanOrEqual(1);
    expect(result.updated).toBe(0);

    const after = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: contestEntryId },
      select: {
        gameId: true,
        rankableEntry: {
          select: { gameId: true, gameStartsAt: true, opponent: true },
        },
      },
    });
    expect(after.gameId).toBe(before.gameId);
    expect(after.rankableEntry.gameId).toBe(before.rankableEntry.gameId);
    expect(after.rankableEntry.opponent).toBe(before.rankableEntry.opponent);
    expect(after.rankableEntry.gameStartsAt?.toISOString()).toBe(
      before.rankableEntry.gameStartsAt?.toISOString(),
    );
  });

  it("roster sync does not modify weekly designation or matchups", async () => {
    await prisma.playerWeekAvailability.upsert({
      where: {
        weekId_rankableEntryId: {
          weekId: week2Id,
          rankableEntryId: purdyId,
        },
      },
      create: {
        weekId: week2Id,
        rankableEntryId: purdyId,
        designation: "QUESTIONABLE",
        sourceType: "MANUAL",
        manualOverride: true,
        injuryDescription: "ankle",
      },
      update: {
        designation: "QUESTIONABLE",
        sourceType: "MANUAL",
        manualOverride: true,
        injuryDescription: "ankle",
      },
    });

    const beforeEntry = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: contestEntryId },
      select: { gameId: true },
    });
    const beforeAvail = await prisma.playerWeekAvailability.findUniqueOrThrow({
      where: {
        weekId_rankableEntryId: {
          weekId: week2Id,
          rankableEntryId: purdyId,
        },
      },
    });

    const result = await syncWeekAvailabilityFromSeasonPlayers(week2Id);
    expect(result.designationsUnchanged).toBe(true);
    expect(result.matchupsUnchanged).toBe(true);

    const afterAvail = await prisma.playerWeekAvailability.findUniqueOrThrow({
      where: {
        weekId_rankableEntryId: {
          weekId: week2Id,
          rankableEntryId: purdyId,
        },
      },
    });
    expect(afterAvail.designation).toBe(beforeAvail.designation);
    expect(afterAvail.manualOverride).toBe(true);

    const afterEntry = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: contestEntryId },
      select: { gameId: true },
    });
    expect(afterEntry.gameId).toBe(beforeEntry.gameId);
  });
});
