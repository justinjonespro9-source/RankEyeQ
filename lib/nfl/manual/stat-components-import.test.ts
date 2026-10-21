import "dotenv/config";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  LIVE_MANUAL_PROVIDER,
  saveLivePlayerStats,
} from "@/lib/admin/live-scoring";
import { prisma } from "@/lib/db";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import { parseStatComponentsCsv } from "@/lib/nfl/manual/parse-stat-components";
import {
  csvJoin,
  PLAYER_STAT_COLUMNS,
  DEFENSE_STAT_COLUMNS,
  STAT_COMPONENTS_COMMON_COLUMNS,
  STAT_COMPONENTS_FORMAT_VERSION,
} from "@/lib/nfl/manual/stat-components-format";
import {
  commitStatComponentsImport,
  exportStatComponentsTemplate,
  previewStatComponentsImport,
} from "@/lib/nfl/manual/stat-components-import";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `statimp${Date.now()}`;

function zeroPlayerCells(): string[] {
  return PLAYER_STAT_COLUMNS.map(() => "0");
}

function zeroDefCells(): string[] {
  return DEFENSE_STAT_COLUMNS.map(() => "0");
}

describe("parseStatComponentsCsv", () => {
  it("rejects blank component cells (never infers zero)", () => {
    const header = [
      ...STAT_COMPONENTS_COMMON_COLUMNS,
      ...PLAYER_STAT_COLUMNS,
      ...DEFENSE_STAT_COLUMNS,
    ];
    const row = [
      "PLAYER",
      STAT_COMPONENTS_FORMAT_VERSION,
      "2026",
      "6",
      "rid",
      "nflcom-bootstrap",
      "josh-allen",
      "manual-2026-w6-BUF-LV",
      "BUF",
      "QB",
      "Josh Allen",
      "NFL",
      "https://example.com",
      "2026-10-20T00:00:00.000Z",
      ...PLAYER_STAT_COLUMNS.map((col) => (col === "passingYards" ? "" : "0")),
      ...zeroDefCells(),
    ];
    const parsed = parseStatComponentsCsv(`${csvJoin(header)}\n${csvJoin(row)}\n`);
    expect(parsed.readyForMatch).toBe(false);
    expect(parsed.rows[0]?.issues).toContain("blank_stat_cell");
  });

  it("accepts explicit zero rows", () => {
    const header = [
      ...STAT_COMPONENTS_COMMON_COLUMNS,
      ...PLAYER_STAT_COLUMNS,
      ...DEFENSE_STAT_COLUMNS,
    ];
    const row = [
      "PLAYER",
      STAT_COMPONENTS_FORMAT_VERSION,
      "2026",
      "6",
      "rid",
      "nflcom-bootstrap",
      "bench-qb",
      "manual-2026-w6-BUF-LV",
      "BUF",
      "QB",
      "Bench QB",
      "NFL",
      "https://example.com",
      "2026-10-20T00:00:00.000Z",
      ...zeroPlayerCells(),
      ...zeroDefCells(),
    ];
    const parsed = parseStatComponentsCsv(`${csvJoin(header)}\n${csvJoin(row)}\n`);
    expect(parsed.readyForMatch).toBe(true);
    expect(parsed.rows[0]?.playerStats?.passingYards).toBe(0);
  });
});

describe("stat components import — integration", () => {
  let seasonId = "";
  let weekId = "";
  let week5Id = "";
  let adminUserId = "";
  let gameId = "";
  let gameExternalId = "";
  let qbContestId = "";
  let defContestId = "";
  let qbRankableId = "";
  let qbEntryId = "";
  let defRankableId = "";
  let defEntryId = "";
  let week5AvailabilityId = "";

  const sourceLabel = "Integration fixture box score";
  const sourceUrl = "https://example.test/box";
  const observedAt = "2026-10-20T18:00:00.000Z";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2099,
        sport: `STATIMP-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;

    const admin = await prisma.user.create({
      data: {
        email: `stat-imp-${suffix}@example.test`,
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 96,
        label: `Stat Imp Week ${suffix}`,
        startsAt: zonedLocalToUtc(2099, 10, 14, 0, 0),
        endsAt: zonedLocalToUtc(2099, 10, 21, 23, 0),
        status: "OPEN",
        isTest: true,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    weekId = week.id;

    const week5 = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 95,
        label: `Protected Week5-like ${suffix}`,
        startsAt: zonedLocalToUtc(2099, 10, 7, 0, 0),
        endsAt: zonedLocalToUtc(2099, 10, 13, 23, 0),
        status: "COMPLETE",
        isTest: true,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    week5Id = week5.id;

    const kickoff = zonedLocalToUtc(2099, 10, 18, 12, 0);
    gameExternalId = `manual-2099-w96-BUF-MIA-${suffix}`;
    const game = await prisma.nflGame.create({
      data: {
        provider: "manual",
        externalId: gameExternalId,
        seasonId,
        weekId,
        seasonYear: 2099,
        weekNumber: 96,
        awayTeam: "BUF",
        homeTeam: "MIA",
        startsAt: kickoff,
        status: "SCHEDULED",
      },
    });
    gameId = game.id;

    const qb = await prisma.rankableEntry.create({
      data: {
        provider: "nflcom-bootstrap",
        externalId: `stat-imp-qb-${suffix}`,
        type: "PLAYER",
        name: "Stat Imp QB",
        shortName: "S. Imp",
        team: "BUF",
        opponent: "MIA",
        position: "QB",
        gameId,
        gameStartsAt: kickoff,
      },
    });
    qbRankableId = qb.id;

    const def = await prisma.rankableEntry.create({
      data: {
        provider: "nflcom-bootstrap",
        externalId: `def-BUF-${suffix}`,
        type: "DEFENSE",
        name: "Buffalo",
        shortName: "BUF",
        team: "BUF",
        opponent: "MIA",
        position: "DEF",
        gameId,
        gameStartsAt: kickoff,
      },
    });
    defRankableId = def.id;

    const qbContest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: `QB ${suffix}`,
        rankingDepth: 10,
        reserveCount: 2,
        status: "LOCKED",
      },
    });
    qbContestId = qbContest.id;

    const defContest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "DEF",
        title: `DEF ${suffix}`,
        rankingDepth: 10,
        reserveCount: 2,
        status: "LOCKED",
      },
    });
    defContestId = defContest.id;

    const qbEntry = await prisma.contestEntry.create({
      data: {
        contestId: qbContestId,
        rankableEntryId: qbRankableId,
        gameId,
      },
    });
    qbEntryId = qbEntry.id;

    const defEntry = await prisma.contestEntry.create({
      data: {
        contestId: defContestId,
        rankableEntryId: defRankableId,
        gameId,
      },
    });
    defEntryId = defEntry.id;

    // Simulate a Week-6-style availability correction on another week — must stay untouched.
    const availability = await prisma.playerWeekAvailability.create({
      data: {
        weekId: week5Id,
        rankableEntryId: qbRankableId,
        designation: "OUT",
        manualOverride: true,
        sourceType: "MANUAL",
        sourceUrl: "https://example.test/correction",
      },
    });
    week5AvailabilityId = availability.id;

    // Week 5-like finalized player stat on the COMPLETE week.
    await prisma.playerWeekStat.create({
      data: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: week5Id,
        rankableEntryId: qbRankableId,
        externalPlayerId: qb.externalId,
        scoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        passingYards: 250,
        fantasyPoints: 10,
        isProvisional: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.playerWeekStat.deleteMany({
      where: { weekId: { in: [weekId, week5Id] } },
    });
    await prisma.defenseWeekStat.deleteMany({
      where: { weekId: { in: [weekId, week5Id] } },
    });
    await prisma.manualImportLog.deleteMany({
      where: { weekId: { in: [weekId, week5Id] } },
    });
    await prisma.playerWeekAvailability.deleteMany({
      where: { id: week5AvailabilityId },
    });
    await prisma.contestEntry.deleteMany({
      where: { contest: { weekId: { in: [weekId, week5Id] } } },
    });
    await prisma.rankIQContest.deleteMany({
      where: { weekId: { in: [weekId, week5Id] } },
    });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.week.deleteMany({ where: { id: { in: [weekId, week5Id] } } });
    await prisma.rankableEntry.deleteMany({
      where: { id: { in: [qbRankableId, defRankableId] } },
    });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
  });

  function buildFullCsv(overrides?: {
    qbStats?: string[];
    defStats?: string[];
    qbGame?: string;
    omitDef?: boolean;
  }) {
    const header = csvJoin([
      ...STAT_COMPONENTS_COMMON_COLUMNS,
      ...PLAYER_STAT_COLUMNS,
      ...DEFENSE_STAT_COLUMNS,
    ]);
    const qbStats = overrides?.qbStats ?? [
      "300", // passingYards — V2 bonus
      "2",
      "0",
      "100", // rushingYards — V2 bonus
      "1",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
    ];
    const defStats = overrides?.defStats ?? [
      "3",
      "1",
      "0",
      "0",
      "0",
      "0",
      "0",
      "14",
    ];
    const qbRow = csvJoin([
      "PLAYER",
      STAT_COMPONENTS_FORMAT_VERSION,
      "2099",
      "96",
      qbRankableId,
      "nflcom-bootstrap",
      `stat-imp-qb-${suffix}`,
      overrides?.qbGame ?? gameExternalId,
      "BUF",
      "QB",
      "Stat Imp QB",
      sourceLabel,
      sourceUrl,
      observedAt,
      ...qbStats,
      ...zeroDefCells(),
    ]);
    const defRow = csvJoin([
      "DEF",
      STAT_COMPONENTS_FORMAT_VERSION,
      "2099",
      "96",
      defRankableId,
      "nflcom-bootstrap",
      `def-BUF-${suffix}`,
      gameExternalId,
      "BUF",
      "DEF",
      "Buffalo",
      sourceLabel,
      sourceUrl,
      observedAt,
      ...zeroPlayerCells(),
      ...defStats,
    ]);
    return overrides?.omitDef
      ? `${header}\n${qbRow}\n`
      : `${header}\n${qbRow}\n${defRow}\n`;
  }

  it("exports a template covering the active pool", async () => {
    const template = await exportStatComponentsTemplate(weekId);
    expect(template.rowCount).toBe(2);
    expect(template.csv).toContain(qbRankableId);
    expect(template.csv).toContain(defRankableId);
    expect(template.csv).toContain(gameExternalId);
  });

  it("previews PLAYER/DEF FantasyTrack V2 parity including yardage bonuses", async () => {
    const csv = buildFullCsv();
    const preview = await previewStatComponentsImport({ weekId, csvText: csv });
    expect(preview.ready).toBe(true);
    expect(preview.scoringVersion).toBe(FANTASYTRACK_NFL_HALF_PPR_V2);

    const qb = preview.matched.find((row) => row.position === "QB");
    const def = preview.matched.find((row) => row.position === "DEF");
    expect(qb).toBeTruthy();
    expect(def).toBeTruthy();

    const expectedQb = calculatePlayerLiveFantasyPoints(
      {
        passingYards: 300,
        passingTds: 2,
        rushingYards: 100,
        rushingTds: 1,
      },
      FANTASYTRACK_NFL_HALF_PPR_V2,
    );
    // 12 + 8 + 5 + 10 + 6 + 5 = 46
    expect(expectedQb).toBe(46);
    expect(qb!.fantasyPoints).toBe(expectedQb);

    const expectedDef = calculateDefenseLiveFantasyPoints(
      { sacks: 3, interceptions: 1, pointsAllowed: 14 },
      FANTASYTRACK_NFL_HALF_PPR_V2,
    );
    expect(expectedDef).toBe(3 + 2 + 1);
    expect(def!.fantasyPoints).toBe(expectedDef);
  });

  it("blocks incomplete coverage instead of inferring zeros", async () => {
    const preview = await previewStatComponentsImport({
      weekId,
      csvText: buildFullCsv({ omitDef: true }),
    });
    expect(preview.ready).toBe(false);
    expect(preview.coverage.missingCount).toBe(1);
    expect(preview.blockers.join(" ")).toMatch(/Incomplete coverage/i);
  });

  it("rejects wrong-game assignments", async () => {
    const preview = await previewStatComponentsImport({
      weekId,
      csvText: buildFullCsv({ qbGame: "manual-wrong-game" }),
    });
    expect(preview.ready).toBe(false);
    expect(preview.blockers.join(" ")).toMatch(/wrong game/i);
  });

  it("commits provisionally, is idempotent, and skips grading side effects", async () => {
    const csv = buildFullCsv();
    const preview = await previewStatComponentsImport({ weekId, csvText: csv });
    expect(preview.ready).toBe(true);

    const first = await commitStatComponentsImport({
      weekId,
      csvText: csv,
      adminUserId,
      previewToken: preview.previewToken,
      approved: true,
      sourceLabel,
      sourceUrl,
      observedAt,
    });
    expect(first.created).toBe(2);
    expect(first.unchanged).toBe(0);

    const qbStat = await prisma.playerWeekStat.findFirstOrThrow({
      where: { weekId, rankableEntryId: qbRankableId },
    });
    expect(qbStat.isProvisional).toBe(true);
    expect(qbStat.passingYards).toBe(300);
    expect(qbStat.rushingYards).toBe(100);
    expect(qbStat.fantasyPoints).toBe(46);
    expect(qbStat.leagueActualRank).toBeNull();

    const defStat = await prisma.defenseWeekStat.findFirstOrThrow({
      where: { weekId, rankableEntryId: defRankableId },
    });
    expect(defStat.isProvisional).toBe(true);
    expect(defStat.fantasyPoints).toBe(6);

    const qbEntry = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: qbEntryId },
    });
    expect(qbEntry.fantasyPoints).toBe(46);
    expect(qbEntry.actualRank).toBeNull();

    const contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { id: qbContestId },
    });
    expect(contest.status).toBe("LOCKED");

    const game = await prisma.nflGame.findUniqueOrThrow({ where: { id: gameId } });
    expect(game.status).toBe("IN_PROGRESS");
    expect(game.statsFinalizedAt).toBeNull();

    // Repeat identical import — idempotent.
    const preview2 = await previewStatComponentsImport({ weekId, csvText: csv });
    const second = await commitStatComponentsImport({
      weekId,
      csvText: csv,
      adminUserId,
      previewToken: preview2.previewToken,
      approved: true,
      sourceLabel,
      sourceUrl,
      observedAt,
    });
    expect(second.unchanged).toBe(2);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);

    const logs = await prisma.manualImportLog.count({
      where: { weekId, importType: "STAT_COMPONENTS" },
    });
    expect(logs).toBeGreaterThanOrEqual(2);
  });

  it("rejects stale preview tokens after pool/stat changes", async () => {
    const csv = buildFullCsv();
    const preview = await previewStatComponentsImport({ weekId, csvText: csv });
    // Mutate provisional stats via Live Scoring (manual path still works).
    await saveLivePlayerStats({
      contestEntryId: qbEntryId,
      adminUserId,
      stats: { passingYards: 10 },
    });
    await expect(
      commitStatComponentsImport({
        weekId,
        csvText: csv,
        adminUserId,
        previewToken: preview.previewToken,
        approved: true,
        sourceLabel,
        sourceUrl,
        observedAt,
        replaceProvisional: true,
      }),
    ).rejects.toThrow(/Stale preview/i);

    // Restore full coverage for later tests via replace.
    const previewFresh = await previewStatComponentsImport({
      weekId,
      csvText: csv,
      replaceProvisional: true,
    });
    expect(previewFresh.ready).toBe(true);
    await commitStatComponentsImport({
      weekId,
      csvText: csv,
      adminUserId,
      previewToken: previewFresh.previewToken,
      approved: true,
      sourceLabel,
      sourceUrl,
      observedAt,
      replaceProvisional: true,
    });
  });

  it("protects finalized game stats", async () => {
    await prisma.playerWeekStat.updateMany({
      where: { weekId, rankableEntryId: qbRankableId },
      data: { isProvisional: false },
    });
    await prisma.defenseWeekStat.updateMany({
      where: { weekId, rankableEntryId: defRankableId },
      data: { isProvisional: false },
    });
    await prisma.nflGame.update({
      where: { id: gameId },
      data: { status: "FINAL", statsFinalizedAt: new Date() },
    });

    const preview = await previewStatComponentsImport({
      weekId,
      csvText: buildFullCsv(),
      replaceProvisional: true,
    });
    expect(preview.ready).toBe(false);
    expect(preview.finalizedBlocked.length).toBeGreaterThan(0);

    // Reopen for cleanup / remaining assertions.
    await prisma.nflGame.update({
      where: { id: gameId },
      data: { status: "IN_PROGRESS", statsFinalizedAt: null },
    });
    await prisma.playerWeekStat.updateMany({
      where: { weekId, rankableEntryId: qbRankableId },
      data: { isProvisional: true },
    });
    await prisma.defenseWeekStat.updateMany({
      where: { weekId, rankableEntryId: defRankableId },
      data: { isProvisional: true },
    });
  });

  it("rolls back the whole import on mid-transaction failure", async () => {
    const csv = buildFullCsv({
      qbStats: [
        "275",
        "1",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ],
    });
    const preview = await previewStatComponentsImport({
      weekId,
      csvText: csv,
      replaceProvisional: true,
    });
    expect(preview.ready).toBe(true);

    await expect(
      commitStatComponentsImport({
        weekId,
        csvText: csv,
        adminUserId,
        previewToken: preview.previewToken,
        approved: true,
        sourceLabel,
        sourceUrl,
        observedAt,
        replaceProvisional: true,
        __testFailAfterWrites: 1,
      }),
    ).rejects.toThrow(/TEST_FORCED_ROLLBACK/);

    // QB must not keep the 275-yard line from the aborted commit.
    const qbStat = await prisma.playerWeekStat.findFirstOrThrow({
      where: { weekId, rankableEntryId: qbRankableId },
    });
    expect(qbStat.passingYards).toBe(300);
  });

  it("preserves Week 5-like finalized stats and availability corrections", async () => {
    const week5Stat = await prisma.playerWeekStat.findFirstOrThrow({
      where: { weekId: week5Id, rankableEntryId: qbRankableId },
    });
    expect(week5Stat.passingYards).toBe(250);
    expect(week5Stat.isProvisional).toBe(false);

    const availability = await prisma.playerWeekAvailability.findUniqueOrThrow({
      where: { id: week5AvailabilityId },
    });
    expect(availability.designation).toBe("OUT");
    expect(availability.manualOverride).toBe(true);

    // Import must refuse COMPLETE weeks.
    const refuse = await previewStatComponentsImport({
      weekId: week5Id,
      csvText: buildFullCsv(),
    });
    expect(refuse.ready).toBe(false);
    expect(refuse.blockers.join(" ")).toMatch(/COMPLETE|FINAL/i);
  });

  it("rejects unapproved commits and content tampering", async () => {
    const csv = buildFullCsv();
    const preview = await previewStatComponentsImport({
      weekId,
      csvText: csv,
      replaceProvisional: true,
    });
    await expect(
      commitStatComponentsImport({
        weekId,
        csvText: csv,
        adminUserId,
        previewToken: preview.previewToken,
        approved: false,
        sourceLabel,
        sourceUrl,
        observedAt,
        replaceProvisional: true,
      }),
    ).rejects.toThrow(/approval/i);

    const tampered = `${csv}#tamper`;
    await expect(
      commitStatComponentsImport({
        weekId,
        csvText: tampered,
        adminUserId,
        previewToken: preview.previewToken,
        approved: true,
        sourceLabel,
        sourceUrl,
        observedAt,
        replaceProvisional: true,
      }),
    ).rejects.toThrow(/Stale preview|changed/i);

    // Fingerprint stability check helper (content hash).
    expect(createHash("sha256").update(csv, "utf8").digest("hex")).toBe(
      preview.contentSha256,
    );
  });
});
