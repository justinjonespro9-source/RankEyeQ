import { describe, expect, it } from "vitest";
import { rateLimit, resetRateLimitStore } from "@/lib/rate-limit";

describe("rate limit abstraction", () => {
  it("allows requests under the limit and then blocks", () => {
    resetRateLimitStore();
    const now = 1_000_000;
    expect(
      rateLimit({ key: "draft:user-1", limit: 2, windowMs: 60_000, now }),
    ).toMatchObject({ ok: true });
    expect(
      rateLimit({ key: "draft:user-1", limit: 2, windowMs: 60_000, now: now + 10 }),
    ).toMatchObject({ ok: true });
    const blocked = rateLimit({
      key: "draft:user-1",
      limit: 2,
      windowMs: 60_000,
      now: now + 20,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    resetRateLimitStore();
    const now = 5_000_000;
    rateLimit({ key: "submit:user-2", limit: 1, windowMs: 100, now });
    expect(
      rateLimit({ key: "submit:user-2", limit: 1, windowMs: 100, now: now + 50 }).ok,
    ).toBe(false);
    expect(
      rateLimit({ key: "submit:user-2", limit: 1, windowMs: 100, now: now + 101 }).ok,
    ).toBe(true);
  });
});
