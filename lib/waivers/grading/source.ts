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
 * Preview only: storing a run (and so approving, applying, publishing) is
 * refused by the lifecycle with `SOURCE_UNSUPPORTED` until dual-source storage
 * lands, because `WaiverContestResult` / `WaiverGradeRun` reference
 * `WaiverCanonicalArtifact` only (docs/waivers-rankeyeq-results-source.md).
 */
export async function loadWaiverWeekGradingPreviewFromRankEyeQ(
  db: WaiverDb,
  input: { weekId: string; snapshotId: string | null },
): Promise<WaiverWeekGradingPreview> {
  return loadWaiverWeekGradingPreviewFromRankEyeQSource(db, input);
}

/** True when the RankEyeQ source returns a real READY / BLOCKED preview (storing from it is separate: see `isWaiverGradingSourceStorable`). */
export function isWaiverRankEyeQResultsAvailable(): boolean {
  return true;
}

/** Whether a run can be stored from the source. RankEyeQ is preview-only until its snapshot can be referenced by the grading tables. */
export function isWaiverGradingSourceStorable(source: WaiverGradingSource): boolean {
  return source.kind === "SNG_ARTIFACT";
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
