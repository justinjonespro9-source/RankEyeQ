import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getLiveContestRankerBoard, getLiveWeekRankerBoard } from "@/lib/live-rankiq";
import { scoreProvisionalEyeq } from "@/lib/live-provisional";
import { getRankIQProfileView } from "@/lib/profile-stats";
import { getPublicProfileBoard } from "@/lib/public-board";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { getThursdayReceipts } from "@/lib/timing/thursday-receipts";

const suffix = `pse${Date.now().toString(36)}`;
const seasonYear = 3800 + (Date.now() % 90);

type ProfileKey =
  | "humanPublic"
  | "humanHidden"
  | "expertInactive"
  | "creatorPrivate"
  | "creatorGated"
  | "creatorRestricted"
  | "creatorOwner"
  | "ai";

describe("public-surface exposure hardening", () => {
  let seasonId = "";
  let adminUserId = "";
  const weekIds: Record<"w1" | "w2" | "wt", string> = { w1: "", w2: "", wt: "" };
  const contestIds: Record<"w1" | "w2" | "wt", string> = { w1: "", w2: "", wt: "" };
  const entryIds: Record<"w1" | "w2" | "wt", string[]> = { w1: [], w2: [], wt: [] };
  const ids = {} as Record<ProfileKey, string>;
  const usernames = {} as Record<ProfileKey, string>;

  async function makeWeek(key: "w1" | "w2" | "wt", weekNumber: number, isTest: boolean) {
    const day = 10 + (weekNumber - 1) * 7;
    const thursday = zonedLocalToUtc(2026, 9, day, 19, 15);
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber,
        label: `Exposure Week ${weekNumber}`,
        startsAt: thursday,
        endsAt: zonedLocalToUtc(2026, 9, day + 4, 23, 0),
        status: "OPEN",
        isTest,
        rankingsOpenAt: zonedLocalToUtc(2026, 9, day - 2, 9, 0),
        fullLockAt: zonedLocalToUtc(2026, 9, day + 3, 12, 0),
        revealStartsAt: zonedLocalToUtc(2026, 9, day + 3, 12, 0),
        publicReleaseAt: zonedLocalToUtc(2026, 9, day + 3, 12, 0),
      },
    });
    weekIds[key] = week.id;
    const game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `pse-${suffix}-${key}`,
        seasonId,
        weekId: week.id,
        seasonYear,
        weekNumber,
        homeTeam: "OPP",
        awayTeam: "TST",
        startsAt: thursday,
        status: "FINAL",
      },
    });
    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId: week.id,
        position: "RB",
        title: `Exposure RB ${weekNumber}`,
        rankingDepth: 2,
        reserveCount: 0,
        status: "OPEN",
      },
    });
    contestIds[key] = contest.id;
    for (const [index, points] of [30, 20, 10].entries()) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `pse-${suffix}-${key}-${index}`,
          type: "PLAYER",
          name: `${key.toUpperCase()} Back ${index + 1}`,
          shortName: `B${index + 1}`,
          team: "TST",
          opponent: "@ OPP",
          position: "RB",
          gameStartsAt: thursday,
          gameId: game.id,
        },
      });
      await prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          rankableEntryId: entry.id,
          gameId: game.id,
          fantasyPoints: points,
          actualRank: index + 1,
        },
      });
      entryIds[key].push(entry.id);
    }
    return thursday;
  }

  async function board(
    key: "w1" | "w2" | "wt",
    profile: ProfileKey,
    opts: { status?: "GRADED" | "LOCKED"; captured?: boolean; authority?: "OWNER_AUTHORED" | "RANKEYEQ_CAPTURED" } = {},
  ) {
    const week = await prisma.week.findUniqueOrThrow({ where: { id: weekIds[key] } });
    const committedAt = new Date(week.startsAt.getTime() - 60 * 60 * 1000);
    await prisma.rankingSubmission.create({
      data: {
        contestId: contestIds[key],
        universalProfileId: ids[profile],
        status: opts.status ?? "GRADED",
        authority: opts.authority,
        submittedAt: committedAt,
        normalizedScore: opts.status === "LOCKED" ? null : 100,
        rawScore: opts.status === "LOCKED" ? null : 100,
        picks: {
          create: entryIds[key].slice(0, 2).map((rankableEntryId, index) => ({
            rankableEntryId,
            predictedRank: index + 1,
            actualRank: index + 1,
            committedAt,
            sourceRank: opts.captured ? index + 1 : null,
          })),
        },
      },
    });
  }

  async function snapshot(
    key: "w1" | "w2" | "wt",
    profile: ProfileKey,
    data: { status: "LOCKED" | "NOT_AVAILABLE"; publicBoardAllowed: boolean },
  ) {
    await prisma.benchmarkSnapshot.create({
      data: {
        universalProfileId: ids[profile],
        contestId: contestIds[key],
        weekId: weekIds[key],
        captureType: "THURSDAY",
        capturedAt: new Date(),
        sourceUrl: "https://example.com/source",
        adminUserId,
        ...data,
      },
    });
  }

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: seasonYear, sport: "NFL", active: false },
    });
    seasonId = season.id;
    const admin = await prisma.user.create({
      data: { email: `pse-admin-${suffix}@rankiq.local`, role: "ADMIN" },
    });
    adminUserId = admin.id;

    await makeWeek("w1", 1, false);
    await makeWeek("w2", 2, false);
    await makeWeek("wt", 3, true);

    const make = async (
      key: ProfileKey,
      profileType: "HUMAN" | "BENCHMARK" | "CREATOR" | "AI",
      extra: { publicVisible?: boolean; competitorActive?: boolean; publicFromWeekId?: string } = {},
    ) => {
      const row = await prisma.universalProfile.create({
        data: {
          username: `${key.toLowerCase()}_${suffix}`.slice(0, 30),
          displayName: `${key} ${suffix}`,
          profileType,
          ...extra,
        },
      });
      ids[key] = row.id;
      usernames[key] = row.username;
    };
    await make("humanPublic", "HUMAN");
    await make("humanHidden", "HUMAN", { publicVisible: false });
    await make("expertInactive", "BENCHMARK", { competitorActive: false });
    await make("creatorPrivate", "CREATOR", { publicVisible: false });
    await make("creatorGated", "CREATOR", { publicFromWeekId: weekIds.w2 });
    await make("creatorRestricted", "CREATOR");
    await make("creatorOwner", "CREATOR");
    await make("ai", "AI");

    for (const key of Object.keys(ids) as ProfileKey[]) {
      if (key === "creatorRestricted") {
        await board("w1", key, { captured: true });
      } else if (key === "creatorOwner") {
        await board("w1", key, { authority: "OWNER_AUTHORED" });
      } else if (key === "expertInactive" || key === "creatorPrivate") {
        await board("w1", key, { captured: true });
      } else {
        await board("w1", key);
      }
    }
    await snapshot("w1", "creatorRestricted", { status: "LOCKED", publicBoardAllowed: false });
    await snapshot("w1", "creatorOwner", { status: "NOT_AVAILABLE", publicBoardAllowed: false });

    await board("w2", "creatorGated");
    await board("w2", "humanPublic");
    await board("wt", "humanPublic");
  });

  afterAll(async () => {
    const contests = Object.values(contestIds).filter(Boolean);
    await prisma.rankingPick.deleteMany({ where: { submission: { contestId: { in: contests } } } });
    await prisma.rankingSubmission.deleteMany({ where: { contestId: { in: contests } } });
    await prisma.benchmarkSnapshot.deleteMany({ where: { contestId: { in: contests } } });
    await prisma.universalProfile.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.contestEntry.deleteMany({ where: { contestId: { in: contests } } });
    await prisma.rankIQContest.deleteMany({ where: { id: { in: contests } } });
    await prisma.nflGame.deleteMany({ where: { seasonId } });
    await prisma.week.deleteMany({ where: { seasonId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.rankableEntry.deleteMany({ where: { externalId: { startsWith: `pse-${suffix}-` } } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
  });

  const callerNames = (rows: Awaited<ReturnType<typeof getThursdayReceipts>>["rows"], entryId: string) =>
    rows.find((row) => row.rankableEntryId === entryId)?.numberOneCallers.map((caller) => caller.username) ?? [];

  it("1–3 + 8: Thursday Receipts names only public-eligible, non-restricted boards", async () => {
    const receipts = await getThursdayReceipts(weekIds.w1);
    const top = receipts.rows.find((row) => row.rankableEntryId === entryIds.w1[0])!;
    const named = callerNames(receipts.rows, entryIds.w1[0]);

    // 3: legitimate finished-game receipts still show.
    expect(named).toEqual(
      expect.arrayContaining([usernames.humanPublic, usernames.ai, usernames.creatorOwner]),
    );
    // 1: hidden / inactive / private-tracked profiles are never named.
    for (const key of ["humanHidden", "expertInactive", "creatorPrivate"] as const) {
      expect(named).not.toContain(usernames[key]);
    }
    // 2: week before publicFromWeekId.
    expect(named).not.toContain(usernames.creatorGated);
    // 8: source-rights-restricted captured board is counted anonymously, never named.
    expect(named).not.toContain(usernames.creatorRestricted);
    // Sample = public boards only (humanPublic, ai, creatorOwner, creatorRestricted).
    expect(top.boardsIncluding).toBe(4);
    expect(top.percentRankedOne).toBe(1);

    // Gate reached: the gated Creator is named from its public week onward.
    const w2 = await getThursdayReceipts(weekIds.w2);
    expect(callerNames(w2.rows, entryIds.w2[0])).toEqual(
      expect.arrayContaining([usernames.creatorGated, usernames.humanPublic]),
    );

    // Test weeks never name or count boards.
    const wt = await getThursdayReceipts(weekIds.wt);
    for (const row of wt.rows) {
      expect(row.boardsIncluding).toBe(0);
      expect(row.numberOneCallers).toEqual([]);
    }
  });

  it("4–7: Live EYEQ excludes hidden profiles, gated weeks and test weeks; eligible rows unchanged", async () => {
    const live = await getLiveContestRankerBoard(contestIds.w1);
    const liveIds = live.map((row) => row.universalProfileId);
    // 4
    for (const key of ["humanHidden", "expertInactive", "creatorPrivate"] as const) {
      expect(liveIds).not.toContain(ids[key]);
    }
    // 5
    expect(liveIds).not.toContain(ids.creatorGated);
    expect((await getLiveContestRankerBoard(contestIds.w2)).map((row) => row.universalProfileId)).toContain(
      ids.creatorGated,
    );
    // 6
    expect(await getLiveContestRankerBoard(contestIds.wt)).toEqual([]);
    expect(await getLiveWeekRankerBoard(weekIds.wt)).toEqual([]);
    expect(
      (await getLiveContestRankerBoard(contestIds.wt, { includeTest: true })).map((row) => row.universalProfileId),
    ).toEqual([ids.humanPublic]);

    // 7: eligible public boards keep identical live scoring.
    expect(liveIds.sort()).toEqual(
      [ids.humanPublic, ids.ai, ids.creatorOwner, ids.creatorRestricted].sort(),
    );
    const expected = scoreProvisionalEyeq(
      [
        { playerId: entryIds.w1[0], playerName: "a", predictedRank: 1, provisionalActualRank: 1 },
        { playerId: entryIds.w1[1], playerName: "b", predictedRank: 2, provisionalActualRank: 2 },
      ],
      2,
    );
    const human = live.find((row) => row.universalProfileId === ids.humanPublic)!;
    expect(human.liveRankIqScore).toBe(expected.liveEyeqScore);
    expect(human.resolvedPicks).toBe(2);
    expect(human.topNHits).toBe(expected.topNHits);
  });

  it("8: restricted captured board does not leak picks through profile receipts or the public board", async () => {
    const view = await getRankIQProfileView(usernames.creatorRestricted);
    const item = view!.history.find((row) => row.contestId === contestIds.w1)!;
    expect(item.sourceRestricted).toBe(true);
    expect(item.receiptPicks).toEqual([]);
    expect(item.normalizedScore).toBe(100);

    const publicBoard = await getPublicProfileBoard({
      username: usernames.creatorRestricted,
      weekNumber: 1,
      position: "RB",
      viewer: { profileId: null, isAdmin: true },
      seasonYear,
      recordUnlock: false,
    });
    expect(publicBoard?.publicBoardRestricted).toBe(true);
    expect(publicBoard?.picks).toEqual([]);
  });

  it("9: OWNER_AUTHORED board is not hidden by a stale captured snapshot", async () => {
    const view = await getRankIQProfileView(usernames.creatorOwner);
    const item = view!.history.find((row) => row.contestId === contestIds.w1)!;
    expect(item.sourceRestricted).toBe(false);
    expect(item.receiptPicks.map((pick) => pick.playerName)).toEqual(["W1 Back 1", "W1 Back 2"]);

    const publicBoard = await getPublicProfileBoard({
      username: usernames.creatorOwner,
      weekNumber: 1,
      position: "RB",
      viewer: { profileId: null, isAdmin: true },
      seasonYear,
      recordUnlock: false,
    });
    expect(publicBoard?.publicBoardRestricted).toBe(false);
    expect(publicBoard?.captureAttribution).toBeNull();
  });

  it("12: public-surface reads never mutate boards, scores or snapshots", async () => {
    const state = async () => ({
      subs: await prisma.rankingSubmission.findMany({
        where: { contestId: { in: Object.values(contestIds) } },
        orderBy: { id: "asc" },
      }),
      picks: await prisma.rankingPick.findMany({
        where: { submission: { contestId: { in: Object.values(contestIds) } } },
        orderBy: { id: "asc" },
      }),
      snaps: await prisma.benchmarkSnapshot.count({ where: { weekId: weekIds.w1 } }),
    });
    const before = await state();
    await getThursdayReceipts(weekIds.w1);
    await getLiveWeekRankerBoard(weekIds.w1);
    await getRankIQProfileView(usernames.creatorRestricted);
    expect(await state()).toEqual(before);
  });
});
