import type { Prisma } from "@/lib/generated/prisma/client";
import { loadVerifiedWaiverArtifact } from "@/lib/waivers/artifacts/queries";
import type { VerifiedSngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { loadWaiverCanonicalPreflightSnapshot } from "@/lib/waivers/canonical/preflight";
import type { PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";
import { RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION } from "@/lib/waivers/canonical/team-crosswalk";
import type { WaiverDb } from "@/lib/waivers/clock";
import { WAIVER_EYEQ_V1, WAIVER_MAX_CALLS, WAIVER_POSITIONS, WAIVER_RESULT_FIELD_SIZE, type WaiverPosition } from "@/lib/waivers/constants";
import type { WaiverGradingBoardInput } from "@/lib/waivers/grading/board-grade";
import { buildWaiverContestResult, type WaiverContestResultBuild } from "@/lib/waivers/grading/contest-result";
import type { WaiverGradingAdvisory, WaiverGradingIssue } from "@/lib/waivers/grading/model";
import { assembleWaiverWeekGrading, type WaiverWeekGradingPreview, type WaiverWeekPositionInput } from "@/lib/waivers/grading/week";
import * as fingerprints from "@/lib/waivers/results/fingerprints";

/**
 * Read-only week grading dry run (SELECT only): loads the stored ACCEPTED
 * artifact (re-verified, never fetched), every contest's pinned frozen
 * snapshot, locked boards and current D3 resolutions, and evaluates the pure
 * engine. It stores, approves and applies nothing.
 */

export type WaiverWeekGradingPreviewInput = { weekId: string; artifactRowId: string };

export const ENTRY_SELECT = {
  id: true,
  rankableEntryId: true,
  position: true,
  evidenceRole: true,
  eligibility: true,
  displayNameAtFreeze: true,
  teamAtFreeze: true,
  isByeAtFreeze: true,
  identityProviderAtFreeze: true,
  identityExternalIdAtFreeze: true,
  rankableEntry: { select: { provider: true, externalId: true, team: true, active: true, adminNotes: true, name: true } },
} satisfies Prisma.WaiverSnapshotEntrySelect;

export function toPreflightEntry(entry: Prisma.WaiverSnapshotEntryGetPayload<{ select: typeof ENTRY_SELECT }>): PreflightSnapshotEntry {
  return {
    snapshotEntryId: entry.id,
    rankableEntryId: entry.rankableEntryId,
    position: entry.position,
    evidenceRole: entry.evidenceRole,
    eligibility: entry.eligibility,
    displayNameAtFreeze: entry.displayNameAtFreeze,
    teamAtFreeze: entry.teamAtFreeze,
    isByeAtFreeze: entry.isByeAtFreeze,
    frozenIdentity:
      entry.identityProviderAtFreeze !== null && entry.identityExternalIdAtFreeze !== null
        ? { provider: entry.identityProviderAtFreeze, externalId: entry.identityExternalIdAtFreeze }
        : null,
    rankable: entry.rankableEntry,
  };
}

export async function loadWaiverWeekGradingPreview(db: WaiverDb, input: WaiverWeekGradingPreviewInput): Promise<WaiverWeekGradingPreview> {
  const issues: WaiverGradingIssue[] = [];
  const advisories: WaiverGradingAdvisory[] = [];
  const week = await db.week.findUniqueOrThrow({ where: { id: input.weekId }, select: { id: true, weekNumber: true, season: { select: { year: true } } } });
  const weekRef = { id: week.id, season: week.season.year, weekNumber: week.weekNumber };
  const artifactRow = await db.waiverCanonicalArtifact.findUnique({
    where: { id: input.artifactRowId },
    select: {
      id: true,
      weekId: true,
      artifactId: true,
      seriesKey: true,
      revision: true,
      contentChecksum: true,
      defCrosswalkVersion: true,
      events: { orderBy: { sequence: "desc" }, take: 1, select: { state: true } },
    },
  });
  const blockedWeek = (artifact: WaiverWeekGradingPreview["artifact"]) =>
    assembleWaiverWeekGrading({
      week: weekRef,
      artifact,
      positions: WAIVER_POSITIONS.map((position) => ({ position, kind: "BLOCKED" as const })),
      issues,
      advisories,
    });
  if (!artifactRow) {
    issues.push({ code: "ARTIFACT_NOT_FOUND", detail: `no imported artifact ${input.artifactRowId}` });
    return blockedWeek({ rowId: input.artifactRowId, artifactId: "", seriesKey: "", revision: 0, contentChecksum: "" });
  }
  const artifact = {
    rowId: artifactRow.id,
    artifactId: artifactRow.artifactId,
    seriesKey: artifactRow.seriesKey,
    revision: artifactRow.revision,
    contentChecksum: artifactRow.contentChecksum,
  };

  // D5: only the week's latest, ACCEPTED, intact revision is gradable.
  if (artifactRow.weekId !== week.id) issues.push({ code: "ARTIFACT_WEEK_MISMATCH", detail: "the artifact belongs to another week" });
  const state = artifactRow.events[0]?.state ?? null;
  if (state !== "ACCEPTED") issues.push({ code: "ARTIFACT_NOT_ACCEPTED", detail: `artifact publication state is ${state ?? "unknown"}` });
  const newer = await db.waiverCanonicalArtifact.count({ where: { weekId: week.id, seriesKey: artifactRow.seriesKey, revision: { gt: artifactRow.revision } } });
  if (newer > 0) issues.push({ code: "ARTIFACT_NOT_LATEST", detail: `${newer} later revision(s) of the series are imported` });
  if (artifactRow.defCrosswalkVersion !== RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION) {
    issues.push({ code: "DEF_CROSSWALK_VERSION_MISMATCH", detail: `artifact imported under ${artifactRow.defCrosswalkVersion}` });
  }
  const loaded = await loadVerifiedWaiverArtifact(db, artifactRow.id);
  let verified: VerifiedSngCanonicalArtifact | null = null;
  if (!loaded) issues.push({ code: "ARTIFACT_CONTENT_INVALID", detail: "artifact content is missing" });
  else if (!loaded.ok) issues.push({ code: "ARTIFACT_CONTENT_INVALID", detail: loaded.issueCodes.join(", ") });
  else verified = loaded.verified;
  if (!verified) return blockedWeek(artifact);
  const sngVerified: VerifiedSngCanonicalArtifact = verified;

  const positions = await loadWaiverWeekPositions(db, {
    weekRef,
    issues,
    advisories,
    crosswalkAdvisory: true,
    buildContest: async (load) => {
      const resolutions = await db.waiverConflictResolution.findMany({
        where: { contestId: load.contest.id, artifactRowId: artifact.rowId, supersededBy: null },
        orderBy: { conflictKey: "asc" },
        select: { id: true, conflictKey: true, sequence: true, conflictKind: true, resolution: true, snapshotEntryId: true, sngParticipantId: true },
      });
      return buildWaiverContestResult({
        position: load.position,
        contest: { id: load.contest.id, weekId: load.contest.weekId, snapshotId: load.contest.snapshotId, maxCalls: load.contest.maxCalls, resultFieldSize: load.contest.resultFieldSize },
        snapshot: load.snapshot,
        artifact,
        verified: sngVerified,
        calledEntries: load.calledEntries,
        resolutions,
      });
    },
  });

  const preview = assembleWaiverWeekGrading({ week: weekRef, artifact, positions, issues, advisories });
  for (const p of preview.positions) {
    if (p.kind !== "CONTEST_RESULT") continue;
    const stored = await db.waiverContestResult.findUnique({ where: { contestId_inputFingerprint: { contestId: p.contestId, inputFingerprint: p.result.inputFingerprint } }, select: { id: true, resultFingerprint: true } });
    if (stored) {
      preview.advisories.push({
        code: "CONTEST_RESULT_ALREADY_STORED",
        detail: `stored contest result ${stored.id} has these inputs${stored.resultFingerprint === p.result.resultFingerprint ? " and the same result" : " but a DIFFERENT result"}`,
        position: p.position,
      });
    }
  }
  if (preview.run) {
    const stored = await db.waiverGradeRun.findUnique({ where: { weekId_inputFingerprint: { weekId: week.id, inputFingerprint: preview.run.inputFingerprint } }, select: { id: true, outputFingerprint: true } });
    if (stored) {
      preview.advisories.push({
        code: "GRADE_RUN_ALREADY_STORED",
        detail: `stored grade run ${stored.id} has these inputs${stored.outputFingerprint === preview.run.outputFingerprint ? " and the same output" : " but a DIFFERENT output"}`,
      });
    }
  }
  return preview;
}

export type WaiverContestRow = { id: string; weekId: string; snapshotId: string; status: string; maxCalls: number; resultFieldSize: number; scoringVersion: string; position: string };

/** Everything a source-specific contest builder needs: the pinned snapshot, the called entries and the locked boards. */
export type WaiverContestLoad = {
  position: WaiverPosition;
  contest: WaiverContestRow;
  snapshot: { season: number; weekNumber: number; version: number; entriesFingerprint: string; entries: readonly PreflightSnapshotEntry[] };
  calledEntries: PreflightSnapshotEntry[];
  boards: WaiverGradingBoardInput[];
};

/**
 * The week's five positions (SELECT only), shared by every grading source: a
 * contest position (the source-specific `buildContest` over the loaded
 * snapshot, called entries and locked boards), an explicit empty position, or
 * a blocked one. Source-independent checks (contest status and rules, pinned
 * snapshot, lock stamps) are made here, once.
 */
export async function loadWaiverWeekPositions(
  db: WaiverDb,
  ctx: {
    weekRef: { id: string; season: number; weekNumber: number };
    issues: WaiverGradingIssue[];
    advisories: WaiverGradingAdvisory[];
    /** SNG DEF matching uses the source-derived team crosswalk; approval must acknowledge it. */
    crosswalkAdvisory: boolean;
    buildContest: (load: WaiverContestLoad) => Promise<WaiverContestResultBuild> | WaiverContestResultBuild;
  },
): Promise<WaiverWeekPositionInput[]> {
  const { weekRef, issues, advisories } = ctx;
  const currentSnapshot = await db.waiverSnapshot.findFirst({
    where: { currentForWeekId: weekRef.id, status: "FROZEN" },
    select: { id: true, version: true, entriesFingerprint: true, entries: { where: { evidenceRole: "CANDIDATE", eligibility: "ELIGIBLE" }, select: { position: true } } },
  });
  const contests = await db.waiverContest.findMany({ where: { weekId: weekRef.id } });
  if (ctx.crosswalkAdvisory && contests.some((c) => c.position === "DEF")) {
    advisories.push({ code: "TEAM_CROSSWALK_PENDING_PRODUCER_CONFIRMATION", detail: "DEF matching uses the source-derived SNG team crosswalk; approval must acknowledge it" });
  }

  const positions: WaiverWeekPositionInput[] = [];
  for (const position of WAIVER_POSITIONS) {
    const contest = contests.find((c) => c.position === position);
    if (!contest) {
      if (!currentSnapshot) {
        issues.push({ code: "CURRENT_SNAPSHOT_MISSING", detail: "the week has no current frozen snapshot", position });
        positions.push({ position, kind: "BLOCKED" });
      } else if (currentSnapshot.entries.some((e) => e.position === position)) {
        issues.push({ code: "CONTEST_MISSING", detail: `${position} has eligible candidates but no contest`, position });
        positions.push({ position, kind: "BLOCKED" });
      } else {
        positions.push({
          position,
          kind: "EMPTY",
          snapshotId: currentSnapshot.id,
          snapshotFingerprint: fingerprints.snapshotIdentityFingerprint({
            season: weekRef.season,
            weekNumber: weekRef.weekNumber,
            version: currentSnapshot.version,
            entriesFingerprint: currentSnapshot.entriesFingerprint,
          }),
        });
      }
      continue;
    }
    positions.push(await loadContestPosition(db, { position, contest, currentSnapshotId: currentSnapshot?.id ?? null, issues, advisories, buildContest: ctx.buildContest }));
  }
  return positions;
}

async function loadContestPosition(
  db: WaiverDb,
  ctx: {
    position: WaiverPosition;
    contest: WaiverContestRow;
    currentSnapshotId: string | null;
    issues: WaiverGradingIssue[];
    advisories: WaiverGradingAdvisory[];
    buildContest: (load: WaiverContestLoad) => Promise<WaiverContestResultBuild> | WaiverContestResultBuild;
  },
): Promise<WaiverWeekPositionInput> {
  const { position, contest } = ctx;
  let blocked = false;
  const block = (code: WaiverGradingIssue["code"], detail: string) => {
    ctx.issues.push({ code, detail, position });
    blocked = true;
  };
  if (contest.status !== "LOCKED") block("CONTEST_NOT_LOCKED", `${position} contest is ${contest.status}`);
  if (contest.scoringVersion !== WAIVER_EYEQ_V1.slug || contest.maxCalls !== WAIVER_MAX_CALLS[position] || contest.resultFieldSize !== WAIVER_RESULT_FIELD_SIZE[position]) {
    block("CONTEST_RULES_MISMATCH", `${position} contest rules are not ${WAIVER_EYEQ_V1.slug} with ${WAIVER_MAX_CALLS[position]} calls`);
  }
  if (ctx.currentSnapshotId !== null && contest.snapshotId !== ctx.currentSnapshotId) {
    ctx.advisories.push({ code: "CONTEST_SNAPSHOT_NOT_CURRENT", detail: `${position} is pinned to snapshot ${contest.snapshotId}, not the week's current snapshot`, position });
  }

  const submissions = await db.waiverSubmission.findMany({
    where: { contestId: contest.id },
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      authority: true,
      universalProfileId: true,
      universalProfile: { select: { profileType: true, competitorActive: true } },
      lockedRevision: {
        select: {
          id: true,
          kind: true,
          callCount: true,
          fingerprint: true,
          lateEntry: { select: { id: true } },
          competitiveOverride: { select: { id: true } },
          calls: { orderBy: { slot: "asc" }, select: { id: true, slot: true, snapshotEntryId: true, snapshotEntry: { select: ENTRY_SELECT } } },
        },
      },
    },
  });
  const unstamped = submissions.filter((s) => s.status === "SUBMITTED").length;
  if (unstamped > 0) block("SUBMISSION_NOT_LOCK_STAMPED", `${unstamped} submitted ${position} board(s) lack their lock stamp`);
  if (blocked) return { position, kind: "BLOCKED" };

  const pinned = await loadWaiverCanonicalPreflightSnapshot(db, contest.snapshotId);
  const snapshotRow = await db.waiverSnapshot.findUniqueOrThrow({ where: { id: contest.snapshotId }, select: { version: true, entriesFingerprint: true } });

  const locked = submissions.filter((s) => s.lockedRevision !== null);
  const boards: WaiverGradingBoardInput[] = locked.map((s) => {
    const revision = s.lockedRevision!;
    return {
      submissionId: s.id,
      revisionId: revision.id,
      revisionFingerprint: revision.fingerprint,
      revisionKind: revision.kind,
      revisionCallCount: revision.callCount,
      competitor: {
        universalProfileId: s.universalProfileId,
        profileType: s.universalProfile.profileType,
        competitorActive: s.universalProfile.competitorActive,
        authority: s.authority,
        entryBasis: revision.competitiveOverride ? "ADMIN_COMPETITIVE_OVERRIDE" : revision.lateEntry ? "AI_LATE_ENTRY" : "STANDARD",
      },
      calls: revision.calls.map((call) => ({ callId: call.id, slot: call.slot, snapshotEntryId: call.snapshotEntryId, rankableEntryId: call.snapshotEntry.rankableEntryId })),
    };
  });
  const build = await ctx.buildContest({
    position,
    contest,
    snapshot: { season: pinned.seasonYear, weekNumber: pinned.weekNumber, version: snapshotRow.version, entriesFingerprint: snapshotRow.entriesFingerprint, entries: pinned.entries },
    calledEntries: locked.flatMap((s) => s.lockedRevision!.calls.map((call) => toPreflightEntry(call.snapshotEntry))),
    boards,
  });
  return { position, kind: "CONTEST", contestId: contest.id, build, boards };
}
