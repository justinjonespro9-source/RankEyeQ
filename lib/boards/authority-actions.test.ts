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

const saveSubmissionPicks = vi.fn();
const submitRanking = vi.fn();
vi.mock("@/lib/submissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/submissions")>();
  return {
    ...actual,
    saveSubmissionPicks: (...args: unknown[]) => saveSubmissionPicks(...args),
    submitRanking: (...args: unknown[]) => submitRanking(...args),
  };
});

import { saveDraftAction, submitRankingsAction } from "@/lib/submission-actions";

const savedBoard = {
  status: "DRAFT",
  submittedAt: null,
  updatedAt: new Date("2026-09-20T12:00:00Z"),
  picks: [],
};

describe("workspace actions stamp OWNER_AUTHORED server-side", () => {
  beforeEach(() => {
    saveSubmissionPicks.mockReset().mockResolvedValue(savedBoard);
    submitRanking.mockReset().mockResolvedValue({ ...savedBoard, status: "SUBMITTED" });
  });

  it.each(["HUMAN", "CREATOR"] as const)(
    "%s: client-supplied authority is ignored",
    async (profileType) => {
      authState.ctx = {
        user: { id: `u-${profileType}` },
        universalProfile: {
          id: `p-${profileType}`,
          username: `owner_${profileType.toLowerCase()}`,
          profileType,
          status: "ACTIVE",
        },
      };
      const spoofed = {
        contestId: "c1",
        rankedEntryIds: ["e1"],
        position: "RB",
        authority: "RANKEYEQ_CAPTURED",
      } as unknown as Parameters<typeof saveDraftAction>[0];

      await saveDraftAction(spoofed);
      await submitRankingsAction(spoofed);

      expect(saveSubmissionPicks).toHaveBeenCalledTimes(1);
      expect(saveSubmissionPicks.mock.calls[0]![0]).toMatchObject({
        universalProfileId: `p-${profileType}`,
        authority: "OWNER_AUTHORED",
      });
      expect(submitRanking.mock.calls[0]![0]).toMatchObject({
        universalProfileId: `p-${profileType}`,
        authority: "OWNER_AUTHORED",
      });
    },
  );
});
