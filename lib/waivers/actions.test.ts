import { beforeEach, describe, expect, it, vi } from "vitest";

const authState: { ctx: unknown; admin: unknown } = { ctx: null, admin: null };

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: async () => authState.ctx,
  assertAdmin: async () => {
    if (!authState.admin) throw new Error("Admin access required");
    return authState.admin;
  },
}));
vi.mock("@/lib/request-ip", () => ({
  rateLimitKey: async (scope: string, subject?: string | null) => `${scope}:${subject ?? "test"}`,
}));

const saveWaiverDraft = vi.fn();
const submitWaiverBoard = vi.fn();
vi.mock("@/lib/waivers/submissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/waivers/submissions")>();
  return {
    ...actual,
    saveWaiverDraft: (...args: unknown[]) => saveWaiverDraft(...args),
    submitWaiverBoard: (...args: unknown[]) => submitWaiverBoard(...args),
  };
});
const openWaiverContestsForWeek = vi.fn();
vi.mock("@/lib/waivers/contests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/waivers/contests")>();
  return { ...actual, openWaiverContestsForWeek: (...args: unknown[]) => openWaiverContestsForWeek(...args) };
});

import { openWaiverContestsAction, saveWaiverDraftAction, submitWaiverBoardAction } from "@/lib/waivers/actions";
import { WaiverSubmissionError } from "@/lib/waivers/submissions";

let seq = 0;
const session = (profileType = "HUMAN", status = "ACTIVE") => {
  seq += 1;
  const id = `p${seq}`;
  return { user: { id: `user-${id}` }, universalProfile: { id, username: `u_${id}`, profileType, status } };
};

const writeResult = {
  submissionId: "sub-1",
  status: "SUBMITTED",
  revisionNumber: 2,
  callCount: 1,
  changed: true,
  submittedAt: new Date("2026-10-27T20:00:00.000Z"),
};

describe("Waiver board actions derive identity from the session", () => {
  beforeEach(() => {
    saveWaiverDraft.mockReset().mockResolvedValue({ ...writeResult, status: "DRAFT", submittedAt: null });
    submitWaiverBoard.mockReset().mockResolvedValue(writeResult);
  });

  it("submits as the session profile and login, returning a shaped result", async () => {
    const ctx = session();
    authState.ctx = ctx;
    const result = await submitWaiverBoardAction({ contestId: "c1", playerIds: ["pl1", null, null] });
    expect(result).toEqual({
      ok: true,
      status: "SUBMITTED",
      revisionNumber: 2,
      callCount: 1,
      changed: true,
      submittedAt: "2026-10-27T20:00:00.000Z",
    });
    expect(submitWaiverBoard).toHaveBeenCalledWith({
      contestId: "c1",
      universalProfileId: ctx.universalProfile.id,
      userId: ctx.user.id,
      playerIds: ["pl1", null, null],
    });
  });

  it("saves drafts through the draft service", async () => {
    authState.ctx = session("CREATOR");
    const result = await saveWaiverDraftAction({ contestId: "c1", playerIds: [] });
    expect(result).toMatchObject({ ok: true, status: "DRAFT", submittedAt: null });
    expect(saveWaiverDraft).toHaveBeenCalledOnce();
    expect(submitWaiverBoard).not.toHaveBeenCalled();
  });

  it("refuses a client-supplied profile that does not match the session", async () => {
    authState.ctx = session();
    const result = await submitWaiverBoardAction({ contestId: "c1", playerIds: [], universalProfileId: "victim" });
    expect(result).toEqual({ ok: false, error: "Cannot submit as another profile", code: "FORBIDDEN" });
    expect(submitWaiverBoard).not.toHaveBeenCalled();
  });

  it.each([
    ["signed out", null, "SIGNED_OUT"],
    ["no profile", { user: { id: "u-x" }, universalProfile: null }, "NEEDS_SETUP"],
  ])("rejects %s", async (_label, ctx, code) => {
    authState.ctx = ctx;
    const result = await submitWaiverBoardAction({ contestId: "c1", playerIds: [] });
    expect(result).toMatchObject({ ok: false, code });
    expect(submitWaiverBoard).not.toHaveBeenCalled();
  });

  it.each(["AI", "BENCHMARK"])("the owner-authored path refuses %s profiles", async (profileType) => {
    authState.ctx = session(profileType);
    expect(await submitWaiverBoardAction({ contestId: "c1", playerIds: [] })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await saveWaiverDraftAction({ contestId: "c1", playerIds: [] })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(submitWaiverBoard).not.toHaveBeenCalled();
    expect(saveWaiverDraft).not.toHaveBeenCalled();
  });

  it("refuses suspended profiles", async () => {
    authState.ctx = session("HUMAN", "SUSPENDED");
    expect(await submitWaiverBoardAction({ contestId: "c1", playerIds: [] })).toMatchObject({ ok: false, code: "SUSPENDED" });
  });

  it.each([
    ["missing contest", { playerIds: [] }],
    ["too many slots", { contestId: "c1", playerIds: ["a", "b", "c", "d", "e", "f"] }],
    ["non-string player", { contestId: "c1", playerIds: [42] }],
    ["non-array board", { contestId: "c1", playerIds: "a,b" }],
    ["oversized id", { contestId: "x".repeat(65), playerIds: [] }],
  ])("validates untrusted input (%s)", async (_label, input) => {
    authState.ctx = session();
    const result = await submitWaiverBoardAction(input as never);
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(submitWaiverBoard).not.toHaveBeenCalled();
  });

  it("maps service errors (e.g. lock) to shaped failures", async () => {
    authState.ctx = session();
    submitWaiverBoard.mockRejectedValueOnce(new WaiverSubmissionError("LOCKED", "locked"));
    expect(await submitWaiverBoardAction({ contestId: "c1", playerIds: [] })).toEqual({
      ok: false,
      error: "locked",
      code: "LOCKED",
    });
  });

  it("rate-limits submissions per profile", async () => {
    authState.ctx = session();
    const results = [];
    for (let i = 0; i < 9; i += 1) results.push(await submitWaiverBoardAction({ contestId: "c1", playerIds: [] }));
    expect(results.slice(0, 8).every((r) => r.ok)).toBe(true);
    expect(results[8]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("openWaiverContestsAction requires an authenticated admin", () => {
  beforeEach(() => {
    openWaiverContestsForWeek.mockReset().mockResolvedValue({
      weekId: "w1",
      snapshotId: "s1",
      locksAt: new Date("2026-10-28T00:00:00.000Z"),
      opened: [{ position: "QB", contestId: "c1", availableSlots: 3 }],
      existing: [],
      refused: [{ position: "TE", reason: "EMPTY_ELIGIBLE_POOL" }],
    });
  });

  it("refuses non-admins without calling the service", async () => {
    authState.admin = null;
    expect(await openWaiverContestsAction({ weekId: "w1", snapshotId: "s1" })).toEqual({
      ok: false,
      error: "Admin access required",
      code: "FORBIDDEN",
    });
    expect(openWaiverContestsForWeek).not.toHaveBeenCalled();
  });

  it("opens as the authenticated admin", async () => {
    authState.admin = { user: { id: "admin-1" }, universalProfile: null };
    const result = await openWaiverContestsAction({ weekId: "w1", snapshotId: "s1" });
    expect(openWaiverContestsForWeek).toHaveBeenCalledWith({ adminUserId: "admin-1", weekId: "w1", snapshotId: "s1" });
    expect(result).toMatchObject({ ok: true, locksAt: "2026-10-28T00:00:00.000Z" });
  });

  it("validates admin input", async () => {
    authState.admin = { user: { id: "admin-1" }, universalProfile: null };
    expect(await openWaiverContestsAction({ weekId: "", snapshotId: "s1" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(openWaiverContestsForWeek).not.toHaveBeenCalled();
  });
});
