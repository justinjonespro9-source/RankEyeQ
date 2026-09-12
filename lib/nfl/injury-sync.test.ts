import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { syncWeekInjuriesFromNflCom } from "@/lib/nfl/injury-sync";
import { WEEK1_NFL_INJURIES_FIXTURE_HTML } from "@/lib/providers/nfl/nflcom/injuries.fixture";
import { partitionAiPromptPlayers } from "@/lib/admin/ai-prompt";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `inj${Date.now()}`;

describe("syncWeekInjuriesFromNflCom", () => {
  let seasonId = "";
  let weekId = "";
  let bowersId = "";
  let mcmillanId = "";
  let odunzeId = "";
  let expertSubmissionId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2095,
        sport: `TEST-INJ-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: `[TEST] Injury sync ${suffix}`,
        startsAt: new Date("2095-09-07T00:00:00Z"),
        endsAt: new Date("2095-09-14T00:00:00Z"),
        status: "OPEN",
        rankingsOpenAt: new Date("2095-09-08T00:00:00Z"),
        fullLockAt: new Date("2095-09-13T15:00:00Z"),
        isTest: true,
      },
    });
    weekId = week.id;

    async function makePlayer(input: {
      name: string;
      team: string;
      position: "TE" | "WR";
      externalId: string;
    }) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "nflcom-bootstrap",
          externalId: input.externalId,
          type: "PLAYER",
          name: input.name,
          shortName: input.name,
          team: input.team,
          position: input.position,
          availability: "ACTIVE",
        },
      });
      const contest = await prisma.rankIQContest.upsert({
        where: {
          weekId_position: { weekId, position: input.position },
        },
        create: {
          seasonId,
          weekId,
          position: input.position,
          title: `${input.position} ${suffix}`,
          rankingDepth: input.position === "WR" ? 15 : 10,
          status: "OPEN",
        },
        update: {},
      });
      await prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          rankableEntryId: entry.id,
          excluded: false,
        },
      });
      return entry.id;
    }

    bowersId = await makePlayer({
      name: "Brock Bowers",
      team: "LV",
      position: "TE",
      externalId: `brock-bowers-${suffix}`,
    });
    mcmillanId = await makePlayer({
      name: "Jalen McMillan",
      team: "TB",
      position: "WR",
      externalId: `jalen-mcmillan-${suffix}`,
    });
    odunzeId = await makePlayer({
      name: "Rome Odunze",
      team: "CHI",
      position: "WR",
      externalId: `rome-odunze-${suffix}`,
    });

    const expert = await prisma.universalProfile.create({
      data: {
        username: `exp-${suffix}`,
        displayName: "Expert Fixture",
        profileType: "BENCHMARK",
      },
    });
    const teContest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId, position: "TE" } },
    });
    const submission = await prisma.rankingSubmission.create({
      data: {
        contestId: teContest.id,
        universalProfileId: expert.id,
        status: "SUBMITTED",
        submittedAt: new Date(),
        picks: {
          create: [{ rankableEntryId: bowersId, predictedRank: 1 }],
        },
      },
    });
    expertSubmissionId = submission.id;
  });

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.contestEntry.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.deleteMany({
      where: { id: { in: [bowersId, mcmillanId, odunzeId].filter(Boolean) } },
    });
    await prisma.universalProfile.deleteMany({
      where: { username: `exp-${suffix}` },
    });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
  });

  it("applies Bowers OUT / McMillan DOUBTFUL / Odunze QUESTIONABLE and is idempotent", async () => {
    const first = await syncWeekInjuriesFromNflCom({
      weekId,
      apply: true,
      nflHtml: WEEK1_NFL_INJURIES_FIXTURE_HTML,
      useCbsFallback: false,
    });
    expect(first.ok).toBe(true);
    expect(first.source).toBe("nfl.com");
    expect(first.out).toBeGreaterThanOrEqual(1);
    expect(first.doubtful).toBeGreaterThanOrEqual(1);
    expect(first.questionable).toBeGreaterThanOrEqual(1);
    expect(first.updated).toBeGreaterThanOrEqual(3);

    const bowers = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: bowersId },
    });
    const mcmillan = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: mcmillanId },
    });
    const odunze = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: odunzeId },
    });
    expect(bowers.availability).toBe("OUT");
    expect(mcmillan.availability).toBe("DOUBTFUL");
    expect(odunze.availability).toBe("QUESTIONABLE");

    const second = await syncWeekInjuriesFromNflCom({
      weekId,
      apply: true,
      nflHtml: WEEK1_NFL_INJURIES_FIXTURE_HTML,
      useCbsFallback: false,
    });
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBeGreaterThanOrEqual(3);

    // Expert board pick untouched
    const expertPick = await prisma.rankingPick.findFirstOrThrow({
      where: { submissionId: expertSubmissionId },
    });
    expect(expertPick.rankableEntryId).toBe(bowersId);
    expect(expertPick.predictedRank).toBe(1);
  });

  it("reports unmatched players and preserves statuses on parse failure", async () => {
    await prisma.rankableEntry.update({
      where: { id: bowersId },
      data: { availability: "OUT" },
    });

    const failed = await syncWeekInjuriesFromNflCom({
      weekId,
      apply: true,
      nflHtml: "<html><body>broken</body></html>",
      useCbsFallback: false,
    });
    expect(failed.ok).toBe(false);
    expect(failed.updated).toBe(0);
    expect(failed.errors.length).toBeGreaterThan(0);

    const bowers = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: bowersId },
    });
    expect(bowers.availability).toBe("OUT");

    const withUnmatched = await syncWeekInjuriesFromNflCom({
      weekId,
      apply: false,
      nflHtml: WEEK1_NFL_INJURIES_FIXTURE_HTML.replace(
        "Brock Bowers",
        "Totally Fake Player",
      ).replace("brock-bowers", "totally-fake-player"),
      useCbsFallback: false,
    });
    expect(withUnmatched.unmatched).toBeGreaterThanOrEqual(1);
  });

  it("human/AI share availability after sync", async () => {
    const now = zonedLocalToUtc(2026, 9, 12, 9, 0);
    const players = [
      {
        name: "Brock Bowers",
        team: "LV",
        opponent: "vs DEN",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 15, 25),
        availability: "OUT" as const,
      },
      {
        name: "Rome Odunze",
        team: "CHI",
        opponent: "@ CAR",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        availability: "QUESTIONABLE" as const,
      },
    ];
    const { eligible, unavailable } = partitionAiPromptPlayers(players, now);
    expect(unavailable.map((p) => p.name)).toContain("Brock Bowers");
    expect(eligible.map((p) => p.name)).toContain("Rome Odunze");
  });
});
