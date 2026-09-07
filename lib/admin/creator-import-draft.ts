import type { SourceExtractRow } from "@/lib/benchmarks/parser";
import type { BenchmarkCaptureType } from "@/lib/generated/prisma/client";

/** Client-side draft so remount / Retry does not wipe a validated Creator paste. */
export type CreatorImportDraft = {
  raw: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  capturedAt: string;
  notes: string;
  captureType: BenchmarkCaptureType;
  publicBoardAllowed: boolean;
  correctionReason: string;
  rows: SourceExtractRow[] | null;
  blocking: string[];
  ready: boolean;
  tierNote: string | null;
};

export function creatorImportDraftStorageKey(
  profileId: string,
  contestId: string,
) {
  return `rankiq:creator-import:${profileId}:${contestId}`;
}

/** Clear draft only after an official board lock (or explicit Reset). */
export function shouldClearCreatorImportDraft(result: {
  ok: boolean;
  official?: boolean;
}) {
  return result.ok === true && result.official === true;
}

export function emptyCreatorImportDraft(
  defaults: Partial<CreatorImportDraft> = {},
): CreatorImportDraft {
  return {
    raw: "",
    sourceUrl: "",
    sourcePublishedAt: "",
    capturedAt: "",
    notes: "",
    captureType: "SUNDAY",
    publicBoardAllowed: true,
    correctionReason: "",
    rows: null,
    blocking: [],
    ready: false,
    tierNote: null,
    ...defaults,
  };
}

export function serializeCreatorImportDraft(draft: CreatorImportDraft): string {
  return JSON.stringify(draft);
}

export function parseCreatorImportDraft(
  raw: string | null | undefined,
): CreatorImportDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CreatorImportDraft;
    if (typeof parsed?.raw !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Stable primitive snapshot for useSyncExternalStore.
 * MUST return the same string reference semantics (Object.is) when unchanged —
 * never return a freshly parsed object from getSnapshot (React #185).
 */
export function readCreatorImportDraftRaw(
  storage: Pick<Storage, "getItem"> | null | undefined,
  profileId: string,
  contestId: string,
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(creatorImportDraftStorageKey(profileId, contestId));
  } catch {
    return null;
  }
}

export function readCreatorImportDraft(
  storage: Pick<Storage, "getItem"> | null | undefined,
  profileId: string,
  contestId: string,
): CreatorImportDraft | null {
  return parseCreatorImportDraft(
    readCreatorImportDraftRaw(storage, profileId, contestId),
  );
}

/** @returns true when storage content changed */
export function writeCreatorImportDraft(
  storage: Pick<Storage, "setItem" | "getItem"> | null | undefined,
  profileId: string,
  contestId: string,
  draft: CreatorImportDraft,
): boolean {
  if (!storage) return false;
  try {
    const key = creatorImportDraftStorageKey(profileId, contestId);
    const serialized = serializeCreatorImportDraft(draft);
    if (storage.getItem(key) === serialized) return false;
    storage.setItem(key, serialized);
    return true;
  } catch {
    // Quota / private mode — ignore; caller may still keep in-memory state.
    return false;
  }
}

export function clearCreatorImportDraft(
  storage: Pick<Storage, "removeItem" | "getItem"> | null | undefined,
  profileId: string,
  contestId: string,
): boolean {
  if (!storage) return false;
  try {
    const key = creatorImportDraftStorageKey(profileId, contestId);
    if (storage.getItem(key) == null) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
