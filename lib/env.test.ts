import { describe, expect, it } from "vitest";
import { isStrictProductionEnv, validateEnv } from "@/lib/env";

const base = {
  DATABASE_URL: "postgresql://user@localhost:5432/rankiq",
  AUTH_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
  AUTH_URL: "https://rankiq.example",
  EMAIL_FROM: "RankIQ <noreply@rankiq.example>",
  AUTH_RESEND_KEY: "re_test",
  NFL_DATA_PROVIDER: "mock",
  NODE_ENV: "production",
};

describe("production env validation", () => {
  it("passes a complete production config", () => {
    const result = validateEnv(base, { strict: true });
    expect(result.ok).toBe(true);
    expect(result.summary.hasDatabaseUrl).toBe(true);
    expect(result.summary.emailProvider).toBe("resend");
    expect(result.summary.nflProvider).toBe("mock");
  });

  it("fails when DATABASE_URL is missing", () => {
    const result = validateEnv({ ...base, DATABASE_URL: "" }, { strict: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.key === "DATABASE_URL")).toBe(true);
  });

  it("accepts manual provider without SportsDataIO key", () => {
    const result = validateEnv(
      { ...base, NFL_DATA_PROVIDER: "manual" },
      { strict: true },
    );
    expect(result.ok).toBe(true);
    expect(result.summary.nflProvider).toBe("manual");
    expect(result.summary.hasSportsDataKey).toBe(false);
  });

  it("fails SportsDataIO without an API key", () => {
    const result = validateEnv(
      { ...base, NFL_DATA_PROVIDER: "sportsdataio" },
      { strict: true },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.key === "SPORTSDATAIO_API_KEY")).toBe(
      true,
    );
  });

  it("requires both Google id and secret when one is set", () => {
    const result = validateEnv(
      { ...base, AUTH_GOOGLE_ID: "id-only" },
      { strict: true },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.key === "AUTH_GOOGLE")).toBe(true);
  });

  it("treats VERCEL_ENV=production as strict", () => {
    expect(isStrictProductionEnv({ VERCEL_ENV: "production" })).toBe(true);
    expect(isStrictProductionEnv({ NODE_ENV: "production" })).toBe(false);
  });

  it("does not expose secret values in the summary", () => {
    const result = validateEnv(base, { strict: true });
    expect(JSON.stringify(result.summary)).not.toContain("re_test");
    expect(JSON.stringify(result.summary)).not.toContain(base.AUTH_SECRET);
  });
});
