import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  canViewCurrentWeekBoard,
  canViewCurrentWeekConsensus,
  getBoardRevealEntitlement,
} from "@/lib/timing/board-access";

const week = {
  fullLockAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
  revealStartsAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
  publicReleaseAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
  status: "OPEN",
};

const owner = { profileId: "owner", isAdmin: false };
const stranger = { profileId: "viewer", isAdmin: false };
const admin = { profileId: "admin-profile", isAdmin: true };
const duringReveal = zonedLocalToUtc(2026, 9, 13, 11, 0);

describe("board and consensus privacy", () => {
  it("hides consensus before Sunday lock", () => {
    expect(
      canViewCurrentWeekConsensus({
        week,
        now: zonedLocalToUtc(2026, 9, 13, 9, 59),
      }),
    ).toBe(false);
  });

  it("shows consensus after Sunday lock without auth or entitlement", () => {
    expect(
      canViewCurrentWeekConsensus({
        week,
        now: zonedLocalToUtc(2026, 9, 13, 10, 0),
      }),
    ).toBe(true);
  });

  it("hides another user's board before lock", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week,
        now: zonedLocalToUtc(2026, 9, 13, 9, 0),
      }),
    ).toBe(false);
  });

  it("lets the owner always see their own board", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: owner,
        targetProfileId: "owner",
        week,
        now: zonedLocalToUtc(2026, 9, 13, 9, 0),
      }),
    ).toBe(true);
  });

  it("lets admin view during pre-lock", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: admin,
        targetProfileId: "owner",
        week,
        now: zonedLocalToUtc(2026, 9, 13, 9, 0),
      }),
    ).toBe(true);
  });

  it("allows FREE_REVEAL boards after Sunday lock without entitlement", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week,
        revealPreference: "FREE_REVEAL",
        creatorEnabled: true,
        now: duringReveal,
      }),
    ).toBe(true);
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week,
        now: duringReveal,
      }),
    ).toBe(true);
  });

  it("blocks PREMIUM_REVEAL without entitlement during reveal", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week,
        creatorEnabled: true,
        revealPreference: "PREMIUM_REVEAL",
        hasMatchingEntitlement: false,
        entitlement: { canViewRevealBoards: false },
        now: duringReveal,
      }),
    ).toBe(false);
  });

  it("allows PREMIUM_REVEAL with matching entitlement", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week,
        creatorEnabled: true,
        revealPreference: "PREMIUM_REVEAL",
        hasMatchingEntitlement: true,
        now: duringReveal,
      }),
    ).toBe(true);
  });

  it("allows PREMIUM_REVEAL via dev entitlement stub", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week,
        creatorEnabled: true,
        revealPreference: "PREMIUM_REVEAL",
        entitlement: { canViewRevealBoards: true },
        now: duringReveal,
      }),
    ).toBe(true);
  });

  it("makes all boards public after noon regardless of creator setting", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week,
        creatorEnabled: true,
        revealPreference: "PREMIUM_REVEAL",
        hasMatchingEntitlement: false,
        now: zonedLocalToUtc(2026, 9, 13, 12, 0),
      }),
    ).toBe(true);
  });

  it("keeps historical boards public", () => {
    expect(
      canViewCurrentWeekBoard({
        viewer: stranger,
        targetProfileId: "owner",
        week: { ...week, status: "COMPLETE" },
        creatorEnabled: true,
        revealPreference: "PREMIUM_REVEAL",
        now: zonedLocalToUtc(2026, 9, 10, 12, 0),
      }),
    ).toBe(true);
  });

  it("reads entitlement stub from env without payment logic", () => {
    expect(
      getBoardRevealEntitlement(stranger, {
        RANKIQ_BOARD_REVEAL_ENTITLED: "1",
      }).canViewRevealBoards,
    ).toBe(true);
    expect(
      getBoardRevealEntitlement(stranger, {}).canViewRevealBoards,
    ).toBe(false);
  });
});
