import type { WaiverDb } from "@/lib/waivers/clock";
import { WAIVER_POSITIONS } from "@/lib/waivers/constants";
import { buildWaiverContestResultFromRankEyeQ, rankEyeQGradingArtifact } from "@/lib/waivers/grading/contest-result-rankeyeq";
import type { WaiverGradingAdvisory, WaiverGradingIssue } from "@/lib/waivers/grading/model";
import { loadWaiverWeekPositions } from "@/lib/waivers/grading/preview";
import { assembleWaiverWeekGrading, type WaiverWeekGradingPreview } from "@/lib/waivers/grading/week";
import { loadVerifiedRankEyeQResultsSource } from "@/lib/waivers/rankeyeq-results/store";

/**
 * Read-only week grading dry run from the RankEyeQ final-week-stats source
 * (SELECT only). It mirrors `loadWaiverWeekGradingPreview`: the week's current
 * ACCEPTED RankEyeQ snapshot is reloaded, re-verified against its stored
 * checksum and projected, then every contest's pinned frozen snapshot and
 * locked boards go through the same pure engine (`assembleWaiverWeekGrading`,
 * WAIVER_EYEQ_V1 untouched) with the RankEyeQ contest builder.
 *
 * The snapshot's provenance is the grading `artifact`: `rowId` is the
 * `WaiverRankEyeQResultsSnapshot` id, which is NOT a `WaiverCanonicalArtifact`
 * id. The preview is exact and fingerprinted, but storing it
 * (`WaiverContestResult.artifactRowId` and friends) needs the dual-source
 * migration, so the lifecycle refuses RankEyeQ stores explicitly.
 */

export type WaiverWeekGradingPreviewFromRankEyeQInput = {
  weekId: string;
  /** Pin a specific snapshot row; null means the week's current ACCEPTED snapshot. */
  snapshotId: string | null;
};

export async function loadWaiverWeekGradingPreviewFromRankEyeQSource(db: WaiverDb, input: WaiverWeekGradingPreviewFromRankEyeQInput): Promise<WaiverWeekGradingPreview> {
  const issues: WaiverGradingIssue[] = [];
  const advisories: WaiverGradingAdvisory[] = [];
  const week = await db.week.findUniqueOrThrow({ where: { id: input.weekId }, select: { id: true, weekNumber: true, season: { select: { year: true } } } });
  const weekRef = { id: week.id, season: week.season.year, weekNumber: week.weekNumber };
  const blockedWeek = (artifact: WaiverWeekGradingPreview["artifact"]) =>
    assembleWaiverWeekGrading({
      week: weekRef,
      artifact,
      positions: WAIVER_POSITIONS.map((position) => ({ position, kind: "BLOCKED" as const })),
      issues,
      advisories,
    });

  const loaded = await loadVerifiedRankEyeQResultsSource(db, week.id);
  if (!loaded.ok) {
    if (loaded.code === "NO_ACCEPTED_SNAPSHOT") {
      issues.push({ code: "ARTIFACT_NOT_FOUND", detail: "the week has no ACCEPTED RankEyeQ results snapshot; build and accept one first" });
    } else {
      issues.push({ code: "ARTIFACT_CONTENT_INVALID", detail: `the RankEyeQ results snapshot failed verification: ${loaded.issues.map((i) => i.code).join(", ")}` });
    }
    return blockedWeek({ rowId: input.snapshotId ?? "", artifactId: "", seriesKey: "", revision: 0, contentChecksum: "" });
  }
  const { source } = loaded;
  const artifact = rankEyeQGradingArtifact(source);

  // Only the week's latest ACCEPTED, intact snapshot is gradable.
  if (input.snapshotId !== null && input.snapshotId !== source.provenance.snapshotRowId) {
    issues.push({
      code: "ARTIFACT_NOT_LATEST",
      detail: `RankEyeQ snapshot ${input.snapshotId} is not the week's current ACCEPTED snapshot (${source.provenance.snapshotRowId})`,
    });
  }
  if (source.week.id !== week.id) issues.push({ code: "SOURCE_WEEK_MISMATCH", detail: `the RankEyeQ snapshot is for week ${source.week.id}` });
  if (issues.length > 0) return blockedWeek(artifact);

  const positions = await loadWaiverWeekPositions(db, {
    weekRef,
    issues,
    advisories,
    // RankEyeQ identity is def-{TEAM}: there is no SNG team crosswalk to acknowledge.
    crosswalkAdvisory: false,
    buildContest: (load) =>
      buildWaiverContestResultFromRankEyeQ({
        position: load.position,
        contest: { id: load.contest.id, weekId: load.contest.weekId, snapshotId: load.contest.snapshotId, maxCalls: load.contest.maxCalls, resultFieldSize: load.contest.resultFieldSize },
        snapshot: load.snapshot,
        artifact,
        source,
        calledEntries: load.calledEntries,
      }),
  });
  return assembleWaiverWeekGrading({ week: weekRef, artifact, positions, issues, advisories });
}
