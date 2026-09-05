import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ensureFivePositionContests } from "@/lib/admin/weeks";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import {
  getOpenWeekRankingsReadiness,
  openWeekRankings,
  OpenWeekRankingsError,
} from "@/lib/admin/open-week-rankings";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { enrollSeasonPlayer } from "@/lib/season-players";
import { syncWeeklyEligibleFieldFromSeason } from "@/lib/nfl/weekly-eligibility";
import { commitManualSchedule } from "@/lib/nfl/manual/schedule-import";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

const suffix = `open${Date.now()}`;

describe("open week rankings workflow", () => {
  let seasonId = "";
  let weekId = "";
  let adminUserId = "";

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        email: `open-admin-${suffix}@rankiq.local`,
        role: "ADMIN",
        emailVerified: new Date(),
      },
    });
    adminUserId = admin.id;

    const scoringVersion = await prisma.rankingScoringVersion.findFirst({
      where: { slug: "rankeyeq-v1" },
    });

    const season = await prisma.season.create({
      data: {
        year: 2094,
        sport: `OPEN-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        activeRankingScoringVersionId: scoringVersion?.id,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Open Test Week",
        startsAt: new Date("2026-09-07T00:00:00Z"),
        endsAt: new Date("2026-09-15T00:00:00Z"),
        status: "UPCOMING",
        isTest: true,
        rankingsOpenAt: new Date("2026-09-01T00:00:00Z"),
        fullLockAt: new Date("2026-09-14T15:00:00Z"),
        revealStartsAt: new Date("2026-09-14T16:00:00Z"),
        publicReleaseAt: new Date("2026-09-14T18:00:00Z"),
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    weekId = week.id;

    await ensureFivePositionContests(weekId);

    const schedule = `Away | Home | Kickoff
MIN | DET | 2026-09-13 12:00 CT
GB | CHI | 2026-09-13 15:25 CT
SF | SEA | 2026-09-13 15:25 CT
DAL | PHI | 2026-09-13 15:25 CT
KC | LAR | 2026-09-13 20:20 CT`;
    await commitManualSchedule({ weekId, text: schedule, adminUserId });

    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      for (let i = 1; i <= 16; i += 1) {
        const team = i % 2 === 0 ? "MIN" : "DET";
        const entry = await prisma.rankableEntry.create({
          data: {
            provider: "manual",
            externalId: `open-${suffix}-${position}-${i}`,
            type: "PLAYER",
            name: `${position} Player ${i}`,
            shortName: `P${i}`,
            team,
            opponent: team === "MIN" ? "@ DET" : "vs MIN",
            position,
            active: true,
          },
        });
        await enrollSeasonPlayer({
          seasonId,
          rankableEntryId: entry.id,
          team: entry.team,
        });
      }
      await syncWeeklyEligibleFieldFromSeason({
        weekId,
        position,
        scheduledTeamsOnly: true,
      });
    }

    const { buildDefensePoolFromSchedule } = await import(
      "@/lib/nfl/manual/schedule-import"
    );
    await buildDefensePoolFromSchedule({ weekId, adminUserId });
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } }).catch(() => {});
  });

  it("blocks opening when readiness fails", async () => {
    const draftWeek = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 99,
        label: "Empty",
        startsAt: new Date("2026-09-07T00:00:00Z"),
        endsAt: new Date("2026-09-15T00:00:00Z"),
        status: "UPCOMING",
        isTest: true,
      },
    });
    const readiness = await getOpenWeekRankingsReadiness(draftWeek.id);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.length).toBeGreaterThan(0);

    await expect(
      openWeekRankings({ weekId: draftWeek.id, adminUserId }),
    ).rejects.toBeInstanceOf(OpenWeekRankingsError);

    const contests = await prisma.rankIQContest.findMany({
      where: { weekId: draftWeek.id },
    });
    expect(contests.every((c) => c.status === "DRAFT" || c.status === "OPEN")).toBe(
      true,
    );
    await prisma.week.delete({ where: { id: draftWeek.id } });
  });

  it("opens all five contests together when ready", async () => {
    const readiness = await getOpenWeekRankingsReadiness(weekId);
    expect(readiness.blockers, readiness.blockers.join(" | ")).toEqual([]);
    expect(readiness.ready).toBe(true);

    const result = await openWeekRankings({ weekId, adminUserId });
    expect(result.opened).toHaveLength(5);

    const contests = await prisma.rankIQContest.findMany({
      where: { weekId },
      orderBy: { position: "asc" },
    });
    expect(contests.map((c) => c.status)).toEqual([
      "OPEN",
      "OPEN",
      "OPEN",
      "OPEN",
      "OPEN",
    ]);
    expect(CONTEST_POSITIONS.every((pos, index) => contests[index]?.position === pos)).toBe(
      true,
    );
  });

  it("reports insufficient DEF league depth on finalize", async () => {
    const readiness = await getFinalizeWeekReadiness(weekId);
    expect(readiness.ready).toBe(false);
    expect(
      readiness.reasons.some((reason) =>
        reason.includes("DEF requires at least 10 valid weekly defensive results"),
      ),
    ).toBe(true);
  });
});
