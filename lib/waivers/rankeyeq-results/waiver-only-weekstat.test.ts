import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueWeek,
  findUniquePlayer,
  findFirstSnapshot,
  findFirstSnapshotEntry,
  findFirstContestEntry,
  findFirstGame,
  findUniqueStat,
  createStat,
  updateStat,
  createAudit,
} = vi.hoisted(() => ({
  findUniqueWeek: vi.fn(),
  findUniquePlayer: vi.fn(),
  findFirstSnapshot: vi.fn(),
  findFirstSnapshotEntry: vi.fn(),
  findFirstContestEntry: vi.fn(),
  findFirstGame: vi.fn(),
  findUniqueStat: vi.fn(),
  createStat: vi.fn(),
  updateStat: vi.fn(),
  createAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    week: { findUnique: findUniqueWeek },
    rankableEntry: { findUnique: findUniquePlayer },
    waiverSnapshot: { findFirst: findFirstSnapshot },
    waiverSnapshotEntry: { findFirst: findFirstSnapshotEntry },
    contestEntry: { findFirst: findFirstContestEntry },
    nflGame: { findFirst: findFirstGame },
    playerWeekStat: {
      findUnique: findUniqueStat,
      create: createStat,
      update: updateStat,
    },
  },
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: (input: unknown) => createAudit(input),
}));

import { upsertWaiverOnlyPlayerWeekStat } from "@/lib/waivers/rankeyeq-results/waiver-only-weekstat";

const WEEK = "week-8";
const EKELER = "cmv7hvah3000006jsasy6xvkc";
const GAME_EXT = "manual-2026-w8-PHI-WAS";

function stubHappyPath() {
  findUniqueWeek.mockResolvedValue({
    id: WEEK,
    status: "OPEN",
    fantasyScoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
    season: { fantasyScoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2" },
  });
  findUniquePlayer.mockResolvedValue({
    id: EKELER,
    name: "Austin Ekeler",
    team: "WAS",
    position: "RB",
    provider: "manual",
    externalId: "manual-austin-ekeler-was-rb-mv7hvagx",
  });
  findFirstSnapshot.mockResolvedValue({
    id: "snap-1",
    entriesFingerprint: "fp",
  });
  findFirstSnapshotEntry.mockResolvedValue({
    id: "se-1",
    identityProviderAtFreeze: "manual",
    identityExternalIdAtFreeze: "manual-austin-ekeler-was-rb-mv7hvagx",
    teamAtFreeze: "WAS",
    displayNameAtFreeze: "Austin Ekeler",
  });
  findFirstContestEntry.mockResolvedValue(null);
  findFirstGame.mockResolvedValue({
    id: "game-1",
    status: "FINAL",
    statsFinalizedAt: new Date("2026-11-03T00:00:00Z"),
    awayTeam: "PHI",
    homeTeam: "WAS",
    startsAt: new Date("2026-11-02T01:20:00Z"),
    externalId: GAME_EXT,
  });
  findUniqueStat.mockResolvedValue(null);
  createStat.mockResolvedValue({ id: "stat-1" });
  createAudit.mockResolvedValue({ id: "audit-1" });
}

describe("upsertWaiverOnlyPlayerWeekStat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubHappyPath();
  });

  it("creates a verified manual WeekStat for a frozen eligible waiver-only player", async () => {
    const result = await upsertWaiverOnlyPlayerWeekStat({
      weekId: WEEK,
      rankableEntryId: EKELER,
      gameExternalId: GAME_EXT,
      stats: { rushingYards: 36 },
      reason: "Verified WAS W8 production; no Rankings ContestEntry",
      sourceReference:
        "nflverse stats_player_week_2026 W8 REG; Austin Ekeler 8/36",
      adminUserId: "admin-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("created");
    expect(result.fantasyPoints).toBe(3.6);
    expect(result.weekStatId).toBe("stat-1");
    expect(createStat).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "manual",
          weekId: WEEK,
          rankableEntryId: EKELER,
          gameId: "game-1",
          rushingYards: 36,
          fantasyPoints: 3.6,
          isProvisional: false,
          scoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
        }),
      }),
    );
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "waivers.rankeyeq_waiver_only_weekstat_upserted",
        metadata: expect.objectContaining({
          rankingsContestEntryTouched: false,
          frozenIdentityUnchanged: true,
          fantasyPoints: 3.6,
        }),
      }),
    );
  });

  it("is idempotent when the verified line already matches", async () => {
    findUniqueStat.mockResolvedValue({
      id: "stat-1",
      rankableEntryId: EKELER,
      fantasyPoints: 3.6,
      isProvisional: false,
      passingYards: 0,
      passingTds: 0,
      interceptions: 0,
      rushingYards: 36,
      rushingTds: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTds: 0,
      twoPointConversions: 0,
      fumblesLost: 0,
      returnTds: 0,
    });

    const result = await upsertWaiverOnlyPlayerWeekStat({
      weekId: WEEK,
      rankableEntryId: EKELER,
      gameExternalId: GAME_EXT,
      stats: { rushingYards: 36 },
      reason: "rerun",
      sourceReference: "nflverse",
      adminUserId: "admin-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("unchanged");
    expect(createStat).not.toHaveBeenCalled();
    expect(updateStat).not.toHaveBeenCalled();
  });

  it("refuses when an active Rankings ContestEntry exists", async () => {
    findFirstContestEntry.mockResolvedValue({ id: "ce-1" });
    const result = await upsertWaiverOnlyPlayerWeekStat({
      weekId: WEEK,
      rankableEntryId: EKELER,
      gameExternalId: GAME_EXT,
      stats: { rushingYards: 36 },
      reason: "x",
      sourceReference: "y",
      adminUserId: "admin-1",
    });
    expect(result).toMatchObject({
      ok: false,
      error: "active_rankings_contest_entry",
    });
    expect(createStat).not.toHaveBeenCalled();
  });

  it("refuses when no frozen eligible snapshot entry exists", async () => {
    findFirstSnapshotEntry.mockResolvedValue(null);
    const result = await upsertWaiverOnlyPlayerWeekStat({
      weekId: WEEK,
      rankableEntryId: EKELER,
      gameExternalId: GAME_EXT,
      stats: { rushingYards: 36 },
      reason: "x",
      sourceReference: "y",
      adminUserId: "admin-1",
    });
    expect(result).toMatchObject({
      ok: false,
      error: "no_frozen_eligible_snapshot_entry",
    });
  });

  it("refuses identity mismatch vs frozen stamp", async () => {
    findFirstSnapshotEntry.mockResolvedValue({
      id: "se-1",
      identityProviderAtFreeze: "nflcom-bootstrap",
      identityExternalIdAtFreeze: "austin-ekeler",
      teamAtFreeze: "WAS",
      displayNameAtFreeze: "Austin Ekeler",
    });
    const result = await upsertWaiverOnlyPlayerWeekStat({
      weekId: WEEK,
      rankableEntryId: EKELER,
      gameExternalId: GAME_EXT,
      stats: { rushingYards: 36 },
      reason: "x",
      sourceReference: "y",
      adminUserId: "admin-1",
    });
    expect(result).toMatchObject({ ok: false, error: "identity_mismatch" });
  });

  it("refuses non-FINAL games", async () => {
    findFirstGame.mockResolvedValue({
      id: "game-1",
      status: "IN_PROGRESS",
      statsFinalizedAt: null,
      awayTeam: "PHI",
      homeTeam: "WAS",
      startsAt: new Date(),
      externalId: GAME_EXT,
    });
    const result = await upsertWaiverOnlyPlayerWeekStat({
      weekId: WEEK,
      rankableEntryId: EKELER,
      gameExternalId: GAME_EXT,
      stats: { rushingYards: 36 },
      reason: "x",
      sourceReference: "y",
      adminUserId: "admin-1",
    });
    expect(result).toMatchObject({ ok: false, error: "game_not_final" });
  });

  it("refuses conflicting verified WeekStat without replaceExisting", async () => {
    findUniqueStat.mockResolvedValue({
      id: "stat-1",
      rankableEntryId: EKELER,
      fantasyPoints: 1.1,
      isProvisional: false,
      passingYards: 0,
      passingTds: 0,
      interceptions: 0,
      rushingYards: 11,
      rushingTds: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTds: 0,
      twoPointConversions: 0,
      fumblesLost: 0,
      returnTds: 0,
    });
    const result = await upsertWaiverOnlyPlayerWeekStat({
      weekId: WEEK,
      rankableEntryId: EKELER,
      gameExternalId: GAME_EXT,
      stats: { rushingYards: 36 },
      reason: "x",
      sourceReference: "y",
      adminUserId: "admin-1",
    });
    expect(result).toMatchObject({
      ok: false,
      error: "existing_verified_conflict",
    });
  });

  it("updates when replaceExisting is authorized", async () => {
    findUniqueStat.mockResolvedValue({
      id: "stat-1",
      rankableEntryId: EKELER,
      fantasyPoints: 1.1,
      isProvisional: false,
      passingYards: 0,
      passingTds: 0,
      interceptions: 0,
      rushingYards: 11,
      rushingTds: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTds: 0,
      twoPointConversions: 0,
      fumblesLost: 0,
      returnTds: 0,
    });
    updateStat.mockResolvedValue({ id: "stat-1" });
    const result = await upsertWaiverOnlyPlayerWeekStat({
      weekId: WEEK,
      rankableEntryId: EKELER,
      gameExternalId: GAME_EXT,
      stats: { rushingYards: 36 },
      reason: "owner replace",
      sourceReference: "nflverse",
      adminUserId: "admin-1",
      replaceExisting: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("updated");
    expect(updateStat).toHaveBeenCalled();
  });

  it("requires reason and source", async () => {
    expect(
      await upsertWaiverOnlyPlayerWeekStat({
        weekId: WEEK,
        rankableEntryId: EKELER,
        gameExternalId: GAME_EXT,
        stats: { rushingYards: 36 },
        reason: " ",
        sourceReference: "src",
        adminUserId: "admin-1",
      }),
    ).toMatchObject({ ok: false, error: "missing_reason" });
    expect(
      await upsertWaiverOnlyPlayerWeekStat({
        weekId: WEEK,
        rankableEntryId: EKELER,
        gameExternalId: GAME_EXT,
        stats: { rushingYards: 36 },
        reason: "ok",
        sourceReference: "",
        adminUserId: "admin-1",
      }),
    ).toMatchObject({ ok: false, error: "missing_source" });
  });
});
