import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The frozen prompt is shown only on the admin AI board page. The page checks
 * the admin session itself (layouts do not re-run on client navigation) before
 * loading anything, and the admin layout guards the whole tree.
 */

const requireAdmin = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireAdmin: () => requireAdmin() }));
const loadWaiverAiBoardView = vi.fn();
vi.mock("@/lib/waivers/ai/queries", () => ({ loadWaiverAiBoardView: (...args: unknown[]) => loadWaiverAiBoardView(...args) }));

const { default: AdminWaiverAiBoardPage } = await import("@/app/admin/waivers/ai/[profileId]/[contestId]/page");

const params = Promise.resolve({ profileId: "ai1", contestId: "c1" });

beforeEach(() => {
  requireAdmin.mockReset();
  loadWaiverAiBoardView.mockReset();
});

describe("admin AI board page access", () => {
  it("refuses signed-out users and non-admins before loading the board or its prompt", async () => {
    for (const destination of ["/signin?callbackUrl=/admin", "/"]) {
      requireAdmin.mockRejectedValueOnce(Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${destination};307;` }));
      await expect(AdminWaiverAiBoardPage({ params })).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(loadWaiverAiBoardView).not.toHaveBeenCalled();
  });

  it("loads the board only after the admin check passes", async () => {
    requireAdmin.mockResolvedValueOnce({ user: { id: "admin", role: "ADMIN" } });
    loadWaiverAiBoardView.mockResolvedValueOnce(null);
    await expect(AdminWaiverAiBoardPage({ params })).rejects.toThrow();
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(loadWaiverAiBoardView).toHaveBeenCalledWith("ai1", "c1");
    expect(requireAdmin.mock.invocationCallOrder[0]).toBeLessThan(loadWaiverAiBoardView.mock.invocationCallOrder[0]);
  });

  it("the admin layout still guards every admin route", () => {
    const layout = readFileSync(path.join(process.cwd(), "app/admin/layout.tsx"), "utf8");
    expect(layout).toMatch(/await requireAdmin\(\);/);
  });
});
