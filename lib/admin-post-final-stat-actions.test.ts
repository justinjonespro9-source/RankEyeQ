import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, findUserMock, previewMock, applyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUserMock: vi.fn(),
  previewMock: vi.fn(),
  applyMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUserMock(...args) } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/nfl/post-final-stat-correction", () => ({
  previewPostFinalStatCorrection: (...args: unknown[]) => previewMock(...args),
  applyPostFinalStatCorrection: (...args: unknown[]) => applyMock(...args),
  resolveWeekStatIdForContestEntry: vi.fn(),
}));

import {
  applyPostFinalStatCorrectionAction,
  applyPostFinalStatCorrectionForWeekAction,
  previewPostFinalStatCorrectionAction,
} from "@/lib/admin-post-final-stat-actions";

const correction = {
  weekStatId: "pws-1",
  kind: "player" as const,
  proposedStats: { receptions: 5, receivingYards: 50, receivingTds: 1 },
  reason: "Rec TD entered as 10",
  sourceReference: "official box score",
  confirmHighImpact: true,
};

function signIn(role: "USER" | "ADMIN" | null) {
  if (role === null) {
    authMock.mockResolvedValue(null);
    return;
  }
  authMock.mockResolvedValue({ user: { id: `user-${role}` } });
  findUserMock.mockResolvedValue({
    id: `user-${role}`,
    role,
    universalProfile: null,
  });
}

describe("verified stat correction actions — admin authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewMock.mockResolvedValue({ ok: true, preview: {} });
    applyMock.mockResolvedValue({ ok: false, error: "not_found", message: "x" });
  });

  it.each([
    ["signed out", null],
    ["non-admin user", "USER"],
  ] as const)("refuses %s preview and apply without touching the service", async (_label, role) => {
    signIn(role);
    await expect(
      previewPostFinalStatCorrectionAction({
        weekStatId: correction.weekStatId,
        kind: correction.kind,
        proposedStats: correction.proposedStats,
      }),
    ).rejects.toThrow("Admin access required");
    await expect(applyPostFinalStatCorrectionAction(correction)).rejects.toThrow(
      "Admin access required",
    );
    await expect(
      applyPostFinalStatCorrectionForWeekAction({ ...correction, weekId: "week-3" }),
    ).rejects.toThrow("Admin access required");
    expect(previewMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("applies as the signed-in admin, never a client-supplied id", async () => {
    signIn("ADMIN");
    await applyPostFinalStatCorrectionAction({
      ...correction,
      adminUserId: "spoofed-admin",
    } as typeof correction);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0][0]).toMatchObject({ adminUserId: "user-ADMIN" });
  });
});
