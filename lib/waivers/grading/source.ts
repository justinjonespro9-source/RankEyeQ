import type { WaiverDb } from "@/lib/waivers/clock";
import { loadWaiverWeekGradingPreview } from "@/lib/waivers/grading/preview";
import { loadWaiverWeekGradingPreviewFromRankEyeQSource } from "@/lib/waivers/grading/preview-rankeyeq";
import type { WaiverWeekGradingPreview } from "@/lib/waivers/grading/week";

/**
 * Where a week's factual results come from. Both sources are evaluated by the
 * same pure grading engine and must yield the same `WaiverWeekGradingPreview`
 * shape, so storing, approving, applying and publishing are source-agnostic.
 * Everything here is SELECT-only.
 */
export type WaiverGradingSource =
  | { kind: "SNG_ARTIFACT"; artifactRowId: string }
  /** RankEyeQ-computed stat-component results (see `loadWaiverWeekGradingPreviewFromRankEyeQ`). */
  | { kind: "RANKEYEQ_SNAPSHOT"; snapshotId: string | null };

export type WaiverGradingSourceKind = WaiverGradingSource["kind"];

/**
 * RankEyeQ final-week-stats source (`lib/waivers/rankeyeq-results`). SELECT only.
 *
 * The week's current ACCEPTED snapshot is reloaded, re-verified against its
 * stored checksum and projected, then graded by the same pure engine as the SNG
 * source (`preview-rankeyeq.ts`; WAIVER_EYEQ_V1 untouched). The result is a real
 * READY or BLOCKED `WaiverWeekGradingPreview`; it never falls back to SNG and
 * never invents results.
 *
 * Dual-source storage: a stored run references exactly one verified source,
 * either `WaiverCanonicalArtifact` (SNG) or `WaiverRankEyeQResultsSnapshot`, so
 * storing, approving, applying and publishing work for both
 * (docs/waivers-rankeyeq-results-source.md).
 */
export async function loadWaiverWeekGradingPreviewFromRankEyeQ(
  db: WaiverDb,
  input: { weekId: string; snapshotId: string | null },
): Promise<WaiverWeekGradingPreview> {
  return loadWaiverWeekGradingPreviewFromRankEyeQSource(db, input);
}

/** True when the RankEyeQ source returns a real READY / BLOCKED preview. */
export function isWaiverRankEyeQResultsAvailable(): boolean {
  return true;
}

/** Whether a run can be stored from the source: both verified sources are (dual-source storage). */
export function isWaiverGradingSourceStorable(source: WaiverGradingSource): boolean {
  return source.kind === "SNG_ARTIFACT" || source.kind === "RANKEYEQ_SNAPSHOT";
}

/** The stored foreign keys of a run's source: exactly one is non-null (the database enforces the XOR). */
export type WaiverStoredSourceRef = { artifactRowId: string | null; rankEyeQSnapshotId: string | null };

/** Maps a loaded preview's source row id (`preview.artifact.rowId`) to the stored FK pair for the source kind. */
export function waiverStoredSourceRef(kind: WaiverGradingSource["kind"], rowId: string): WaiverStoredSourceRef {
  return kind === "SNG_ARTIFACT" ? { artifactRowId: rowId, rankEyeQSnapshotId: null } : { artifactRowId: null, rankEyeQSnapshotId: rowId };
}

/** The grading source a stored run (or approval) was created from, pinned to its exact source row. */
export function waiverGradingSourceOfStored(ref: WaiverStoredSourceRef): WaiverGradingSource {
  if (ref.rankEyeQSnapshotId !== null && ref.artifactRowId === null) return { kind: "RANKEYEQ_SNAPSHOT", snapshotId: ref.rankEyeQSnapshotId };
  if (ref.artifactRowId !== null && ref.rankEyeQSnapshotId === null) return { kind: "SNG_ARTIFACT", artifactRowId: ref.artifactRowId };
  throw new RangeError("a stored grade run must reference exactly one source");
}

/** The week's grading preview from the chosen source (SELECT only). */
export async function loadWaiverWeekGradingPreviewFromSource(
  db: WaiverDb,
  input: { weekId: string; source: WaiverGradingSource },
): Promise<WaiverWeekGradingPreview> {
  if (input.source.kind === "SNG_ARTIFACT") {
    return loadWaiverWeekGradingPreview(db, { weekId: input.weekId, artifactRowId: input.source.artifactRowId });
  }
  return loadWaiverWeekGradingPreviewFromRankEyeQ(db, { weekId: input.weekId, snapshotId: input.source.snapshotId });
}
