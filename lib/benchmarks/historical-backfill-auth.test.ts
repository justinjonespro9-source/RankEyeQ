import { describe, expect, it, vi } from "vitest";

/**
 * G. Non-admin cannot invoke the admin capture server action.
 * The action calls assertAdmin() before any write.
 */
describe("G. Non-admin backfill guard", () => {
  it("adminCaptureBenchmarkAction requires assertAdmin", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/session", () => ({
      assertAdmin: vi.fn(async () => {
        throw new Error("Admin access required");
      }),
    }));

    const { adminCaptureBenchmarkAction } = await import(
      "@/lib/admin-benchmark-actions"
    );

    const result = await adminCaptureBenchmarkAction({
      contestId: "c1",
      profileId: "p1",
      captureType: "SUNDAY",
      rawText: "1. Player",
      publicBoardAllowed: true,
      historicalBackfill: true,
      sourcePublishedAt: "2026-09-10T15:00",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Admin access required|Unable to capture/i);
    }

    vi.doUnmock("@/lib/auth/session");
    vi.resetModules();
  });
});
