import { describe, expect, it, vi } from "vitest";
import { logServerEvent } from "@/lib/log";

describe("structured logging", () => {
  it("redacts secrets and does not print raw tokens", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logServerEvent("auth.failure", {
      reason: "invalid",
      AUTH_SECRET: "super-secret-value",
      apiKey: "sk_live_123",
    });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("auth.failure");
    expect(line).not.toContain("super-secret-value");
    expect(line).not.toContain("sk_live_123");
    expect(line).toContain("[redacted]");
    spy.mockRestore();
  });
});
