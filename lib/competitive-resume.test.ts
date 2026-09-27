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
  isWeeklyTopTen,
  positionBoardHref,
  weeklyReceiptsHref,
} from "@/lib/competitive-resume";
import {
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

describe("weekly championships", () => {
  it("awards Weekly Overall Champion and Position Weekly Champion with receipt links", async () => {
    const s = season({ weeks: [3] });
    const me = profile("me");
    const rivals = field("r", 9);
    fillWeek(s, 3, "WR", [me, ...rivals], 95); // #1 WR
    fillWeek(s, 3, "QB", [...rivals.slice(0, 1), me, ...rivals.slice(1)], 70); // #2 QB
    const tc = deriveTrophyCase({ profileId: me.id, username: "me", sets: [await boardSet(s)] });

    const overall = tc.trophies.find((t) => t.kind === "WEEKLY_OVERALL_CHAMPION");
    expect(overall).toMatchObject({
      title: "Week 3 Overall Champion",
      href: weeklyReceiptsHref("me", 3),
    });
    expect(overall?.href).toBe("/profile/me?tab=rankiq#week-3");

    const positional = tc.trophies.filter((t) => t.kind === "WEEKLY_POSITION_CHAMPION");
    expect(positional.map((t) => t.title)).toEqual(["Week 3 WR Champion"]);
    expect(positional[0].href).toBe(positionBoardHref("me", 3, "WR"));
    expect(positional[0].href).toBe("/profile/me/rankings/3/wr");
    expect(tc.counts).toMatchObject({ weeklyOverallWins: 1, weeklyPositionWins: 1 });
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
    const tc = deriveTrophyCase({ profileId: me.id, username: "me", sets: [await boardSet(s)] });
    expect(tc.trophies.map((t) => t.kind)).toEqual(["WEEKLY_POSITION_CHAMPION"]);
    expect(tc.topTenFinishes.every((f) => f.scope !== "OVERALL")).toBe(true);
  });
});

describe("Top 10%", () => {
  it("uses rank ≤ max(1, ceil(N × 0.10)) on the applicable board", () => {
    expect(isWeeklyTopTen(2, 20)).toBe(true);
    expect(isWeeklyTopTen(3, 20)).toBe(false);
    expect(isWeeklyTopTen(3, 21)).toBe(true);
    expect(isWeeklyTopTen(1, 5)).toBe(true);
    expect(isWeeklyTopTen(2, 5)).toBe(false);
  });

  it("applies the boundary to real weekly boards", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    const rankers = field("p", 20);
    fillWeek(s, 1, "QB", rankers, 99);
    const set = await boardSet(s);
    const top10 = (id: string) =>
      deriveTrophyCase({ profileId: id, username: id, sets: [set] }).topTenFinishes.map(
        (f) => f.scope,
      );
    expect(top10("p01")).toEqual(["OVERALL", "QB"]); // rank 2 of 20
    expect(top10("p02")).toEqual([]); // rank 3 of 20
  });

  it("breaks ties with the canonical order (best score, then display name)", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    const rankers = field("p", 18);
    const alpha = profile("alpha");
    const zulu = profile("zulu");
    score(s, 1, "QB", profile("leader"), 99);
    score(s, 1, "QB", zulu, 90);
    score(s, 1, "QB", alpha, 90); // tied average with zulu
    fillWeek(s, 1, "QB", rankers, 80);
    const set = await boardSet(s);
    expect(set.weeks[0].overall.length).toBe(21); // cutoff = ceil(2.1) = 3
    const tcAlpha = deriveTrophyCase({ profileId: "alpha", username: "alpha", sets: [set] });
    const tcZulu = deriveTrophyCase({ profileId: "zulu", username: "zulu", sets: [set] });
    expect(tcAlpha.topTenFinishes[0]).toMatchObject({ rank: 2 });
    expect(tcZulu.topTenFinishes[0]).toMatchObject({ rank: 3 });

    const s2 = season({ id: "s2", weeks: [1], positions: ["QB"] });
    score(s2, 1, "QB", profile("leader"), 99);
    score(s2, 1, "QB", zulu, 90);
    score(s2, 1, "QB", alpha, 90);
    fillWeek(s2, 1, "QB", field("q", 17), 80); // N = 20 → cutoff 2
    const set2 = await boardSet(s2);
    expect(
      deriveTrophyCase({ profileId: "alpha", username: "alpha", sets: [set2] }).topTenFinishes,
    ).toHaveLength(2);
    expect(
      deriveTrophyCase({ profileId: "zulu", username: "zulu", sets: [set2] }).topTenFinishes,
    ).toHaveLength(0);
  });
});

describe("Hot Streak", () => {
  function streakWorld(
    placements: Array<number | null>,
    opts: { active?: boolean } = {},
  ) {
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

  it("awards a streak for 3 consecutive Top-10% overall weeks", async () => {
    const s = streakWorld([1, 2, 2]);
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [await boardSet(s)] });
    expect(tc.hotStreak.current).toMatchObject({ fromWeek: 1, toWeek: 3, length: 3 });
    expect(tc.hotStreak.longest).toMatchObject({ length: 3 });
    const trophy = tc.trophies.find((t) => t.kind === "HOT_STREAK");
    expect(trophy).toMatchObject({
      title: "Hot Streak · 3 weeks",
      subtitle: "Top 10% overall, Weeks 1–3",
      href: "/profile/me?tab=rankiq#week-3",
    });
  });

  it("breaks on a non-Top-10% week and keeps the longest", async () => {
    const s = streakWorld([1, 1, 1, 1, 5, 2, 1]);
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [await boardSet(s)] });
    expect(tc.hotStreak.longest).toMatchObject({ fromWeek: 1, toWeek: 4, length: 4 });
    expect(tc.hotStreak.current).toBeNull(); // weeks 6–7 is only 2 long
  });

  it("breaks on a missed / non-participating week", async () => {
    const s = streakWorld([1, 1, null, 1, 1]);
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [await boardSet(s)] });
    expect(tc.hotStreak.longest).toBeNull();
    expect(tc.trophies.some((t) => t.kind === "HOT_STREAK")).toBe(false);
  });

  it("is not earned by climbing the leaderboard without Top-10% weeks", async () => {
    const s = streakWorld([15, 10, 6, 3]);
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [await boardSet(s)] });
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
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [await boardSet(s)] });
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

  it("never awards season titles during an active season", async () => {
    const s = seasonOf({ active: true });
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [await boardSet(s)] });
    expect(tc.trophies.filter((t) => t.tier === "season")).toEqual([]);
    expect(tc.counts.seasonTitles).toBe(0);
  });

  it("does not award before every contest is final, even if inactive", async () => {
    const s = seasonOf({ active: false, lastStatus: "GRADING" });
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [await boardSet(s)] });
    expect(tc.trophies.filter((t) => t.tier === "season")).toEqual([]);
  });

  it("awards Season Overall + Position Champion once finalized", async () => {
    const s = seasonOf({ active: false });
    const set = await boardSet(s);
    const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [set] });
    const seasonTitles = tc.trophies.filter((t) => t.tier === "season");
    // me: QB 90, WR 86 → avg 88; r00: QB 89, WR 90 → avg 89.5 (overall #1).
    expect(set.seasonOverall[0].universalProfileId).toBe("r00");
    expect(seasonTitles.map((t) => t.title)).toEqual(["2026 Season QB Champion"]);
    expect(seasonTitles.every((t) => t.href === null)).toBe(true);

    const rival = deriveTrophyCase({ profileId: "r00", username: "r00", sets: [set] });
    expect(rival.trophies.filter((t) => t.tier === "season").map((t) => t.title)).toEqual([
      "2026 Season Overall Champion",
      "2026 Season WR Champion",
    ]);
  });
});

describe("profile classes", () => {
  it.each([
    ["HUMAN", null, "among Public rankers"],
    ["CREATOR", null, "among Creators"],
    ["BENCHMARK", "ANALYST", "among Experts"],
    ["AI", null, "among AI"],
  ] as const)(
    "%s profiles earn trophies on the full field",
    async (profileType, sourceKind, label) => {
      const s = season({ weeks: [1], positions: ["TE"] });
      const me = profile("me", profileType, sourceKind);
      fillWeek(s, 1, "TE", [me, ...field("r", 9)], 90);
      const set = await boardSet(s);
      const tc = deriveTrophyCase({ profileId: "me", username: "me", sets: [set] });
      expect(tc.trophies.map((t) => t.kind)).toEqual([
        "WEEKLY_OVERALL_CHAMPION",
        "WEEKLY_POSITION_CHAMPION",
      ]);
      const standing = buildSeasonStanding({
        profileId: "me",
        set,
        classFilter: classFilterForStanding({
          profileType,
          isPublisherConsensus: false,
        }),
      });
      expect(standing.cells[0].rank).toBe(1);
      expect(standing.classRank).toMatchObject({ label, rank: 1 });
    },
  );

  it("keeps legacy publisher shells off boards and out of the Trophy Case", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    const legacy = profile("legacy", "BENCHMARK", "PUBLISHER");
    score(s, 1, "QB", legacy, 99);
    fillWeek(s, 1, "QB", field("r", 5), 80);
    const tc = deriveTrophyCase({
      profileId: "legacy",
      username: "legacy",
      sets: [await boardSet(s)],
    });
    expect(tc.trophies).toEqual([]);
    expect(tc.counts.weeksPlayed).toBe(0);
  });
});

describe("integrity", () => {
  it("derives without mutating graded inputs or calling scoring/writes", async () => {
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

  it("keeps historical trophies stable when a later week is added", async () => {
    const s = season({ weeks: [1, 2, 3], positions: ["QB"] });
    const me = profile("me");
    const rivals = field("r", 9);
    for (const week of [1, 2, 3]) fillWeek(s, week, "QB", [me, ...rivals], 90);
    const first = deriveTrophyCase({ profileId: "me", username: "me", sets: [await boardSet(s)] });

    s.contests.push({ weekNumber: 4, position: "QB", status: "GRADING" });
    fillWeek(s, 4, "QB", [...rivals, me], 99);
    const inProgress = deriveTrophyCase({
      profileId: "me",
      username: "me",
      sets: [await boardSet(s)],
    });
    expect(inProgress.trophies).toEqual(first.trophies);
    expect(inProgress.topTenFinishes).toEqual(first.topTenFinishes);

    s.contests[s.contests.length - 1].status = "FINAL";
    const finalized = deriveTrophyCase({
      profileId: "me",
      username: "me",
      sets: [await boardSet(s)],
    });
    const weekly = (tc: typeof first) =>
      tc.trophies.filter((t) => t.tier === "weekly").map((t) => t.id);
    expect(weekly(finalized)).toEqual(weekly(first));
    expect(finalized.hotStreak.longest).toMatchObject({ fromWeek: 1, toWeek: 3 });
    expect(finalized.hotStreak.current).toBeNull();
  });

  it("resets streaks per season and labels multi-season trophies", async () => {
    const s25 = season({ id: "s2025", year: 2025, active: false, weeks: [17, 18], positions: ["QB"] });
    const s26 = season({ id: "s2026", year: 2026, active: true, weeks: [1], positions: ["QB"] });
    const me = profile("me");
    const rivals = field("r", 9);
    fillWeek(s25, 17, "QB", [me, ...rivals], 90);
    fillWeek(s25, 18, "QB", [me, ...rivals], 90);
    fillWeek(s26, 1, "QB", [me, ...rivals], 90);
    const tc = deriveTrophyCase({
      profileId: "me",
      username: "me",
      sets: [await boardSet(s25), await boardSet(s26)],
    });
    expect(tc.hotStreak.longest).toBeNull();
    expect(tc.trophies.find((t) => t.id === "weekly-overall-2025-17")?.subtitle).toBe(
      "2025 season",
    );
    expect(tc.trophies.map((t) => t.kind)).toContain("SEASON_OVERALL_CHAMPION");
  });

  it("threads awarded honors without deriving Founding Ranker", async () => {
    const s = season({ weeks: [1], positions: ["QB"] });
    fillWeek(s, 1, "QB", field("r", 3), 80);
    const set = await boardSet(s);
    const derived = deriveTrophyCase({ profileId: "r00", username: "r00", sets: [set] });
    expect(derived.trophies.some((t) => t.kind === "FOUNDING_RANKER")).toBe(false);
  });
});
