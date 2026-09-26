import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueAvail,
  upsertAvail,
  updateAvail,
  updateRankable,
  findFirstSeason,
  findUniqueRankable,
} = vi.hoisted(() => ({
  findUniqueAvail: vi.fn(),
  upsertAvail: vi.fn(),
  updateAvail: vi.fn(),
  updateRankable: vi.fn(),
  findFirstSeason: vi.fn(),
  findUniqueRankable: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    playerWeekAvailability: {
      findUnique: findUniqueAvail,
      upsert: upsertAvail,
      update: updateAvail,
    },
    rankableEntry: {
      findUnique: findUniqueRankable,
      update: updateRankable,
    },
    seasonPlayer: {
      findFirst: findFirstSeason,
    },
  },
}));

import {
  updateInjuryContextPreservingOverride,
  upsertPlayerWeekAvailability,
} from "@/lib/eligibility/player-week-availability-store";

describe("PlayerWeekAvailability manual override precedence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueRankable.mockResolvedValue({
      gameStartsAt: null,
      game: null,
      contestEntries: [],
    });
    findFirstSeason.mockResolvedValue({ nflStatus: "ACTIVE" });
    upsertAvail.mockResolvedValue({});
    updateAvail.mockResolvedValue({});
    updateRankable.mockResolvedValue({});
  });

  it("manual override is not overwritten by NFL_SYNC", async () => {
    findUniqueAvail.mockResolvedValue({
      id: "pwa1",
      designation: "OUT",
      injuryDescription: "admin note",
      practiceStatus: null,
      sourceUrl: null,
      sourcePublishedAt: null,
      manualOverride: true,
      sourceType: "MANUAL",
    });

    const result = await upsertPlayerWeekAvailability({
      weekId: "week1",
      rankableEntryId: "player1",
      designation: "AVAILABLE",
      sourceType: "NFL_SYNC",
      respectManualOverride: true,
    });

    expect(result.status).toBe("skipped_override");
    expect(upsertAvail).not.toHaveBeenCalled();
    expect(updateRankable).not.toHaveBeenCalled();
  });

  it("NFL practice-context update preserves admin override designation/authority", async () => {
    findUniqueAvail.mockResolvedValue({
      id: "pwa1",
      designation: "OUT",
      injuryDescription: "admin note",
      practiceStatus: null,
      sourceUrl: "https://admin.local",
      sourcePublishedAt: null,
      manualOverride: true,
      sourceType: "MANUAL",
      updatedByUserId: "admin1",
    });

    const result = await updateInjuryContextPreservingOverride({
      weekId: "week1",
      rankableEntryId: "player1",
      practiceStatus: "Did Not Participate In Practice",
      injuryDescription: "knee",
      observedAt: new Date("2026-09-25T20:00:00.000Z"),
    });

    expect(result.status).toBe("updated_context_only");
    expect(updateAvail).toHaveBeenCalledWith({
      where: { id: "pwa1" },
      data: {
        injuryDescription: "knee",
        practiceStatus: "Did Not Participate In Practice",
        observedAt: new Date("2026-09-25T20:00:00.000Z"),
      },
    });
    expect(upsertAvail).not.toHaveBeenCalled();
    expect(updateRankable).not.toHaveBeenCalled();
  });

  it("clearing override permits later NFL_SYNC updates", async () => {
    findUniqueAvail.mockResolvedValue({
      id: "pwa1",
      designation: "OUT",
      injuryDescription: "admin note",
      practiceStatus: null,
      sourceUrl: null,
      sourcePublishedAt: null,
      manualOverride: true,
      sourceType: "MANUAL",
    });

    const cleared = await upsertPlayerWeekAvailability({
      weekId: "week1",
      rankableEntryId: "player1",
      designation: "OUT",
      sourceType: "MANUAL",
      clearManualOverride: true,
      respectManualOverride: false,
    });
    expect(cleared.status).toBe("updated");
    expect(upsertAvail).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ manualOverride: false }),
      }),
    );

    findUniqueAvail.mockResolvedValue({
      id: "pwa1",
      designation: "OUT",
      injuryDescription: "admin note",
      practiceStatus: null,
      sourceUrl: null,
      sourcePublishedAt: null,
      manualOverride: false,
      sourceType: "MANUAL",
    });

    const synced = await upsertPlayerWeekAvailability({
      weekId: "week1",
      rankableEntryId: "player1",
      designation: "AVAILABLE",
      sourceType: "NFL_SYNC",
      respectManualOverride: true,
    });
    expect(synced.status).toBe("updated");
    expect(updateRankable).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { availability: "ACTIVE" },
      }),
    );
  });

  it("status update mirrors RankableEntry so existing ContestEntry sees new availability", async () => {
    findUniqueAvail.mockResolvedValue(null);
    await upsertPlayerWeekAvailability({
      weekId: "week1",
      rankableEntryId: "player1",
      designation: "OUT",
      injuryDescription: "hip",
      sourceType: "MANUAL",
      setManualOverride: true,
      respectManualOverride: false,
    });
    expect(updateRankable).toHaveBeenCalledWith({
      where: { id: "player1" },
      data: { availability: "OUT" },
    });
  });
});
