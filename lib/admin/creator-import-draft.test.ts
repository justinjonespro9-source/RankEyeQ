import { describe, expect, it } from "vitest";
import {
  clearCreatorImportDraft,
  emptyCreatorImportDraft,
  parseCreatorImportDraft,
  readCreatorImportDraft,
  readCreatorImportDraftRaw,
  serializeCreatorImportDraft,
  shouldClearCreatorImportDraft,
  writeCreatorImportDraft,
} from "@/lib/admin/creator-import-draft";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    _store: store,
  };
}

/**
 * Simulates React useSyncExternalStore's Object.is check between consecutive
 * getSnapshot calls when the store has not notified.
 */
function wouldExceedUpdateDepth(getSnapshot: () => unknown, iterations = 50) {
  let prev = getSnapshot();
  for (let i = 0; i < iterations; i += 1) {
    const next = getSnapshot();
    if (!Object.is(prev, next)) return true;
    prev = next;
  }
  return false;
}

describe("creator import draft — React #185 safety", () => {
  it("buggy object getSnapshot is unstable (documents #185 cause)", () => {
    const storage = memoryStorage();
    const draft = emptyCreatorImportDraft({
      raw: "1. Puka Nacua",
      sourceUrl: "https://example.com/wr",
      ready: true,
      rows: [],
    });
    writeCreatorImportDraft(storage, "prof", "contest", draft);

    const buggyGetSnapshot = () =>
      readCreatorImportDraft(storage, "prof", "contest");

    expect(wouldExceedUpdateDepth(buggyGetSnapshot)).toBe(true);
  });

  it("raw string getSnapshot is Object.is-stable when unchanged", () => {
    const storage = memoryStorage();
    const draft = emptyCreatorImportDraft({
      raw: "1. Puka Nacua\n2. Amon-Ra St. Brown",
      sourceUrl: "https://example.com/wr",
      capturedAt: "",
      ready: false,
      rows: null,
    });
    writeCreatorImportDraft(storage, "prof", "wr-contest", draft);

    const getSnapshot = () =>
      readCreatorImportDraftRaw(storage, "prof", "wr-contest");

    expect(wouldExceedUpdateDepth(getSnapshot)).toBe(false);
    expect(getSnapshot()).toBe(serializeCreatorImportDraft(draft));
  });

  it("null raw snapshot stays stable for empty boards", () => {
    const storage = memoryStorage();
    const getSnapshot = () =>
      readCreatorImportDraftRaw(storage, "new-creator", "wr");
    expect(getSnapshot()).toBeNull();
    expect(wouldExceedUpdateDepth(getSnapshot)).toBe(false);
  });

  it("write is a no-op when serialized content is unchanged", () => {
    const storage = memoryStorage();
    const draft = emptyCreatorImportDraft({ raw: "abc", sourceUrl: "https://x" });
    expect(writeCreatorImportDraft(storage, "p", "c", draft)).toBe(true);
    expect(writeCreatorImportDraft(storage, "p", "c", draft)).toBe(false);
  });

  it("parse + empty fallback preserves draft after simulated failed submit", () => {
    const storage = memoryStorage();
    const draft = emptyCreatorImportDraft({
      raw: "1..15 WRs",
      sourceUrl: "https://x.com/creator",
      sourcePublishedAt: "2026-09-07T10:00",
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
    });
    writeCreatorImportDraft(storage, "p", "c", draft);

    const failed = { ok: false as const, error: "simulated" };
    if (shouldClearCreatorImportDraft(failed)) {
      clearCreatorImportDraft(storage, "p", "c");
    }

    const raw = readCreatorImportDraftRaw(storage, "p", "c");
    const restored = parseCreatorImportDraft(raw);
    expect(restored?.raw).toBe(draft.raw);
    expect(restored?.sourceUrl).toBe(draft.sourceUrl);
    expect(restored?.ready).toBe(true);
    expect(wouldExceedUpdateDepth(() => readCreatorImportDraftRaw(storage, "p", "c"))).toBe(
      false,
    );
  });

  it("Reset clears then writes empty baseline without churn", () => {
    const storage = memoryStorage();
    writeCreatorImportDraft(
      storage,
      "p",
      "c",
      emptyCreatorImportDraft({ raw: "paste" }),
    );
    expect(clearCreatorImportDraft(storage, "p", "c")).toBe(true);
    const empty = emptyCreatorImportDraft({ sourceUrl: "", capturedAt: "" });
    expect(writeCreatorImportDraft(storage, "p", "c", empty)).toBe(true);
    expect(writeCreatorImportDraft(storage, "p", "c", empty)).toBe(false);
    expect(
      wouldExceedUpdateDepth(() => readCreatorImportDraftRaw(storage, "p", "c")),
    ).toBe(false);
  });
});
