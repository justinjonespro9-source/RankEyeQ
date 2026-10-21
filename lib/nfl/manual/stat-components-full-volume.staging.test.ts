/**
 * Full-volume synthetic staging gate for batch component importer V1.
 *
 * SYNTHETIC TEST DATA ONLY — never Production, never claimed as official
 * Week 6 NFL results. Validates ~456-row Week-6-shaped pool performance.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  finalizeLiveGame,
  LIVE_MANUAL_PROVIDER,
} from "@/lib/admin/live-scoring";
import { prisma } from "@/lib/db";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import { calculateLeagueActualFinishesForWeek } from "@/lib/nfl/actual-finishes";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { NFL_TEAMS } from "@/lib/nfl-schedule";
import {
  csvJoin,
  DEFENSE_CSV_COLUMNS,
  PLAYER_CSV_COLUMNS,
  STAT_COMPONENTS_COMMON_COLUMNS,
  STAT_COMPONENTS_FORMAT_VERSION,
} from "@/lib/nfl/manual/stat-components-format";
import {
  commitStatComponentsImport,
  exportStatComponentsTemplate,
  previewStatComponentsImport,
} from "@/lib/nfl/manual/stat-components-import";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `vol${Date.now()}`;

/** Week 6 Production-shaped pool sizes. */
const POOL = {
  QB: 76,
  RB: 97,
  WR: 151,
  TE: 104,
  DEF: 28,
} as const;

const GAME_COUNT = 14;
const EXPECTED_ROWS =
  POOL.QB + POOL.RB + POOL.WR + POOL.TE + POOL.DEF;

const SOURCE_LABEL =
  "SYNTHETIC TEST DATA — RankEyeQ full-volume staging (not official Week 6 results)";
const SOURCE_URL = "https://example.test/synthetic/rankeyeq-stat-components-volume";
const OBSERVED_AT = "2026-10-20T20:00:00.000Z";

describe("stat components full-volume staging (synthetic)", () => {
  let seasonId = "";
  let weekId = "";
  let week5Id = "";
  let adminUserId = "";
  let gameIds: string[] = [];
  let protectedAvailabilityId = "";
  let protectedWeek5StatId = "";
  let csvText = "";
  let timings: {
    previewMs: number;
    commitMs: number;
    reimportMs: number;
  } = { previewMs: 0, commitMs: 0, reimportMs: 0 };

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2097,
        sport: `VOL-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;

    const admin = await prisma.user.create({
      data: {
        email: `vol-admin-${suffix}@example.test`,
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 6,
        label: `Synthetic W6 volume ${suffix}`,
        startsAt: zonedLocalToUtc(2097, 10, 14, 0, 0),
        endsAt: zonedLocalToUtc(2097, 10, 21, 23, 0),
        status: "OPEN",
        isTest: true,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    weekId = week.id;

    const week5 = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 5,
        label: `Protected W5 ${suffix}`,
        startsAt: zonedLocalToUtc(2097, 10, 7, 0, 0),
        endsAt: zonedLocalToUtc(2097, 10, 13, 23, 0),
        status: "COMPLETE",
        isTest: true,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    week5Id = week5.id;

    const teams = NFL_TEAMS.map((t) => t.abbr);
    const games: Array<{
      id: string;
      externalId: string;
      away: string;
      home: string;
    }> = [];

    for (let i = 0; i < GAME_COUNT; i += 1) {
      const away = teams[i * 2]!;
      const home = teams[i * 2 + 1]!;
      const externalId = `manual-2097-w6-${away}-${home}-${suffix}`;
      const game = await prisma.nflGame.create({
        data: {
          provider: "manual",
          externalId,
          seasonId,
          weekId,
          seasonYear: 2097,
          weekNumber: 6,
          awayTeam: away,
          homeTeam: home,
          startsAt: zonedLocalToUtc(2097, 10, 18, 12 + (i % 4), 0),
          status: "SCHEDULED",
        },
      });
      games.push({ id: game.id, externalId, away, home });
    }
    gameIds = games.map((g) => g.id);

    const positions = ["QB", "RB", "WR", "TE", "DEF"] as const;
    const contests: Record<(typeof positions)[number], string> = {
      QB: "",
      RB: "",
      WR: "",
      TE: "",
      DEF: "",
    };
    for (const position of positions) {
      const contest = await prisma.rankIQContest.create({
        data: {
          seasonId,
          weekId,
          position,
          title: `${position} volume ${suffix}`,
          rankingDepth: position === "WR" ? 15 : 10,
          reserveCount: 2,
          status: "LOCKED",
        },
      });
      contests[position] = contest.id;
    }

    // Create pool entries distributed across games/teams.
    let playerIndex = 0;
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const count = POOL[position];
      for (let i = 0; i < count; i += 1) {
        const game = games[i % GAME_COUNT]!;
        const team = i % 2 === 0 ? game.away : game.home;
        const externalId = `synth-${position.toLowerCase()}-${i}-${suffix}`;
        const rankable = await prisma.rankableEntry.create({
          data: {
            provider: "nflcom-bootstrap",
            externalId,
            type: "PLAYER",
            name: `SYNTHETIC ${position} ${i}`,
            shortName: `${position}${i}`,
            team,
            opponent: team === game.away ? game.home : game.away,
            position,
            gameId: game.id,
            gameStartsAt: zonedLocalToUtc(2097, 10, 18, 12, 0),
          },
        });
        await prisma.contestEntry.create({
          data: {
            contestId: contests[position],
            rankableEntryId: rankable.id,
            gameId: game.id,
          },
        });
        playerIndex += 1;
      }
    }

    // DEF: first 28 unique teams from the 14 games (away+home).
    const defTeams: string[] = [];
    for (const game of games) {
      defTeams.push(game.away, game.home);
    }
    for (let i = 0; i < POOL.DEF; i += 1) {
      const team = defTeams[i]!;
      const game = games.find((g) => g.away === team || g.home === team)!;
      const rankable = await prisma.rankableEntry.create({
        data: {
          provider: "nflcom-bootstrap",
          externalId: `def-${team}-${suffix}`,
          type: "DEFENSE",
          name: `SYNTHETIC DEF ${team}`,
          shortName: team,
          team,
          opponent: team === game.away ? game.home : game.away,
          position: "DEF",
          gameId: game.id,
          gameStartsAt: zonedLocalToUtc(2097, 10, 18, 12, 0),
        },
      });
      await prisma.contestEntry.create({
        data: {
          contestId: contests.DEF,
          rankableEntryId: rankable.id,
          gameId: game.id,
        },
      });
    }

    // Week 5 protection fixtures.
    const anyPlayer = await prisma.rankableEntry.findFirstOrThrow({
      where: { externalId: { startsWith: `synth-qb-0-${suffix}` } },
    });
    const availability = await prisma.playerWeekAvailability.create({
      data: {
        weekId: week5Id,
        rankableEntryId: anyPlayer.id,
        designation: "OUT",
        manualOverride: true,
        sourceType: "MANUAL",
        sourceUrl: "https://example.test/w5-correction",
      },
    });
    protectedAvailabilityId = availability.id;

    const w5Stat = await prisma.playerWeekStat.create({
      data: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: week5Id,
        rankableEntryId: anyPlayer.id,
        externalPlayerId: anyPlayer.externalId,
        scoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        passingYards: 111,
        fantasyPoints: 4.44,
        isProvisional: false,
      },
    });
    protectedWeek5StatId = w5Stat.id;

    expect(playerIndex + POOL.DEF).toBe(EXPECTED_ROWS);
  }, 180_000);

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { entityId: weekId, action: "live_scoring.stat_components_imported" },
    });
    await prisma.manualImportLog.deleteMany({
      where: { weekId: { in: [weekId, week5Id] } },
    });
    await prisma.playerWeekStat.deleteMany({
      where: { weekId: { in: [weekId, week5Id] } },
    });
    await prisma.defenseWeekStat.deleteMany({
      where: { weekId: { in: [weekId, week5Id] } },
    });
    await prisma.playerWeekAvailability.deleteMany({
      where: { id: protectedAvailabilityId },
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
      where: {
        OR: [
          { externalId: { contains: suffix } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
  }, 120_000);

  function fillTemplate(templateCsv: string): string {
    const lines = templateCsv.trimEnd().split("\n");
    const header = lines[0]!;
    const out = [header];
    for (let i = 1; i < lines.length; i += 1) {
      const cols = lines[i]!.split(",");
      // Template cells are unquoted simple fields — fill source + zeros/components.
      const recordType = cols[0]!;
      const common = [
        recordType,
        STAT_COMPONENTS_FORMAT_VERSION,
        cols[2]!,
        cols[3]!,
        cols[4]!,
        cols[5]!,
        cols[6]!,
        cols[7]!,
        cols[8]!,
        cols[9]!,
        cols[10]!,
        SOURCE_LABEL,
        SOURCE_URL,
        OBSERVED_AT,
      ];
      if (recordType === "PLAYER") {
        // Deterministic synthetic components (representative, not official).
        const n = i % 17;
        const playerStats = [
          String(200 + n * 3), // passingYards
          String(n % 4),
          String(n % 3), // passingInterceptions
          String(10 + (n % 40)),
          String(n % 2),
          String(n % 8),
          String(20 + n * 2),
          String(n % 2),
          "0",
          String(n % 2),
          "0",
        ];
        const defZeros = DEFENSE_CSV_COLUMNS.map(() => "0");
        out.push(csvJoin([...common, ...playerStats, ...defZeros]));
      } else {
        const playerZeros = PLAYER_CSV_COLUMNS.map(() => "0");
        const n = i % 11;
        const defStats = [
          String((n % 5) + 1),
          String(n % 3),
          String(n % 2),
          String(n % 2),
          "0",
          String(n % 2),
          "0",
          String(10 + (n % 21)),
        ];
        out.push(csvJoin([...common, ...playerZeros, ...defStats]));
      }
    }
    return `${out.join("\n")}\n`;
  }

  it(
    "exports template, preview/commit ~456 synthetic rows under 120s, verifies coverage + audit",
    async () => {
      const template = await exportStatComponentsTemplate(weekId);
      expect(template.rowCount).toBe(EXPECTED_ROWS);
      expect(template.csv.split("\n")[0]).toContain("passingInterceptions");
      expect(template.csv.split("\n")[0]).toContain("defenseInterceptions");
      expect(template.csv.split("\n")[0]).not.toMatch(/(^|,)interceptions(,|$)/);

      csvText = fillTemplate(template.csv);
      // Every data row must carry the synthetic label.
      const dataLines = csvText.trim().split("\n").slice(1);
      expect(dataLines).toHaveLength(EXPECTED_ROWS);
      for (const line of dataLines) {
        expect(line).toContain("SYNTHETIC TEST DATA");
      }

      const previewStarted = Date.now();
      const preview = await previewStatComponentsImport({
        weekId,
        csvText,
      });
      timings.previewMs = Date.now() - previewStarted;

      expect(preview.ready).toBe(true);
      expect(preview.coverage.poolSize).toBe(EXPECTED_ROWS);
      expect(preview.coverage.matchedCount).toBe(EXPECTED_ROWS);
      expect(preview.coverage.missingCount).toBe(0);
      expect(preview.scoringVersion).toBe(FANTASYTRACK_NFL_HALF_PPR_V2);
      expect(timings.previewMs).toBeLessThan(120_000);

      const commitStarted = Date.now();
      const commit = await commitStatComponentsImport({
        weekId,
        csvText,
        adminUserId,
        previewToken: preview.previewToken,
        approved: true,
        sourceLabel: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        observedAt: OBSERVED_AT,
      });
      timings.commitMs = Date.now() - commitStarted;

      expect(timings.commitMs).toBeLessThan(120_000);
      expect(commit.created + commit.updated + commit.unchanged).toBe(
        EXPECTED_ROWS,
      );
      expect(commit.created).toBe(EXPECTED_ROWS);
      expect(commit.auditLogId).toBeTruthy();
      expect(commit.importLogId).toBeTruthy();

      const playerStats = await prisma.playerWeekStat.count({
        where: { weekId, provider: LIVE_MANUAL_PROVIDER, isProvisional: true },
      });
      const defStats = await prisma.defenseWeekStat.count({
        where: { weekId, provider: LIVE_MANUAL_PROVIDER, isProvisional: true },
      });
      expect(playerStats).toBe(POOL.QB + POOL.RB + POOL.WR + POOL.TE);
      expect(defStats).toBe(POOL.DEF);

      const withFp = await prisma.contestEntry.count({
        where: {
          contest: { weekId },
          excluded: false,
          fantasyPoints: { not: null },
        },
      });
      expect(withFp).toBe(EXPECTED_ROWS);

      const nullFp = await prisma.contestEntry.count({
        where: {
          contest: { weekId },
          excluded: false,
          fantasyPoints: null,
        },
      });
      expect(nullFp).toBe(0);

      const audit = await prisma.adminAuditLog.findUniqueOrThrow({
        where: { id: commit.auditLogId },
      });
      expect(audit.action).toBe("live_scoring.stat_components_imported");
      expect(audit.entityId).toBe(weekId);

      // Identical reimport — idempotent.
      const preview2 = await previewStatComponentsImport({ weekId, csvText });
      const reimportStarted = Date.now();
      const commit2 = await commitStatComponentsImport({
        weekId,
        csvText,
        adminUserId,
        previewToken: preview2.previewToken,
        approved: true,
        sourceLabel: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        observedAt: OBSERVED_AT,
      });
      timings.reimportMs = Date.now() - reimportStarted;
      expect(commit2.unchanged).toBe(EXPECTED_ROWS);
      expect(commit2.created).toBe(0);
      expect(commit2.updated).toBe(0);
      expect(timings.reimportMs).toBeLessThan(120_000);

      // Stale preview after mutating one provisional line.
      const oneEntry = await prisma.contestEntry.findFirstOrThrow({
        where: { contest: { weekId, position: "QB" }, excluded: false },
      });
      const stalePreview = await previewStatComponentsImport({
        weekId,
        csvText,
      });
      await prisma.playerWeekStat.updateMany({
        where: {
          weekId,
          rankableEntryId: oneEntry.rankableEntryId,
        },
        data: { passingYards: 1, fantasyPoints: 0.04 },
      });
      await expect(
        commitStatComponentsImport({
          weekId,
          csvText,
          adminUserId,
          previewToken: stalePreview.previewToken,
          approved: true,
          sourceLabel: SOURCE_LABEL,
          sourceUrl: SOURCE_URL,
          observedAt: OBSERVED_AT,
          replaceProvisional: true,
        }),
      ).rejects.toThrow(/Stale preview/i);

      // Restore for rollback + finalize steps.
      const restorePreview = await previewStatComponentsImport({
        weekId,
        csvText,
        replaceProvisional: true,
      });
      await commitStatComponentsImport({
        weekId,
        csvText,
        adminUserId,
        previewToken: restorePreview.previewToken,
        approved: true,
        sourceLabel: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        observedAt: OBSERVED_AT,
        replaceProvisional: true,
      });

      // Mid-transaction rollback leaves prior good state.
      const beforeRollback = await prisma.playerWeekStat.findFirstOrThrow({
        where: { weekId, rankableEntryId: oneEntry.rankableEntryId },
      });
      const rollbackPreview = await previewStatComponentsImport({
        weekId,
        csvText,
        replaceProvisional: true,
      });
      // Slightly alter one cell so writes are non-no-op, then force fail after 1 write.
      const altered = csvText.replace(
        /("SYNTHETIC QB 0"[^\n]+)/,
        (row) => row.replace(",200,", ",201,"),
      );
      // If replace didn't hit (quoting), fall back to __testFailAfterWrites on identical
      // path by temporarily clearing one weekstat so create/update happens.
      void altered;
      await prisma.playerWeekStat.deleteMany({
        where: { weekId, rankableEntryId: oneEntry.rankableEntryId },
      });
      const failPreview = await previewStatComponentsImport({
        weekId,
        csvText,
        replaceProvisional: true,
      });
      await expect(
        commitStatComponentsImport({
          weekId,
          csvText,
          adminUserId,
          previewToken: failPreview.previewToken,
          approved: true,
          sourceLabel: SOURCE_LABEL,
          sourceUrl: SOURCE_URL,
          observedAt: OBSERVED_AT,
          replaceProvisional: true,
          __testFailAfterWrites: 1,
        }),
      ).rejects.toThrow(/TEST_FORCED_ROLLBACK/);

      // Deleted row must not remain half-applied; restore via successful import.
      const missing = await prisma.playerWeekStat.count({
        where: { weekId, rankableEntryId: oneEntry.rankableEntryId },
      });
      expect(missing).toBe(0);

      const healPreview = await previewStatComponentsImport({
        weekId,
        csvText,
        replaceProvisional: true,
      });
      await commitStatComponentsImport({
        weekId,
        csvText,
        adminUserId,
        previewToken: healPreview.previewToken,
        approved: true,
        sourceLabel: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        observedAt: OBSERVED_AT,
        replaceProvisional: true,
      });
      const healed = await prisma.playerWeekStat.findFirstOrThrow({
        where: { weekId, rankableEntryId: oneEntry.rankableEntryId },
      });
      expect(healed.passingYards).toBe(beforeRollback.passingYards);

      // Week 5 isolation.
      const w5 = await prisma.playerWeekStat.findUniqueOrThrow({
        where: { id: protectedWeek5StatId },
      });
      expect(w5.passingYards).toBe(111);
      expect(w5.isProvisional).toBe(false);
      const avail = await prisma.playerWeekAvailability.findUniqueOrThrow({
        where: { id: protectedAvailabilityId },
      });
      expect(avail.designation).toBe("OUT");
      expect(avail.manualOverride).toBe(true);

      // Per-game finalize + actual finishes (disposable DB only).
      for (const gameId of gameIds) {
        await finalizeLiveGame({ weekId, gameId, adminUserId });
      }
      const finals = await prisma.nflGame.count({
        where: { weekId, status: "FINAL", statsFinalizedAt: { not: null } },
      });
      expect(finals).toBe(GAME_COUNT);

      await calculateLeagueActualFinishesForWeek(weekId);
      const ranked = await prisma.contestEntry.count({
        where: {
          contest: { weekId },
          excluded: false,
          actualRank: { not: null },
        },
      });
      expect(ranked).toBe(EXPECTED_ROWS);

      const readiness = await getFinalizeWeekReadiness(weekId);
      const graded = await prisma.rankingSubmission.count({
        where: { contest: { weekId }, status: "GRADED" },
      });
      expect(graded).toBe(0);
      expect(
        readiness.positions.every((p) => p.contestStatus === "LOCKED"),
      ).toBe(true);

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          syntheticRows: EXPECTED_ROWS,
          timings,
          commit,
          coverage: preview.coverage,
        }),
      );
    },
    300_000,
  );
});
