import { describe, expect, it, vi } from "vitest";
import {
  clearCreatorImportDraft,
  creatorImportDraftStorageKey,
  emptyCreatorImportDraft,
  readCreatorImportDraft,
  shouldClearCreatorImportDraft,
  writeCreatorImportDraft,
} from "@/lib/admin/creator-import-draft";
import { extractTopNFromPastedText } from "@/lib/benchmarks/parser";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { parseCreatorRankingPaste } from "@/lib/creators/ranking-paste";

function makeEligible(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    name: `${prefix} Player ${index + 1}`,
    team: "TST",
    shortName: `${prefix}${index + 1}`,
  }));
}

describe("creator import draft preservation", () => {
  it("only clears draft after official success", () => {
    expect(shouldClearCreatorImportDraft({ ok: false, official: false })).toBe(
      false,
    );
    expect(shouldClearCreatorImportDraft({ ok: true, official: false })).toBe(
      false,
    );
    expect(shouldClearCreatorImportDraft({ ok: true, official: true })).toBe(
      true,
    );
  });

  it("round-trips session draft including parsed rows and source fields", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };

    const draft = emptyCreatorImportDraft({
      raw: "1. A\n2. B",
      sourceUrl: "https://example.com/ranks",
      sourcePublishedAt: "2026-09-07T10:00",
      capturedAt: "2026-09-07T11:00",
      ready: true,
      rows: [
        {
          sourceRank: 1,
          rawName: "A",
          matchedEntryId: "a",
          matchedName: "A",
          issue: null,
          candidates: [],
          selected: true,
          rankIqRank: 1,
          excluded: false,
          exclusionReason: null,
          extra: false,
        },
      ],
      blocking: [],
    });

    writeCreatorImportDraft(storage, "prof1", "contest1", draft);
    expect(store.has(creatorImportDraftStorageKey("prof1", "contest1"))).toBe(
      true,
    );

    const restored = readCreatorImportDraft(storage, "prof1", "contest1");
    expect(restored?.raw).toBe(draft.raw);
    expect(restored?.sourceUrl).toBe(draft.sourceUrl);
    expect(restored?.sourcePublishedAt).toBe(draft.sourcePublishedAt);
    expect(restored?.ready).toBe(true);
    expect(restored?.rows?.[0]?.matchedEntryId).toBe("a");

    clearCreatorImportDraft(storage, "prof1", "contest1");
    expect(readCreatorImportDraft(storage, "prof1", "contest1")).toBeNull();
  });

  it("survives simulated server failure without clearing", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
    };

    const draft = emptyCreatorImportDraft({
      raw: "fifteen wr names…",
      sourceUrl: "https://x.com/creator",
      ready: true,
      rows: [],
    });
    writeCreatorImportDraft(storage, "p", "c", draft);

    const failed = { ok: false as const, error: "simulated failure" };
    if (shouldClearCreatorImportDraft(failed)) {
      clearCreatorImportDraft(storage, "p", "c");
    }
    expect(readCreatorImportDraft(storage, "p", "c")?.raw).toBe(draft.raw);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe("creator WR Top 15 field size", () => {
  const wrEligible = makeEligible(20, "WR");
  const rbEligible = makeEligible(12, "RB");

  it("defaults WR=15 and Top-10 positions=10", () => {
    expect(rankingDepthForPosition("WR")).toBe(15);
    expect(rankingDepthForPosition("RB")).toBe(10);
    expect(rankingDepthForPosition("QB")).toBe(10);
    expect(rankingDepthForPosition("TE")).toBe(10);
    expect(rankingDepthForPosition("DEF")).toBe(10);
  });

  it("accepts exactly 15 numbered WR lines", () => {
    const text = wrEligible
      .slice(0, 15)
      .map((row, index) => `${index + 1}. ${row.name}`)
      .join("\n");
    const tiered = parseCreatorRankingPaste(text);
    expect(tiered.ok).toBe(true);
    if (!tiered.ok) return;
    const extracted = extractTopNFromPastedText({
      text,
      lines: tiered.lines,
      eligible: wrEligible,
      rankingDepth: 15,
    });
    expect(extracted.ready).toBe(true);
    expect(extracted.selected).toHaveLength(15);
    expect(extracted.rankedEntryIds.every(Boolean)).toBe(true);
  });

  it("accepts plain 15-line WR paste", () => {
    const text = wrEligible
      .slice(0, 15)
      .map((row) => row.name)
      .join("\n");
    const extracted = extractTopNFromPastedText({
      text,
      eligible: wrEligible,
      rankingDepth: 15,
    });
    expect(extracted.ready).toBe(true);
    expect(extracted.selected).toHaveLength(15);
  });

  it("rejects 14 / 16 / duplicate / invalid WR without silent repair", () => {
    const fourteen = wrEligible
      .slice(0, 14)
      .map((row, index) => `${index + 1}. ${row.name}`)
      .join("\n");
    expect(
      extractTopNFromPastedText({
        text: fourteen,
        eligible: wrEligible,
        rankingDepth: 15,
      }).ready,
    ).toBe(false);

    const sixteen = wrEligible
      .slice(0, 16)
      .map((row, index) => `${index + 1}. ${row.name}`)
      .join("\n");
    const over = extractTopNFromPastedText({
      text: sixteen,
      eligible: wrEligible,
      rankingDepth: 15,
    });
    expect(over.ready).toBe(true);
    expect(over.selected).toHaveLength(15);
    expect(over.rows.filter((row) => row.extra)).toHaveLength(1);

    const dupLines = [
      ...wrEligible.slice(0, 14).map((row, index) => `${index + 1}. ${row.name}`),
      `15. ${wrEligible[0]!.name}`,
    ].join("\n");
    const dup = extractTopNFromPastedText({
      text: dupLines,
      eligible: wrEligible,
      rankingDepth: 15,
    });
    expect(dup.ready).toBe(false);
    expect(dup.rows.some((row) => row.issue === "duplicate_player")).toBe(true);

    const invalid = [
      "1. Not A Real WR",
      ...wrEligible
        .slice(0, 14)
        .map((row, index) => `${index + 2}. ${row.name}`),
    ].join("\n");
    const bad = extractTopNFromPastedText({
      text: invalid,
      eligible: wrEligible,
      rankingDepth: 15,
    });
    expect(bad.ready).toBe(false);
    expect(bad.rows[0]?.issue).toBe("unknown");
    expect(bad.rows[0]?.matchedEntryId).toBeNull();
  });

  it("keeps RB Top 10 exact-count behavior", () => {
    const text = rbEligible
      .slice(0, 10)
      .map((row, index) => `${index + 1}. ${row.name}`)
      .join("\n");
    const ok = extractTopNFromPastedText({
      text,
      eligible: rbEligible,
      rankingDepth: 10,
    });
    expect(ok.ready).toBe(true);
    expect(ok.selected).toHaveLength(10);

    const nine = rbEligible
      .slice(0, 9)
      .map((row, index) => `${index + 1}. ${row.name}`)
      .join("\n");
    expect(
      extractTopNFromPastedText({
        text: nine,
        eligible: rbEligible,
        rankingDepth: 10,
      }).ready,
    ).toBe(false);
  });
});
