import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  logServerEvent: vi.fn(),
}));

import { logServerEvent } from "@/lib/log";
import { trackEvent } from "@/lib/analytics";

describe("analytics events", () => {
  it("drops PII keys from payloads", () => {
    trackEvent("signup_completed", {
      email: "user@example.com",
      token: "abc",
      contestsPlayed: 3,
    });
    expect(logServerEvent).toHaveBeenCalledWith(
      "analytics.signup_completed",
      { contestsPlayed: 3 },
    );
  });
});
