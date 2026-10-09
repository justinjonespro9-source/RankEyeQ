import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildWaiverAiPrompt, type WaiverAiPromptInput } from "@/lib/waivers/ai/prompt";
import { isStorableText, sha256Utf8, utf8ByteLength } from "@/lib/waivers/ai/text";

const INPUT: WaiverAiPromptInput = {
  seasonYear: 2026,
  weekNumber: 6,
  position: "WR",
  maxCalls: 5,
  snapshot: { version: 2, entriesFingerprint: "f".repeat(64), thresholdBps: 5000 },
  pool: [
    { displayName: "Tyler Lockett", team: "TEN", opponent: "LV", rosteredBps: 1250 },
    { displayName: "Rashid Shaheed", team: "NO", opponent: null, rosteredBps: 4999 },
  ],
};

describe("buildWaiverAiPrompt (WAIVEREYEQ_AI_V1)", () => {
  it("is deterministic and hashes the exact text", () => {
    const a = buildWaiverAiPrompt(INPUT);
    const b = buildWaiverAiPrompt(structuredClone(INPUT));
    expect(a).toEqual(b);
    expect(a.version).toBe("WAIVEREYEQ_AI_V1");
    expect(a.sha256).toBe(createHash("sha256").update(a.text, "utf8").digest("hex"));
    expect(a.text).not.toMatch(/\d{4}-\d{2}-\d{2}T|generated at/i);
  });

  it("states the WaiverEyeQ rules and lists only the frozen pool", () => {
    const { text, availableSlots, poolSize } = buildWaiverAiPrompt(INPUT);
    expect(availableSlots).toBe(2);
    expect(poolSize).toBe(2);
    for (const rule of [
      "It is NOT RankEyeQ Rankings",
      "Half-PPR",
      "Make up to 2 picks. Fewer picks are allowed.",
      "No reserves",
      "starting at #1",
      "Use only players from the frozen eligible pool",
      "Do not invent, substitute",
      "NO CALLS",
      "Return only the ordered list",
      "2026 NFL season, Week 6",
      `snapshot v2, fingerprint ${"f".repeat(64)}`,
    ]) {
      expect(text, rule).toContain(rule);
    }
    expect(text).toContain("- Tyler Lockett (TEN, opp. LV) — rostered 12.50%");
    expect(text).toContain("- Rashid Shaheed (NO) — rostered 49.99%");
  });

  it("caps picks at the contest maximum and changes with any input", () => {
    const pool = Array.from({ length: 8 }, (_, i) => ({ displayName: `WR ${i}`, team: "KC", opponent: null, rosteredBps: i }));
    expect(buildWaiverAiPrompt({ ...INPUT, pool }).availableSlots).toBe(5);
    expect(buildWaiverAiPrompt({ ...INPUT, position: "QB", maxCalls: 3, pool }).availableSlots).toBe(3);
    const base = buildWaiverAiPrompt(INPUT).sha256;
    expect(buildWaiverAiPrompt({ ...INPUT, snapshot: { ...INPUT.snapshot, version: 3 } }).sha256).not.toBe(base);
    expect(buildWaiverAiPrompt({ ...INPUT, pool: [...INPUT.pool].reverse() }).sha256).not.toBe(base);
  });

  it("an empty pool asks for exactly NO CALLS", () => {
    const prompt = buildWaiverAiPrompt({ ...INPUT, pool: [] });
    expect(prompt).toMatchObject({ availableSlots: 0, poolSize: 0 });
    expect(prompt.text).toContain("Reply with exactly:\nNO CALLS");
  });
});

describe("AI text helpers", () => {
  it("hashes and measures UTF-8 bytes", () => {
    expect(sha256Utf8("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(utf8ByteLength("é—")).toBe(5);
    expect(sha256Utf8("a\r\nb")).not.toBe(sha256Utf8("a\nb"));
  });

  it("refuses text that would not round-trip", () => {
    expect(isStorableText("ok\u00e9")).toBe(true);
    expect(isStorableText("a\u0000b")).toBe(false);
    expect(isStorableText("a\uDC00")).toBe(false);
  });
});
