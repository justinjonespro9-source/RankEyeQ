import { describe, expect, it } from "vitest";
import {
  buildAiHistoricalPreviewFingerprint,
  evaluateHistoricalAvailability,
} from "@/lib/rankings/ai-historical-backfill";

describe("evaluateHistoricalAvailability", () => {
  const competitiveAt = new Date("2026-11-20T00:40:00.000Z");

  it("allows selectable weekly designations including AVAILABLE", () => {
    expect(
      evaluateHistoricalAvailability({
        designation: "QUESTIONABLE",
        sourcePublishedAt: new Date("2026-11-19T12:00:00.000Z"),
        observedAt: new Date("2026-11-19T12:00:00.000Z"),
        competitiveAt,
      }),
    ).toEqual({
      block: false,
      laterOutWarning: false,
      detail: null,
    });
    expect(
      evaluateHistoricalAvailability({
        designation: "AVAILABLE",
        sourcePublishedAt: new Date("2026-11-19T12:00:00.000Z"),
        observedAt: new Date("2026-11-19T12:00:00.000Z"),
        competitiveAt,
      }).block,
    ).toBe(false);
    expect(
      evaluateHistoricalAvailability({
        designation: "ACTIVE", // admin form alias → AVAILABLE
        sourcePublishedAt: null,
        observedAt: new Date("2026-11-19T12:00:00.000Z"),
        competitiveAt,
      }).block,
    ).toBe(false);
  });

  it("blocks hard-unavailable with evidence before prediction time", () => {
    const result = evaluateHistoricalAvailability({
      designation: "OUT",
      sourcePublishedAt: new Date("2026-11-19T18:00:00.000Z"),
      observedAt: new Date("2026-11-21T12:00:00.000Z"),
      competitiveAt,
    });
    expect(result.block).toBe(true);
    expect(result.laterOutWarning).toBe(false);
    expect(result.detail).toContain("OUT");
  });

  it("never auto-invalidates a later OUT after legitimate prediction", () => {
    const result = evaluateHistoricalAvailability({
      designation: "OUT",
      sourcePublishedAt: new Date("2026-11-20T03:00:00.000Z"),
      observedAt: new Date("2026-11-20T03:00:00.000Z"),
      competitiveAt,
    });
    expect(result.block).toBe(false);
    expect(result.laterOutWarning).toBe(true);
    expect(result.detail).toMatch(/not applied retroactively/i);
    expect(result.detail).toMatch(/remains historically eligible/i);
  });

  it("uses observedAt when sourcePublishedAt is missing", () => {
    const result = evaluateHistoricalAvailability({
      designation: "OUT",
      sourcePublishedAt: null,
      observedAt: new Date("2026-11-18T00:00:00.000Z"),
      competitiveAt,
    });
    expect(result.block).toBe(true);
  });
});

describe("buildAiHistoricalPreviewFingerprint", () => {
  it("is stable for identical inputs and changes when picks or evidence change", () => {
    const base = {
      contestId: "c1",
      universalProfileId: "ai1",
      rankedEntryIds: ["a", "b", "c"],
      originalPredictionAt: new Date("2026-11-20T00:40:00.000Z"),
      evidenceType: "CHAT_TRANSCRIPT",
      evidenceReference: "vault://w11-claude-qb",
      sourceIdentifier: "chat-1",
      responseSha256: "abc",
    };
    const first = buildAiHistoricalPreviewFingerprint(base);
    const second = buildAiHistoricalPreviewFingerprint(base);
    expect(first).toBe(second);
    expect(
      buildAiHistoricalPreviewFingerprint({
        ...base,
        rankedEntryIds: ["a", "c", "b"],
      }),
    ).not.toBe(first);
    expect(
      buildAiHistoricalPreviewFingerprint({
        ...base,
        evidenceReference: "vault://other",
      }),
    ).not.toBe(first);
  });
});
