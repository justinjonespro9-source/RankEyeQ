import { describe, expect, it } from "vitest";
import {
  evaluateCaptureAuthority,
  evaluateWorkspaceSaveAuthority,
  inferLegacySubmissionAuthority,
  isOwnerManagedProfile,
  resolveSubmissionAuthority,
} from "@/lib/boards/authority";

const captured = [{ sourceRank: 1 }, { sourceRank: 2 }];
const workspace = [{ sourceRank: null }, { sourceRank: null }];
const mixed = [{ sourceRank: 1 }, { sourceRank: null }];

describe("legacy authority inference (sourceRank signal)", () => {
  it("all picks with sourceRank → RANKEYEQ_CAPTURED for any capturable type", () => {
    expect(inferLegacySubmissionAuthority({ profileType: "BENCHMARK", picks: captured })).toBe("RANKEYEQ_CAPTURED");
    expect(inferLegacySubmissionAuthority({ profileType: "CREATOR", picks: captured })).toBe("RANKEYEQ_CAPTURED");
  });

  it("no sourceRank → OWNER_AUTHORED for HUMAN/CREATOR, SYSTEM_OPERATED for AI", () => {
    expect(inferLegacySubmissionAuthority({ profileType: "HUMAN", picks: workspace })).toBe("OWNER_AUTHORED");
    expect(inferLegacySubmissionAuthority({ profileType: "CREATOR", picks: workspace })).toBe("OWNER_AUTHORED");
    expect(inferLegacySubmissionAuthority({ profileType: "AI", picks: workspace })).toBe("SYSTEM_OPERATED");
  });

  it("mixed, empty, or BENCHMARK without sourceRank → ambiguous (null)", () => {
    expect(inferLegacySubmissionAuthority({ profileType: "CREATOR", picks: mixed })).toBeNull();
    expect(inferLegacySubmissionAuthority({ profileType: "CREATOR", picks: [] })).toBeNull();
    expect(inferLegacySubmissionAuthority({ profileType: "BENCHMARK", picks: workspace })).toBeNull();
  });

  it("stored authority always wins over inference", () => {
    expect(
      resolveSubmissionAuthority({
        profileType: "CREATOR",
        submission: { authority: "OWNER_AUTHORED", picks: captured },
      }),
    ).toBe("OWNER_AUTHORED");
    expect(resolveSubmissionAuthority({ profileType: "CREATOR", submission: null })).toBeNull();
  });
});

describe("owner-managed profiles", () => {
  it("requires a linked User and a workspace-capable type", () => {
    expect(isOwnerManagedProfile({ profileType: "CREATOR", hasLinkedUser: true })).toBe(true);
    expect(isOwnerManagedProfile({ profileType: "HUMAN", hasLinkedUser: true })).toBe(true);
    expect(isOwnerManagedProfile({ profileType: "CREATOR", hasLinkedUser: false })).toBe(false);
    // Claimed Experts stay capture-managed.
    expect(isOwnerManagedProfile({ profileType: "BENCHMARK", hasLinkedUser: true })).toBe(false);
    expect(isOwnerManagedProfile({ profileType: "AI", hasLinkedUser: true })).toBe(false);
  });
});

describe("capture guard", () => {
  it("refuses OWNER_AUTHORED boards regardless of profile link state", () => {
    const decision = evaluateCaptureAuthority({
      profileType: "CREATOR",
      hasLinkedUser: false,
      submission: { authority: "OWNER_AUTHORED", picks: workspace },
    });
    expect(decision).toMatchObject({ allowed: false, reason: "owner_authored_board" });
  });

  it("refuses legacy boards inferred owner-authored", () => {
    expect(
      evaluateCaptureAuthority({
        profileType: "CREATOR",
        hasLinkedUser: false,
        submission: { authority: null, picks: workspace },
      }),
    ).toMatchObject({ allowed: false, reason: "owner_authored_board" });
  });

  it("refuses ambiguous legacy boards (fail closed)", () => {
    expect(
      evaluateCaptureAuthority({
        profileType: "CREATOR",
        hasLinkedUser: false,
        submission: { authority: null, picks: mixed },
      }),
    ).toMatchObject({ allowed: false, reason: "ambiguous_legacy_board" });
  });

  it("refuses owner-managed profiles when the contest board is not captured", () => {
    for (const submission of [null, { authority: null, picks: [] }]) {
      expect(
        evaluateCaptureAuthority({ profileType: "CREATOR", hasLinkedUser: true, submission }),
      ).toMatchObject({ allowed: false, reason: "owner_managed_profile" });
    }
  });

  it("allows capture of a claimed Creator's still-captured board (explicit or legacy)", () => {
    for (const authority of ["RANKEYEQ_CAPTURED", null] as const) {
      expect(
        evaluateCaptureAuthority({
          profileType: "CREATOR",
          hasLinkedUser: true,
          submission: { authority, picks: captured },
        }),
      ).toMatchObject({ allowed: true, boardAuthority: "RANKEYEQ_CAPTURED" });
    }
  });

  it("allows tracked Creators, Experts and claimed Experts with no board", () => {
    expect(evaluateCaptureAuthority({ profileType: "CREATOR", hasLinkedUser: false, submission: null }).allowed).toBe(true);
    expect(evaluateCaptureAuthority({ profileType: "BENCHMARK", hasLinkedUser: false, submission: null }).allowed).toBe(true);
    expect(evaluateCaptureAuthority({ profileType: "BENCHMARK", hasLinkedUser: true, submission: null }).allowed).toBe(true);
  });

  it("refuses SYSTEM_OPERATED boards", () => {
    expect(
      evaluateCaptureAuthority({
        profileType: "AI",
        hasLinkedUser: false,
        submission: { authority: "SYSTEM_OPERATED", picks: workspace },
      }),
    ).toMatchObject({ allowed: false, reason: "system_operated_board" });
  });
});

describe("workspace save guard", () => {
  it("refuses an owner save onto a captured board (no implicit takeover)", () => {
    for (const authority of ["RANKEYEQ_CAPTURED", null] as const) {
      const decision = evaluateWorkspaceSaveAuthority({
        requested: "OWNER_AUTHORED",
        profileType: "CREATOR",
        submission: { authority, picks: captured },
      });
      expect(decision.allowed).toBe(false);
    }
  });

  it("allows empty drafts and same-authority boards", () => {
    expect(evaluateWorkspaceSaveAuthority({ requested: "OWNER_AUTHORED", profileType: "CREATOR", submission: { authority: null, picks: [] } }).allowed).toBe(true);
    expect(evaluateWorkspaceSaveAuthority({ requested: "OWNER_AUTHORED", profileType: "HUMAN", submission: { authority: null, picks: workspace } }).allowed).toBe(true);
    expect(evaluateWorkspaceSaveAuthority({ requested: "SYSTEM_OPERATED", profileType: "AI", submission: { authority: "SYSTEM_OPERATED", picks: workspace } }).allowed).toBe(true);
  });

  it("binds each authority to the only profile types allowed to hold it", () => {
    expect(evaluateWorkspaceSaveAuthority({ requested: "OWNER_AUTHORED", profileType: "BENCHMARK", submission: null }).allowed).toBe(false);
    expect(evaluateWorkspaceSaveAuthority({ requested: "OWNER_AUTHORED", profileType: "AI", submission: null }).allowed).toBe(false);
    expect(evaluateWorkspaceSaveAuthority({ requested: "SYSTEM_OPERATED", profileType: "HUMAN", submission: null }).allowed).toBe(false);
    expect(evaluateWorkspaceSaveAuthority({ requested: "SYSTEM_OPERATED", profileType: "CREATOR", submission: null }).allowed).toBe(false);
  });
});
