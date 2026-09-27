import { beforeEach, describe, expect, it, vi } from "vitest";

type Profile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: null;
  profileType: "HUMAN" | "AI" | "BENCHMARK" | "CREATOR";
  competitorActive: boolean;
  publicVisible: boolean;
  publicFromWeekId: null;
  publicFromWeek: null;
  expertSource: {
    sourceKind: string;
    publicationName: string | null;
    analystName: string | null;
  } | null;
  creatorCompetitor: null;
};

type Position = "QB" | "RB" | "WR" | "TE" | "DEF";

type SeasonWorld = {
  id: string;
  year: number;
  active: boolean;
  contests: Array<{ weekNumber: number; position: Position; status: string }>;
  results: Array<{
    weekNumber: number;
    position: Position;
    profile: Profile;
    score: number;
  }>;
};

const db = vi.hoisted(() => ({
  seasons: [] as SeasonWorld[],
  calls: [] as string[],
}));

function contestId(season: SeasonWorld, week: number, position: Position) {
  return `${season.id}-w${week}-${position}`;
}

function toSubmission(season: SeasonWorld, result: SeasonWorld["results"][number]) {
  const contest = season.contests.find(
    (c) => c.weekNumber === result.weekNumber && c.position === result.position,
  );
  if (!contest) throw new Error("result without contest");
  const weekId = `${season.id}-w${result.weekNumber}`;
  return {
    id: `${contestId(season, result.weekNumber, result.position)}-${result.profile.id}`,
    status: "GRADED",
    normalizedScore: result.score,
    picks: [{ predictedRank: 1, actualRank: 4 }],
    universalProfile: result.profile,
    contest: {
      id: contestId(season, result.weekNumber, result.position),
      weekId,
      seasonId: season.id,
      position: result.position,
      rankingDepth: 10,
      status: contest.status,
      week: {
        id: weekId,
        seasonId: season.id,
        weekNumber: result.weekNumber,
        label: `Week ${result.weekNumber}`,
        startsAt: new Date(Date.UTC(season.year, 8, result.weekNumber * 7)),
        isTest: false,
      },
    },
  };
}

vi.mock("@/lib/db", () => ({
  prisma: {
    season: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        db.calls.push("season.findUnique");
        const season = db.seasons.find((s) => s.id === where.id);
        return season
          ? { id: season.id, year: season.year, active: season.active }
          : null;
      }),
    },
    rankIQContest: {
      findMany: vi.fn(async ({ where }: { where: { seasonId: string } }) => {
        db.calls.push("rankIQContest.findMany");
        const season = db.seasons.find((s) => s.id === where.seasonId);
        return (season?.contests ?? []).map((c) => ({
          id: contestId(season!, c.weekNumber, c.position),
          weekId: `${season!.id}-w${c.weekNumber}`,
          position: c.position,
          status: c.status,
          week: { weekNumber: c.weekNumber },
        }));
      }),
    },
    rankingSubmission: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            contest: {
              status: { in: string[] };
              seasonId?: string;
              weekId?: string;
              position?: Position;
            };
          };
        }) => {
          db.calls.push("rankingSubmission.findMany");
          return db.seasons
            .flatMap((season) => season.results.map((r) => toSubmission(season, r)))
            .filter(
              (s) =>
                where.contest.status.in.includes(s.contest.status) &&
                (!where.contest.seasonId || s.contest.seasonId === where.contest.seasonId) &&
                (!where.contest.weekId || s.contest.weekId === where.contest.weekId) &&
                (!where.contest.position || s.contest.position === where.contest.position),
            );
        },
      ),
    },
  },
}));

import {
  buildSeasonStanding,
  classFilterForStanding,
  deriveTrophyCase,
  isNumberOneCall,
  isWeeklyTopTen,
  type SeasonChampionshipEligibility,
  type TrophyCase,
} from "@/lib/competitive-resume";
import { profileBoardHref, weeklyReceiptsHref } from "@/lib/board-routes";
import {
  competitiveRanks,
  filterLeaderboardRows,
  getSeasonBoardSet,
  getSeasonLeaderboard,
  getWeeklyLeaderboard,
} from "@/lib/leaderboards";

function profile(
  id: string,
  profileType: Profile["profileType"] = "HUMAN",
  sourceKind: string | null = null,
): Profile {
  return {
    id,
    username: id,
    displayName: id,
    avatarUrl: null,
    profileType,
    competitorActive: true,
    publicVisible: true,
    publicFromWeekId: null,
    publicFromWeek: null,
    expertSource: sourceKind
      ? { sourceKind, publicationName: "Pub", analystName: null }
      : null,
    creatorCompetitor: null,
  };
}

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "DEF"];

function season(input: {
  id?: string;
  year?: number;
  active?: boolean;
  weeks: number[];
  positions?: Position[];
  status?: (week: number, position: Position) => string;
}): SeasonWorld {
  const s: SeasonWorld = {
    id: input.id ?? "s2026",
    year: input.year ?? 2026,
    active: input.active ?? true,
    contests: [],
    results: [],
  };
  for (const week of input.weeks) {
    for (const position of input.positions ?? POSITIONS) {
      s.contests.push({
        weekNumber: week,
        position,
        status: input.status?.(week, position) ?? "FINAL",
      });
    }
  }
  db.seasons.push(s);
  return s;
}

function score(
  s: SeasonWorld,
  weekNumber: number,
  position: Position,
  who: Profile,
  value: number,
) {
  s.results.push({ weekNumber, position, profile: who, score: value });
}

/** `count` filler HUMAN rankers with descending scores starting at `top`. */
function field(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    profile(`${prefix}${String(i).padStart(2, "0")}`),
  );
}

function fillWeek(
  s: SeasonWorld,
  weekNumber: number,
  position: Position,
  rankers: Profile[],
  top: number,
) {
  rankers.forEach((who, i) => score(s, weekNumber, position, who, top - i));
}

async function boardSet(s: SeasonWorld) {
  const set = await getSeasonBoardSet({ seasonId: s.id });
  if (!set) throw new Error("missing set");
  return set;
}

beforeEach(() => {
  db.seasons = [];
  db.calls = [];
});

describe("canonical board set", () => {
  it("matches getSeasonLeaderboard / getWeeklyLeaderboard for every scope", async () => {
    const s = season({ weeks: [1, 2] });
    const rankers = field("p", 6);
    for (const week of [1, 2]) {
      for (const [i, position] of POSITIONS.entries()) {
        rankers.forEach((who, j) =>
          score(s, week, position, who, 90 - ((i * 7 + j * 11 + week * 3) % 40)),
        );
      }
    }
    const set = await boardSet(s);

    expect(set.seasonOverall).toEqual(await getSeasonLeaderboard({ seasonId: s.id }));
    for (const position of POSITIONS) {
      expect(set.seasonByPosition[position]).toEqual(
        await getSeasonLeaderboard({ seasonId: s.id, position }),
      );
    }
    for (const week of set.weeks) {
      expect(week.overall).toEqual(await getWeeklyLeaderboard({ weekId: week.weekId }));
      for (const position of POSITIONS) {
        expect(week.byPosition[position]).toEqual(
          await getWeeklyLeaderboard({ weekId: week.weekId, position }),
        );
      }
    }
  });

  it("loads a whole season with a constant number of queries (no N+1)", async () => {
    const s = season({ weeks: [1, 2, 3, 4, 5, 6] });
    const rankers = field("p", 4);
    for (const week of [1, 2, 3, 4, 5, 6]) {
      for (const position of POSITIONS) fillWeek(s, week, position, rankers, 80);
    }
    db.calls = [];
    await boardSet(s);
    expect(db.calls.sort()).toEqual([
      "rankIQContest.findMany",
      "rankingSubmission.findMany",
      "season.findUnique",
    ]);
  });

  it("class filter re-ranks the canonical rows by profile class", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    const expert = profile("expert", "BENCHMARK", "ANALYST");
    const consensus = profile("consensus", "BENCHMARK", "PUBLISHER_CONSENSUS");
    const creator = profile("creator", "CREATOR");
    const ai = profile("ai", "AI");
    const human = profile("human");
    [human, ai, creator, consensus, expert].forEach((who, i) =>
      score(s, 1, "QB", who, 90 - i),
    );
    const set = await boardSet(s);
    const rankIn = (filter: Parameters<typeof filterLeaderboardRows>[1], id: string) =>
      filterLeaderboardRows(set.seasonOverall, filter).find(
        (r) => r.universalProfileId === id,
      )?.rank;
    expect(rankIn("ALL", "expert")).toBe(5);
    expect(rankIn("EXPERT", "expert")).toBe(1);
    expect(rankIn("EXPERT", "consensus")).toBeUndefined();
    expect(rankIn("PUBLISHER", "consensus")).toBe(1);
    expect(rankIn("CREATOR", "creator")).toBe(1);
    expect(rankIn("AI", "ai")).toBe(1);
    expect(rankIn("HUMAN", "human")).toBe(1);
  });
});

describe("season standing", () => {
  it("reports overall and each positional season rank from canonical boards", async () => {
    const s = season({ weeks: [1] });
    const me = profile("me");
    const rivals = field("r", 4);
    // Positional finish for `me`: QB 1st, RB 2nd, WR 3rd, TE 5th, DEF not played.
    const myRank: Partial<Record<Position, number>> = { QB: 1, RB: 2, WR: 3, TE: 5 };
    for (const position of POSITIONS) {
      const ordered = [...rivals];
      if (myRank[position]) ordered.splice(myRank[position]! - 1, 0, me);
      fillWeek(s, 1, position, ordered, 90);
    }
    const set = await boardSet(s);
    const standing = buildSeasonStanding({
      profileId: me.id,
      set,
      classFilter: classFilterForStanding({ profileType: "HUMAN" }),
    });

    const cell = (scope: string) => standing.cells.find((c) => c.scope === scope)!;
    const overall = await getSeasonLeaderboard({ seasonId: s.id });
    const mine = overall.find((r) => r.universalProfileId === me.id)!;
    expect(cell("OVERALL")).toMatchObject({
      rank: mine.rank,
      averageScore: mine.averageScore,
      fieldSize: overall.length,
      contestsPlayed: 4,
    });
    expect(mine.averageScore).toBeCloseTo((90 + 89 + 88 + 86) / 4);
    expect(cell("QB")).toMatchObject({ rank: 1, averageScore: 90, fieldSize: 5 });
    expect(cell("RB")).toMatchObject({ rank: 2, averageScore: 89 });
    expect(cell("WR")).toMatchObject({ rank: 3, averageScore: 88 });
    expect(cell("TE")).toMatchObject({ rank: 5, averageScore: 86 });
    expect(cell("DEF")).toMatchObject({ rank: null, averageScore: null, contestsPlayed: 0 });
    expect(standing.strongestPosition?.scope).toBe("QB");
    expect(standing.classRank?.label).toBe("among Public rankers");
    expect(standing.seasonActive).toBe(true);
    expect(standing.seasonFinalized).toBe(false);
  });

  it("handles a profile with no graded boards gracefully", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    fillWeek(s, 1, "QB", field("r", 3), 80);
    const standing = buildSeasonStanding({
      profileId: "nobody",
      set: await boardSet(s),
      classFilter: classFilterForStanding({ profileType: "HUMAN" }),
    });
    expect(standing.cells.every((c) => c.rank == null)).toBe(true);
    expect(standing.strongestPosition).toBeNull();
    expect(standing.classRank).toBeNull();
  });
});

const titles = (tc: TrophyCase) => tc.trophies.map((t) => t.title);
const derive = async (id: string, ...seasons: SeasonWorld[]) =>
  deriveTrophyCase({
    profileId: id,
    username: id,
    sets: await Promise.all(seasons.map(boardSet)),
  });

describe("weekly podium placements", () => {
  it("awards Overall and Position Champion / Runner-Up / Third Place with receipts", async () => {
    const s = season({ weeks: [3] });
    const me = profile("me");
    const rivals = field("r", 9);
    fillWeek(s, 3, "WR", [me, ...rivals], 95); // WR #1
    fillWeek(s, 3, "QB", [rivals[0], me, ...rivals.slice(1)], 70); // QB #2
    fillWeek(s, 3, "TE", [rivals[0], rivals[1], me, ...rivals.slice(2)], 60); // TE #3
    fillWeek(s, 3, "RB", [...rivals.slice(0, 3), me, ...rivals.slice(3)], 60); // RB #4
    const tc = await derive("me", s);

    // Overall: me avg 69.75 / best 95 edges r01 (avg 69.75 / best 93) for #2.
    expect(titles(tc)).toEqual([
      "Week 3 WR Champion",
      "Week 3 Overall Runner-Up",
      "Week 3 QB Runner-Up",
      "Week 3 TE Third Place",
    ]);
    const wr = tc.trophies[0];
    expect(wr).toMatchObject({ place: 1, tied: false, subtitle: "2026 season" });
    expect(wr.href).toBe(profileBoardHref("me", 2026, 3, "WR"));
    expect(wr.href).toBe("/profile/me/rankings/3/wr?season=2026");
    expect(tc.counts).toMatchObject({ weeklyPositionWins: 1, weeklyOverallWins: 0, weeklyPodiums: 4 });

    const leader = await derive("r00", s);
    expect(titles(leader)).toContain("Week 3 Overall Champion");
    expect(leader.trophies.find((t) => t.kind === "WEEKLY_OVERALL_PLACEMENT")?.href).toBe(
      "/profile/r00?tab=rankiq#season-2026-week-3",
    );
  });

  it("awards Overall Runner-Up and Third Place on the weekly overall board", async () => {
    const s = season({ weeks: [2], positions: ["QB"] });
    const [a, b, c, d] = field("p", 4);
    fillWeek(s, 2, "QB", [a, b, c, d], 90);
    expect(titles(await derive(b.id, s))).toEqual([
      "Week 2 Overall Runner-Up",
      "Week 2 QB Runner-Up",
    ]);
    expect(titles(await derive(c.id, s))).toEqual([
      "Week 2 Overall Third Place",
      "Week 2 QB Third Place",
    ]);
    expect(titles(await derive(d.id, s))).toEqual([]);
  });

  it("does not award weekly overall until every contest that week is final", async () => {
    const s = season({
      weeks: [4],
      positions: ["QB", "RB"],
      status: (_w, position) => (position === "RB" ? "LOCKED" : "FINAL"),
    });
    const me = profile("me");
    fillWeek(s, 4, "QB", [me, ...field("r", 4)], 90);
    fillWeek(s, 4, "RB", [me, ...field("r", 4)], 90); // not loaded: contest not final
    const tc = await derive("me", s);
    expect(tc.trophies.map((t) => t.kind)).toEqual(["WEEKLY_POSITION_PLACEMENT"]);
    expect(tc.topTenFinishes.every((f) => f.scope !== "OVERALL")).toBe(true);
  });
});

describe("competitive ties (display name never awards hardware)", () => {
  it("shares #1 when performance is identical; display order stays deterministic", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    const alpha = profile("alpha");
    const zulu = profile("zulu");
    score(s, 1, "QB", zulu, 90);
    score(s, 1, "QB", alpha, 90);
    fillWeek(s, 1, "QB", field("p", 8), 80);
    const set = await boardSet(s);

    const board = set.weeks[0].overall;
    expect(board.slice(0, 2).map((r) => [r.username, r.rank])).toEqual([
      ["alpha", 1],
      ["zulu", 2],
    ]);
    const ranks = competitiveRanks(board);
    expect(ranks.get("alpha")).toBe(1);
    expect(ranks.get("zulu")).toBe(1);
    expect(ranks.get("p00")).toBe(3);

    for (const id of ["alpha", "zulu"]) {
      const tc = deriveTrophyCase({ profileId: id, username: id, sets: [set] });
      expect(titles(tc)).toEqual(["Week 1 Overall Champion", "Week 1 QB Champion"]);
      expect(tc.trophies.every((t) => t.tied && t.subtitle === "2026 season · Tied")).toBe(
        true,
      );
    }
    // Competition ranking: after a shared #1 the next placement is #3 — no Runner-Up.
    const next = deriveTrophyCase({ profileId: "p00", username: "p00", sets: [set] });
    expect(titles(next)).toEqual(["Week 1 Overall Third Place", "Week 1 QB Third Place"]);
    expect(next.trophies.every((t) => !t.tied)).toBe(true);
  });

  it("uses best score (performance) before treating equal averages as tied", async () => {
    const s = season({ weeks: [1], positions: ["QB", "RB"] });
    const steady = profile("aaa_steady");
    const spiky = profile("zzz_spiky");
    score(s, 1, "QB", steady, 80);
    score(s, 1, "RB", steady, 80);
    score(s, 1, "QB", spiky, 90);
    score(s, 1, "RB", spiky, 70);
    const set = await boardSet(s);
    expect(set.weeks[0].overall.map((r) => r.username)).toEqual(["zzz_spiky", "aaa_steady"]);
    expect(titles(deriveTrophyCase({ profileId: "zzz_spiky", username: "x", sets: [set] })))
      .toContain("Week 1 Overall Champion");
    expect(titles(deriveTrophyCase({ profileId: "aaa_steady", username: "x", sets: [set] })))
      .toContain("Week 1 Overall Runner-Up");
  });

  it("shares #2 and #3 placements on exact ties", async () => {
    const s = season({ weeks: [5], positions: ["WR"] });
    score(s, 5, "WR", profile("leader"), 99);
    score(s, 5, "WR", profile("bravo"), 90);
    score(s, 5, "WR", profile("alpha"), 90);
    score(s, 5, "WR", profile("fourth"), 80);
    score(s, 5, "WR", profile("yankee"), 70);
    score(s, 5, "WR", profile("xray"), 70);
    score(s, 5, "WR", profile("last"), 60);
    const set = await boardSet(s);
    const wr = (id: string) =>
      deriveTrophyCase({ profileId: id, username: id, sets: [set] }).trophies.find(
        (t) => t.position === "WR",
      );
    expect(wr("alpha")).toMatchObject({ title: "Week 5 WR Runner-Up", tied: true });
    expect(wr("bravo")).toMatchObject({ title: "Week 5 WR Runner-Up", tied: true });
    // 1, 2, 2 → the next profile is placement 4: no Third Place is awarded.
    expect(wr("fourth")).toBeUndefined();

    const s2 = season({ id: "s2", weeks: [6], positions: ["WR"] });
    score(s2, 6, "WR", profile("one"), 99);
    score(s2, 6, "WR", profile("two"), 95);
    score(s2, 6, "WR", profile("yankee"), 70);
    score(s2, 6, "WR", profile("xray"), 70);
    score(s2, 6, "WR", profile("five"), 60);
    const set2 = await boardSet(s2);
    for (const id of ["xray", "yankee"]) {
      const trophy = deriveTrophyCase({ profileId: id, username: id, sets: [set2] }).trophies.find(
        (t) => t.position === "WR",
      );
      expect(trophy).toMatchObject({ title: "Week 6 WR Third Place", place: 3, tied: true });
    }
  });
});

describe("Top 10%", () => {
  it("uses placement ≤ max(1, ceil(N × 0.10)) on the applicable board", () => {
    expect(isWeeklyTopTen(2, 20)).toBe(true);
    expect(isWeeklyTopTen(3, 20)).toBe(false);
    expect(isWeeklyTopTen(3, 21)).toBe(true);
    expect(isWeeklyTopTen(1, 5)).toBe(true);
    expect(isWeeklyTopTen(2, 5)).toBe(false);
  });

  it("applies the boundary to real weekly boards", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    fillWeek(s, 1, "QB", field("p", 20), 99);
    const set = await boardSet(s);
    const top10 = (id: string) =>
      deriveTrophyCase({ profileId: id, username: id, sets: [set] }).topTenFinishes.map(
        (f) => f.scope,
      );
    expect(top10("p01")).toEqual(["OVERALL", "QB"]); // placement 2 of 20
    expect(top10("p02")).toEqual([]); // placement 3 of 20
  });

  it("includes every profile tied at a qualifying placement across the cutoff", async () => {
    // N = 20 → cutoff 2. zulu and alpha share placement 2 → both qualify (3 total).
    const s = season({ weeks: [1], positions: ["QB"] });
    score(s, 1, "QB", profile("leader"), 99);
    score(s, 1, "QB", profile("zulu"), 90);
    score(s, 1, "QB", profile("alpha"), 90);
    fillWeek(s, 1, "QB", field("q", 17), 80);
    const set = await boardSet(s);
    expect(set.weeks[0].overall).toHaveLength(20);
    for (const id of ["alpha", "zulu"]) {
      const tc = deriveTrophyCase({ profileId: id, username: id, sets: [set] });
      expect(tc.topTenFinishes).toHaveLength(2);
      expect(tc.topTenFinishes[0]).toMatchObject({ placement: 2, tied: true, fieldSize: 20 });
    }
    const q00 = deriveTrophyCase({ profileId: "q00", username: "q00", sets: [set] });
    expect(q00.topTenFinishes).toEqual([]); // placement 4

    // A tie that starts after the cutoff does not qualify.
    const s2 = season({ id: "s2", weeks: [1], positions: ["QB"] });
    score(s2, 1, "QB", profile("one"), 99);
    score(s2, 1, "QB", profile("two"), 95);
    score(s2, 1, "QB", profile("alpha"), 90);
    score(s2, 1, "QB", profile("zulu"), 90);
    fillWeek(s2, 1, "QB", field("q", 16), 80);
    const set2 = await boardSet(s2);
    for (const id of ["alpha", "zulu"]) {
      expect(
        deriveTrophyCase({ profileId: id, username: id, sets: [set2] }).topTenFinishes,
      ).toEqual([]);
    }
  });
});

describe("Hot Streak", () => {
  function streakWorld(placements: Array<number | null>, opts: { active?: boolean } = {}) {
    const weeks = placements.map((_, i) => i + 1);
    const s = season({ weeks, positions: ["QB"], active: opts.active ?? true });
    const me = profile("me");
    const rivals = field("r", 19);
    placements.forEach((place, i) => {
      const ordered = [...rivals];
      if (place != null) ordered.splice(place - 1, 0, me);
      fillWeek(s, i + 1, "QB", ordered, 99);
    });
    return s;
  }

  it("counts 3 consecutive Top-10% overall weeks, linking the last week", async () => {
    const tc = await derive("me", streakWorld([1, 2, 2]));
    expect(tc.hotStreak.current).toMatchObject({
      fromWeek: 1,
      toWeek: 3,
      length: 3,
      href: "/profile/me?tab=rankiq#season-2026-week-3",
    });
    expect(tc.hotStreak.longest).toMatchObject({ length: 3 });
  });

  it("breaks on a non-Top-10% week and keeps the longest", async () => {
    const tc = await derive("me", streakWorld([1, 1, 1, 1, 5, 2, 1]));
    expect(tc.hotStreak.longest).toMatchObject({ fromWeek: 1, toWeek: 4, length: 4 });
    expect(tc.hotStreak.current).toBeNull(); // weeks 6–7 is only 2 long
  });

  it("breaks on a missed / non-participating week", async () => {
    const tc = await derive("me", streakWorld([1, 1, null, 1, 1]));
    expect(tc.hotStreak.longest).toBeNull();
    expect(tc.hotStreak.current).toBeNull();
  });

  it("is not earned by climbing the leaderboard without Top-10% weeks", async () => {
    const tc = await derive("me", streakWorld([15, 10, 6, 3]));
    expect(tc.hotStreak.longest).toBeNull();
  });

  it("ignores a week that is not yet final", async () => {
    const s = season({
      weeks: [1, 2, 3],
      positions: ["QB"],
      status: (week) => (week === 3 ? "GRADING" : "FINAL"),
    });
    const me = profile("me");
    for (const week of [1, 2, 3]) fillWeek(s, week, "QB", [me, ...field("r", 9)], 90);
    const tc = await derive("me", s);
    expect(tc.hotStreak.longest).toBeNull();
    expect(tc.counts).toMatchObject({ weeksPlayed: 2, weeksEligible: 2 });
  });
});

describe("season championships", () => {
  function seasonOf(opts: { active: boolean; lastStatus?: string }) {
    const s = season({
      weeks: [1, 2],
      positions: ["QB", "WR"],
      active: opts.active,
      status: (week) => (week === 2 && opts.lastStatus ? opts.lastStatus : "FINAL"),
    });
    const me = profile("me");
    const rivals = field("r", 4);
    for (const week of [1, 2]) {
      fillWeek(s, week, "QB", [me, ...rivals], 90);
      fillWeek(s, week, "WR", [...rivals, me], 90);
    }
    return s;
  }

  const anyone: SeasonChampionshipEligibility = { id: "test-any", isEligible: () => true };

  it("suppresses season titles without an approved participation rule", async () => {
    const s = seasonOf({ active: false });
    const set = await boardSet(s);
    for (const id of ["me", "r00"]) {
      const tc = deriveTrophyCase({ profileId: id, username: id, sets: [set] });
      expect(tc.seasonChampionshipsEnabled).toBe(false);
      expect(tc.trophies.filter((t) => t.tier === "season")).toEqual([]);
      expect(tc.counts.seasonTitles).toBe(0);
    }
    // Weekly hardware is unaffected by the gate.
    const me = deriveTrophyCase({ profileId: "me", username: "me", sets: [set] });
    expect(titles(me)).toContain("Week 2 QB Champion");
  });

  it("never awards season titles during an active season, even with a rule", async () => {
    const s = seasonOf({ active: true });
    const tc = deriveTrophyCase({
      profileId: "me",
      username: "me",
      sets: [await boardSet(s)],
      seasonChampionshipEligibility: anyone,
    });
    expect(tc.trophies.filter((t) => t.tier === "season")).toEqual([]);
  });

  it("does not award before every contest is final, even if inactive", async () => {
    const s = seasonOf({ active: false, lastStatus: "GRADING" });
    const tc = deriveTrophyCase({
      profileId: "me",
      username: "me",
      sets: [await boardSet(s)],
      seasonChampionshipEligibility: anyone,
    });
    expect(tc.trophies.filter((t) => t.tier === "season")).toEqual([]);
  });

  it("with an approved rule, awards Season Overall + Position Champion once finalized", async () => {
    const s = seasonOf({ active: false });
    const set = await boardSet(s);
    // me: QB 90, WR 86 → avg 88; r00: QB 89, WR 90 → avg 89.5 (overall #1).
    expect(set.seasonOverall[0].universalProfileId).toBe("r00");
    const seasonTitles = (id: string, rule = anyone) =>
      deriveTrophyCase({
        profileId: id,
        username: id,
        sets: [set],
        seasonChampionshipEligibility: rule,
      })
        .trophies.filter((t) => t.tier === "season")
        .map((t) => [t.title, t.href]);
    expect(seasonTitles("me")).toEqual([["2026 Season QB Champion", null]]);
    expect(seasonTitles("r00")).toEqual([
      ["2026 Season Overall Champion", null],
      ["2026 Season WR Champion", null],
    ]);

    // The rule filters the field before placement is computed.
    const excludeTop: SeasonChampionshipEligibility = {
      id: "test-exclude",
      isEligible: ({ row }) => !["r00", "r01"].includes(row.universalProfileId),
    };
    expect(seasonTitles("me", excludeTop).map(([t]) => t)).toEqual([
      "2026 Season Overall Champion",
      "2026 Season QB Champion",
    ]);
  });
});

describe("profile classes", () => {
  it.each([
    ["HUMAN", null, "among Public rankers"],
    ["CREATOR", null, "among Creators"],
    ["BENCHMARK", "ANALYST", "among Experts"],
    ["AI", null, "among AI"],
  ] as const)("%s profiles earn hardware on the full field", async (profileType, sourceKind, label) => {
    const s = season({ weeks: [1], positions: ["TE"] });
    const me = profile("me", profileType, sourceKind);
    fillWeek(s, 1, "TE", [me, ...field("r", 9)], 90);
    const set = await boardSet(s);
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [set] });
    expect(titles(tc)).toEqual(["Week 1 Overall Champion", "Week 1 TE Champion"]);
    const standing = buildSeasonStanding({
      profileId: "me",
      set,
      classFilter: classFilterForStanding({ profileType, isPublisherConsensus: false }),
    });
    expect(standing.cells[0].rank).toBe(1);
    expect(standing.classRank).toMatchObject({ label, rank: 1 });
  });

  it("keeps legacy publisher shells off boards and out of the Trophy Case", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    score(s, 1, "QB", profile("legacy", "BENCHMARK", "PUBLISHER"), 99);
    fillWeek(s, 1, "QB", field("r", 5), 80);
    const tc = await derive("legacy", s);
    expect(tc.trophies).toEqual([]);
    expect(tc.counts.weeksPlayed).toBe(0);
  });
});

describe("season-aware receipts", () => {
  it("a 2026 achievement never resolves to the same-numbered 2027 week", async () => {
    const s26 = season({ id: "s2026", year: 2026, active: false, weeks: [4], positions: ["WR"] });
    const s27 = season({ id: "s2027", year: 2027, active: true, weeks: [4], positions: ["WR"] });
    const me = profile("me");
    fillWeek(s26, 4, "WR", [me, ...field("r", 9)], 90);
    fillWeek(s27, 4, "WR", [...field("r", 9), me], 90);
    const tc = await derive("me", s26, s27);

    const wr = tc.trophies.find((t) => t.position === "WR")!;
    expect(wr).toMatchObject({ title: "Week 4 WR Champion", seasonYear: 2026, weekNumber: 4 });
    expect(wr.subtitle).toBe("2026 season");
    expect(wr.href).toBe("/profile/me/rankings/4/wr?season=2026");
    const overall = tc.trophies.find((t) => t.kind === "WEEKLY_OVERALL_PLACEMENT")!;
    expect(overall.href).toBe("/profile/me?tab=rankiq#season-2026-week-4");
    expect(tc.trophies.every((t) => !t.href?.includes("2027"))).toBe(true);
    expect(weeklyReceiptsHref("me", 2027, 4)).not.toBe(overall.href);
  });
});

describe("#1 Calls", () => {
  it("requires predicted #1 AND actual #1", () => {
    expect(isNumberOneCall({ predictedRank: 1, actualRank: 1 })).toBe(true);
    expect(isNumberOneCall({ predictedRank: 4, actualRank: 1 })).toBe(false);
    expect(isNumberOneCall({ predictedRank: 1, actualRank: 2 })).toBe(false);
    expect(isNumberOneCall({ predictedRank: 1, actualRank: null })).toBe(false);
    expect(isNumberOneCall({ predictedRank: 2, actualRank: 2 })).toBe(false);
  });
});

describe("integrity", () => {
  it("derives without mutating graded inputs or calling writes", async () => {
    const s = season({ weeks: [1, 2, 3], positions: ["QB", "RB"] });
    const me = profile("me");
    for (const week of [1, 2, 3]) {
      fillWeek(s, week, "QB", [me, ...field("r", 9)], 90);
      fillWeek(s, week, "RB", [...field("r", 9), me], 90);
    }
    const before = JSON.stringify(s.results);
    const set = await boardSet(s);
    const snapshot = JSON.stringify(set);
    deriveTrophyCase({ profileId: "me", username: "me", sets: [set] });
    buildSeasonStanding({
      profileId: "me",
      set,
      classFilter: classFilterForStanding({ profileType: "HUMAN" }),
    });
    expect(JSON.stringify(s.results)).toBe(before);
    expect(JSON.stringify(set)).toBe(snapshot);
    expect(new Set(db.calls)).toEqual(
      new Set(["season.findUnique", "rankIQContest.findMany", "rankingSubmission.findMany"]),
    );
  });

  it("keeps historical hardware stable when a later week is added", async () => {
    const s = season({ weeks: [1, 2, 3], positions: ["QB"] });
    const me = profile("me");
    const rivals = field("r", 9);
    for (const week of [1, 2, 3]) fillWeek(s, week, "QB", [me, ...rivals], 90);
    const first = await derive("me", s);

    s.contests.push({ weekNumber: 4, position: "QB", status: "GRADING" });
    fillWeek(s, 4, "QB", [...rivals, me], 99);
    const inProgress = await derive("me", s);
    expect(inProgress.trophies).toEqual(first.trophies);
    expect(inProgress.topTenFinishes).toEqual(first.topTenFinishes);

    s.contests[s.contests.length - 1].status = "FINAL";
    const finalized = await derive("me", s);
    const early = (tc: TrophyCase) =>
      tc.trophies.filter((t) => (t.weekNumber ?? 0) <= 3).map((t) => t.id);
    expect(early(finalized)).toEqual(early(first));
    expect(finalized.hotStreak.longest).toMatchObject({ fromWeek: 1, toWeek: 3 });
    expect(finalized.hotStreak.current).toBeNull();
  });

  it("resets streaks per season", async () => {
    const s25 = season({ id: "s2025", year: 2025, active: false, weeks: [17, 18], positions: ["QB"] });
    const s26 = season({ id: "s2026", year: 2026, active: true, weeks: [1], positions: ["QB"] });
    const me = profile("me");
    const rivals = field("r", 9);
    fillWeek(s25, 17, "QB", [me, ...rivals], 90);
    fillWeek(s25, 18, "QB", [me, ...rivals], 90);
    fillWeek(s26, 1, "QB", [me, ...rivals], 90);
    const tc = await derive("me", s25, s26);
    expect(tc.hotStreak.longest).toBeNull();
    expect(tc.trophies.find((t) => t.id === "weekly-overall-2025-17")?.subtitle).toBe(
      "2025 season",
    );
  });

  it("does not derive Founding Ranker", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    fillWeek(s, 1, "QB", field("r", 3), 80);
    const tc = await derive("r00", s);
    expect(tc.trophies.some((t) => t.kind === "FOUNDING_RANKER")).toBe(false);
  });
});

describe("#1 Calls wiring", () => {
  it("profile stats count #1 Calls only via isNumberOneCall (not the #1 Hits rule)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/profile-stats.ts", "utf8");
    expect(source).toMatch(/if \(isNumberOneCall\(pick\)\) numberOneCalls \+= 1;/);
    expect(source.match(/numberOneCalls \+= 1/g)).toHaveLength(1);
  });

  it("season standing medals follow competitive placement, ranks stay canonical", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    score(s, 1, "QB", profile("zulu"), 90);
    score(s, 1, "QB", profile("alpha"), 90);
    score(s, 1, "QB", profile("third"), 80);
    const set = await boardSet(s);
    const cell = (id: string) =>
      buildSeasonStanding({
        profileId: id,
        set,
        classFilter: classFilterForStanding({ profileType: "HUMAN" }),
      }).cells[0];
    expect(cell("alpha")).toMatchObject({ rank: 1, placement: 1, tied: true });
    expect(cell("zulu")).toMatchObject({ rank: 2, placement: 1, tied: true });
    expect(cell("third")).toMatchObject({ rank: 3, placement: 3, tied: false });
  });
});
