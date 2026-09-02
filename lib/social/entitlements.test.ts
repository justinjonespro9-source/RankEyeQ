import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  entitlementMatches,
  grantBoardEntitlementAsActor,
  revokeBoardEntitlementAsActor,
} from "@/lib/social/entitlements";

const now = new Date("2026-09-13T16:00:00.000Z");

const base = {
  viewerProfileId: "viewer",
  entitlementType: "SINGLE_BOARD" as const,
  contestId: "contest-a",
  creatorProfileId: "creator-a",
  weekId: "week-1",
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  expiresAt: null,
  revokedAt: null,
};

const ctx = {
  viewerProfileId: "viewer",
  creatorProfileId: "creator-a",
  contestId: "contest-a",
  weekId: "week-1",
  now,
};

describe("entitlement matching", () => {
  it("matches SINGLE_BOARD for the same contest", () => {
    expect(entitlementMatches(base, ctx)).toBe(true);
  });

  it("does not let an unrelated SINGLE_BOARD unlock another contest", () => {
    expect(
      entitlementMatches(base, { ...ctx, contestId: "contest-b" }),
    ).toBe(false);
  });

  it("does not let CREATOR_WEEK for another creator unlock the board", () => {
    expect(
      entitlementMatches(
        { ...base, entitlementType: "CREATOR_WEEK", contestId: null },
        { ...ctx, creatorProfileId: "someone-else" },
      ),
    ).toBe(false);
    expect(
      entitlementMatches(
        { ...base, entitlementType: "CREATOR_WEEK", contestId: null },
        ctx,
      ),
    ).toBe(true);
  });

  it("matches WEEK_ALL_ACCESS only for that week", () => {
    const entitlement = {
      ...base,
      entitlementType: "WEEK_ALL_ACCESS" as const,
      contestId: null,
      creatorProfileId: null,
    };
    expect(entitlementMatches(entitlement, ctx)).toBe(true);
    expect(
      entitlementMatches(entitlement, { ...ctx, weekId: "week-2" }),
    ).toBe(false);
  });

  it("ignores revoked or expired entitlements", () => {
    expect(
      entitlementMatches({ ...base, revokedAt: now }, ctx),
    ).toBe(false);
    expect(
      entitlementMatches(
        { ...base, expiresAt: new Date("2026-09-13T15:00:00.000Z") },
        ctx,
      ),
    ).toBe(false);
  });
});

describe("entitlement admin authorization", () => {
  it("blocks non-admins from granting or revoking entitlements", async () => {
    await expect(
      grantBoardEntitlementAsActor({
        actorRole: "USER",
        viewerProfileId: "viewer",
        entitlementType: "WEEK_ALL_ACCESS",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      revokeBoardEntitlementAsActor({
        actorRole: "USER",
        entitlementId: "ent-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
