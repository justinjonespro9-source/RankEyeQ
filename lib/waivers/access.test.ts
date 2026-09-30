import { describe, expect, it } from "vitest";
import type { WaiverSubmissionStatus } from "@/lib/generated/prisma/client";
import { canViewWaiverBoardContents, type WaiverBoardViewer } from "@/lib/waivers/access";

const locksAt = new Date("2026-10-28T00:00:00.000Z");
const before = new Date(locksAt.getTime() - 1);
const after = locksAt;

const owner: WaiverBoardViewer = { profileId: "owner", isAdmin: false };
const competitor: WaiverBoardViewer = { profileId: "rival", isAdmin: false };
const stranger: WaiverBoardViewer = { profileId: null, isAdmin: false };
const admin: WaiverBoardViewer = { profileId: "admin-profile", isAdmin: true };

const view = (viewer: WaiverBoardViewer, submissionStatus: WaiverSubmissionStatus, now: Date) =>
  canViewWaiverBoardContents({ viewer, ownerProfileId: "owner", submissionStatus, locksAt, now });

describe("canViewWaiverBoardContents", () => {
  it("the owner always sees their own board (draft, submitted, locked)", () => {
    for (const status of ["DRAFT", "SUBMITTED", "LOCKED"] as const) {
      expect(view(owner, status, before)).toBe(true);
      expect(view(owner, status, after)).toBe(true);
    }
  });

  it("before lock nobody else sees calls — competitors, the public, or admins", () => {
    for (const viewer of [competitor, stranger, admin]) {
      for (const status of ["DRAFT", "SUBMITTED", "LOCKED"] as const) {
        expect(view(viewer, status, before)).toBe(false);
      }
    }
  });

  it("after lock competitive boards are revealable; drafts stay private", () => {
    for (const viewer of [competitor, stranger, admin]) {
      expect(view(viewer, "SUBMITTED", after)).toBe(true);
      expect(view(viewer, "LOCKED", after)).toBe(true);
      expect(view(viewer, "DRAFT", after)).toBe(false);
    }
  });

  it("a null viewer profile never matches the owner", () => {
    expect(
      canViewWaiverBoardContents({
        viewer: stranger,
        ownerProfileId: "",
        submissionStatus: "DRAFT",
        locksAt,
        now: after,
      }),
    ).toBe(false);
  });
});
