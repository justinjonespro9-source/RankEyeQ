import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  weeks: [] as Array<{
    id: string;
    seasonId: string;
    weekNumber: number;
    isTest: boolean;
    season: { year: number; sport: string; active: boolean };
    startsAt: Date;
    fullLockAt: Date;
    revealStartsAt: Date;
    publicReleaseAt: Date;
    status: string;
  }>,
  contestLookups: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    universalProfile: {
      findUnique: vi.fn(async () => ({
        id: "p1",
        username: "me",
        profileType: "HUMAN",
        competitorActive: true,
        publicVisible: true,
        publicFromWeekId: null,
        publicFromWeek: null,
      })),
    },
    week: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            weekNumber: number;
            isTest?: boolean;
            season: { year?: number; sport?: string; active?: boolean };
          };
        }) =>
          db.weeks.find(
            (w) =>
              w.weekNumber === where.weekNumber &&
              (where.isTest == null || w.isTest === where.isTest) &&
              (where.season.year == null || w.season.year === where.season.year) &&
              (where.season.sport == null || w.season.sport === where.season.sport) &&
              (where.season.active == null || w.season.active === where.season.active),
          ) ?? null,
      ),
    },
    rankIQContest: {
      findUnique: vi.fn(
        async ({ where }: { where: { weekId_position: { weekId: string } } }) => {
          db.contestLookups.push(where.weekId_position.weekId);
          return { id: `${where.weekId_position.weekId}-WR`, status: "FINAL" };
        },
      ),
    },
  },
}));

import { getBoardIndexability } from "@/lib/board-privacy";
import {
  boardSeasonWhere,
  parseSeasonYearParam,
  profileBoardHref,
  weeklyReceiptsHref,
} from "@/lib/board-routes";

function week(id: string, year: number, active: boolean) {
  const past = new Date(Date.UTC(year, 9, 1));
  return {
    id,
    seasonId: `s${year}`,
    weekNumber: 4,
    isTest: false,
    season: { year, sport: "NFL", active },
    startsAt: past,
    fullLockAt: past,
    revealStartsAt: past,
    publicReleaseAt: past,
    status: "COMPLETE",
  };
}

beforeEach(() => {
  db.weeks = [week("w2026-4", 2026, false), week("w2027-4", 2027, true)];
  db.contestLookups = [];
});

describe("season-aware board routes", () => {
  it("builds receipt links that always carry the season", () => {
    expect(profileBoardHref("me", 2026, 4, "WR")).toBe("/profile/me/rankings/4/wr?season=2026");
    expect(weeklyReceiptsHref("me", 2026, 4)).toBe("/profile/me?tab=rankiq#season-2026-week-4");
  });

  it("parses the season query param strictly", () => {
    expect(parseSeasonYearParam(undefined)).toBeNull();
    expect(parseSeasonYearParam("")).toBeNull();
    expect(parseSeasonYearParam("2026")).toBe(2026);
    expect(parseSeasonYearParam("26")).toBe("invalid");
    expect(parseSeasonYearParam("2026x")).toBe("invalid");
    expect(parseSeasonYearParam(["2026", "2027"])).toBe("invalid");
  });

  it("pins the week lookup to the season year, else keeps the active-season default", () => {
    expect(boardSeasonWhere(2026, { active: true })).toEqual({ year: 2026, sport: "NFL" });
    expect(boardSeasonWhere(null, { active: true })).toEqual({ active: true });
  });

  it("a 2026 Week 4 receipt resolves to 2026 even while 2027 is active", async () => {
    await getBoardIndexability({ username: "me", weekNumber: 4, position: "WR", seasonYear: 2026 });
    expect(db.contestLookups).toEqual(["w2026-4"]);

    db.contestLookups = [];
    await getBoardIndexability({ username: "me", weekNumber: 4, position: "WR" });
    expect(db.contestLookups).toEqual(["w2027-4"]);
  });

  it("an unknown season year does not fall back to the active season", async () => {
    const result = await getBoardIndexability({
      username: "me",
      weekNumber: 4,
      position: "WR",
      seasonYear: 2019,
    });
    expect(result.exists).toBe(false);
    expect(db.contestLookups).toEqual([]);
  });
});
