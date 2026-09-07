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

export function readCreatorImportDraft(
  storage: Pick<Storage, "getItem"> | null | undefined,
  profileId: string,
  contestId: string,
): CreatorImportDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(
      creatorImportDraftStorageKey(profileId, contestId),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CreatorImportDraft;
    if (typeof parsed?.raw !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCreatorImportDraft(
  storage: Pick<Storage, "setItem"> | null | undefined,
  profileId: string,
  contestId: string,
  draft: CreatorImportDraft,
) {
  if (!storage) return;
  try {
    storage.setItem(
      creatorImportDraftStorageKey(profileId, contestId),
      JSON.stringify(draft),
    );
  } catch {
    // Quota / private mode — ignore; in-memory state still preserved for the session.
  }
}

export function clearCreatorImportDraft(
  storage: Pick<Storage, "removeItem"> | null | undefined,
  profileId: string,
  contestId: string,
) {
  if (!storage) return;
  try {
    storage.removeItem(creatorImportDraftStorageKey(profileId, contestId));
  } catch {
    // ignore
  }
}
