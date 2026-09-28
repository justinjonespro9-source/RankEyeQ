import { beforeEach, describe, expect, it, vi } from "vitest";

const authState: { ctx: unknown } = { ctx: null };

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: async () => authState.ctx,
}));
vi.mock("@/lib/request-ip", () => ({
  rateLimitKey: async (scope: string, subject?: string | null) =>
    `${scope}:${subject ?? "test"}`,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const publishOfficialBoard = vi.fn();
const createWeeklyContent = vi.fn();
vi.mock("@/lib/boards/official-board", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/boards/official-board")>();
  return { ...actual, publishOfficialBoard: (...args: unknown[]) => publishOfficialBoard(...args) };
});
vi.mock("@/lib/weekly-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/weekly-content")>();
  return { ...actual, createWeeklyContent: (...args: unknown[]) => createWeeklyContent(...args) };
});

import {
  createWeeklyContentAction,
  publishOfficialBoardAction,
} from "@/lib/official-board-actions";

const session = (profileId: string) => ({
  user: { id: `user-${profileId}` },
  universalProfile: { id: profileId, username: `u_${profileId}`, profileType: "HUMAN", status: "ACTIVE" },
});

describe("Official Board actions derive the owner from the session (spoofing)", () => {
  beforeEach(() => {
    publishOfficialBoard.mockReset().mockResolvedValue({ outcome: "published", versionNumber: 1 });
    createWeeklyContent.mockReset().mockResolvedValue({});
  });

  it("publishes as the session user, never a client-supplied profile", async () => {
    authState.ctx = session("owner");
    const result = await publishOfficialBoardAction({ contestId: "c1", position: "RB" });
    expect(result).toEqual({ ok: true, outcome: "published", versionNumber: 1 });
    expect(publishOfficialBoard).toHaveBeenCalledWith({ userId: "user-owner", contestId: "c1" });
  });

  it("refuses a mismatched client profile id without touching boards", async () => {
    authState.ctx = session("attacker");
    const result = await publishOfficialBoardAction({
      contestId: "c1",
      position: "RB",
      universalProfileId: "victim",
    });
    expect(result).toEqual({ ok: false, error: "Cannot submit as another profile" });
    expect(publishOfficialBoard).not.toHaveBeenCalled();

    const content = await createWeeklyContentAction({
      weekId: "w1",
      content: { title: "x", url: "https://example.com", type: "OTHER" },
      universalProfileId: "victim",
    });
    expect(content.ok).toBe(false);
    expect(createWeeklyContent).not.toHaveBeenCalled();
  });

  it("requires a signed-in profile", async () => {
    authState.ctx = null;
    const result = await publishOfficialBoardAction({ contestId: "c1", position: "RB" });
    expect(result.ok).toBe(false);
    expect(publishOfficialBoard).not.toHaveBeenCalled();
  });
});
