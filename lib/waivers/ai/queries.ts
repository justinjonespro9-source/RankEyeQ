import { prisma } from "@/lib/db";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { parseWaiverAiResponse, type WaiverAiParseResult } from "@/lib/waivers/ai/response-parser";
import { readWaiverClock } from "@/lib/waivers/clock";
import { WAIVER_POSITIONS, waiverSlotLabel, type WaiverPosition, type WaiverSlotLabel } from "@/lib/waivers/constants";
import { waiverPhaseAt, type WaiverPhase } from "@/lib/waivers/lock-time";

/**
 * Read-only admin views for AI Waiver boards and historical evidence. Never
 * writes, never stamps locks: a SUBMITTED board past locksAt is shown as
 * LOCKED because no revision can be added after the lock.
 */

export type WaiverAiBoardStatus = "MISSING" | "DRAFT" | "SUBMITTED" | "LOCKED" | "EVIDENCE_ONLY";

export function waiverAiBoardStatus(input: {
  submissionStatus: "DRAFT" | "SUBMITTED" | "LOCKED" | null;
  phase: WaiverPhase;
  evidenceCount: number;
}): WaiverAiBoardStatus {
  if (input.submissionStatus === "LOCKED") return "LOCKED";
  if (input.submissionStatus === "SUBMITTED") return input.phase === "LOCKED" ? "LOCKED" : "SUBMITTED";
  if (input.submissionStatus === "DRAFT") return "DRAFT";
  return input.evidenceCount > 0 ? "EVIDENCE_ONLY" : "MISSING";
}

export type WaiverAiAdminWeek = { id: string; label: string; seasonYear: number; weekNumber: number; isTest: boolean; contestCount: number };

/** Weeks that have Waiver contests, newest first. */
export async function loadWaiverAiAdminWeeks(): Promise<WaiverAiAdminWeek[]> {
  const weeks = await prisma.week.findMany({
    where: { waiverContests: { some: {} } },
    orderBy: [{ season: { year: "desc" } }, { weekNumber: "desc" }],
    select: { id: true, label: true, weekNumber: true, isTest: true, season: { select: { year: true } }, _count: { select: { waiverContests: true } } },
  });
  return weeks.map((week) => ({
    id: week.id,
    label: week.label,
    seasonYear: week.season.year,
    weekNumber: week.weekNumber,
    isTest: week.isTest,
    contestCount: week._count.waiverContests,
  }));
}

export type WaiverAiCoverageCell = {
  status: WaiverAiBoardStatus;
  revisionNumber: number | null;
  callCount: number | null;
  evidenceCount: number;
};

export type WaiverAiWeekView = {
  week: { id: string; label: string; seasonYear: number; weekNumber: number; isTest: boolean };
  now: Date;
  contests: Array<{
    contestId: string;
    position: WaiverPosition;
    locksAt: Date;
    phase: WaiverPhase;
    snapshot: { id: string; version: number; entriesFingerprint: string };
    poolSize: number;
    availableSlots: number;
    promptVersion: string;
    promptSha256: string;
    /** Copyable only while the contest is open. */
    promptText: string | null;
  }>;
  competitors: Array<{ id: string; username: string; displayName: string; active: boolean }>;
  cells: Record<string, Partial<Record<WaiverPosition, WaiverAiCoverageCell>>>;
  totals: { expected: number; submitted: number; locked: number; evidenceOnly: number; missing: number };
};

export async function loadWaiverAiWeekView(weekId: string): Promise<WaiverAiWeekView | null> {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: {
      id: true,
      label: true,
      weekNumber: true,
      isTest: true,
      season: { select: { year: true } },
      waiverContests: { select: { id: true, position: true }, orderBy: { position: "asc" } },
    },
  });
  if (!week) return null;
  const now = await readWaiverClock();
  const order = new Map<string, number>(WAIVER_POSITIONS.map((position, index) => [position, index]));
  const contestIds = week.waiverContests.map((contest) => contest.id);

  const contexts = [];
  for (const contest of [...week.waiverContests].sort((a, b) => (order.get(a.position) ?? 9) - (order.get(b.position) ?? 9))) {
    const context = await loadWaiverAiContestContext(prisma, contest.id);
    if (context) contexts.push(context);
  }

  const [active, boards, evidence] = await Promise.all([
    prisma.universalProfile.findMany({
      where: { profileType: "AI", status: "ACTIVE", competitorActive: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: { id: true, username: true, displayName: true },
    }),
    prisma.waiverSubmission.findMany({
      where: { contestId: { in: contestIds }, universalProfile: { profileType: "AI" } },
      select: {
        contestId: true,
        universalProfileId: true,
        status: true,
        currentRevision: { select: { revisionNumber: true, callCount: true } },
        universalProfile: { select: { id: true, username: true, displayName: true } },
      },
    }),
    prisma.waiverAiHistoricalEvidence.groupBy({
      by: ["contestId", "universalProfileId"],
      where: { contestId: { in: contestIds } },
      _count: { _all: true },
    }),
  ]);

  const competitors = new Map(active.map((profile) => [profile.id, { ...profile, active: true }]));
  for (const board of boards) {
    if (!competitors.has(board.universalProfileId)) competitors.set(board.universalProfileId, { ...board.universalProfile, active: false });
  }
  const evidenceProfileIds = evidence.map((row) => row.universalProfileId).filter((id) => !competitors.has(id));
  if (evidenceProfileIds.length > 0) {
    const inactive = await prisma.universalProfile.findMany({
      where: { id: { in: evidenceProfileIds } },
      select: { id: true, username: true, displayName: true },
    });
    for (const profile of inactive) competitors.set(profile.id, { ...profile, active: false });
  }

  const positionByContest = new Map(contexts.map((context) => [context.contest.id, context.contest.position]));
  const phaseByContest = new Map(contexts.map((context) => [context.contest.id, waiverPhaseAt(context.contest.locksAt, now)]));
  const boardByKey = new Map(boards.map((board) => [`${board.universalProfileId}:${board.contestId}`, board]));
  const evidenceByKey = new Map(evidence.map((row) => [`${row.universalProfileId}:${row.contestId}`, row._count._all]));

  const cells: WaiverAiWeekView["cells"] = {};
  const totals = { expected: 0, submitted: 0, locked: 0, evidenceOnly: 0, missing: 0 };
  for (const competitor of competitors.values()) {
    cells[competitor.id] = {};
    for (const context of contexts) {
      const key = `${competitor.id}:${context.contest.id}`;
      const board = boardByKey.get(key);
      const evidenceCount = evidenceByKey.get(key) ?? 0;
      const status = waiverAiBoardStatus({
        submissionStatus: board?.status ?? null,
        phase: phaseByContest.get(context.contest.id) ?? "OPEN",
        evidenceCount,
      });
      cells[competitor.id][positionByContest.get(context.contest.id)!] = {
        status,
        revisionNumber: board?.currentRevision?.revisionNumber ?? null,
        callCount: board?.currentRevision?.callCount ?? null,
        evidenceCount,
      };
      if (!competitor.active) continue;
      totals.expected += 1;
      if (status === "SUBMITTED") totals.submitted += 1;
      else if (status === "LOCKED") totals.locked += 1;
      else if (status === "EVIDENCE_ONLY") totals.evidenceOnly += 1;
      else totals.missing += 1;
    }
  }

  return {
    week: { id: week.id, label: week.label, seasonYear: week.season.year, weekNumber: week.weekNumber, isTest: week.isTest },
    now,
    contests: contexts.map((context) => {
      const phase = waiverPhaseAt(context.contest.locksAt, now);
      return {
        contestId: context.contest.id,
        position: context.contest.position,
        locksAt: context.contest.locksAt,
        phase,
        snapshot: { id: context.snapshot.id, version: context.snapshot.version, entriesFingerprint: context.snapshot.entriesFingerprint },
        poolSize: context.prompt.poolSize,
        availableSlots: context.prompt.availableSlots,
        promptVersion: context.prompt.version,
        promptSha256: context.prompt.sha256,
        promptText: phase === "OPEN" ? context.prompt.text : null,
      };
    }),
    competitors: [...competitors.values()].sort((a, b) => Number(b.active) - Number(a.active)),
    cells,
    totals,
  };
}

export type WaiverAiRevisionView = {
  revisionNumber: number;
  createdAt: Date;
  callCount: number;
  authorLabel: string;
  competitive: boolean;
  calls: Array<{ slot: number; label: WaiverSlotLabel; displayName: string; team: string | null }>;
  response: null | {
    modelLabel: string;
    promptVersion: string;
    promptSha256: string;
    parserVersion: string;
    responseText: string;
    responseSha256: string;
    responseByteLength: number;
    noCalls: boolean;
    importedAt: Date;
    statedGeneratedAt: Date | null;
    sourceReference: string | null;
    sourceNote: string | null;
  };
};

export type WaiverAiEvidenceView = {
  id: string;
  modelLabel: string;
  responseText: string;
  responseSha256: string;
  responseByteLength: number;
  statedSourceAt: Date | null;
  evidenceSource: string;
  evidenceReference: string;
  note: string | null;
  recordedAfterLock: boolean;
  recordedAt: Date;
  recordedByLabel: string;
  reviews: Array<{ sequence: number; status: string; note: string; reviewerLabel: string; reviewedAt: Date }>;
  /** Strict parse against the contest's pinned frozen snapshot (display only). */
  parse: WaiverAiParseResult;
};

export type WaiverAiBoardView = {
  now: Date;
  phase: WaiverPhase;
  profile: { id: string; username: string; displayName: string; profileType: string; canSubmit: boolean };
  contest: { id: string; weekId: string; position: WaiverPosition; locksAt: Date; maxCalls: number };
  week: { seasonYear: number; weekNumber: number; label: string; isTest: boolean };
  snapshot: { id: string; version: number; entriesFingerprint: string; frozenAt: Date };
  prompt: { version: string; sha256: string; text: string | null; availableSlots: number; poolSize: number };
  pool: Array<{ displayName: string; team: string | null }>;
  board: null | {
    submissionId: string;
    authority: string;
    status: WaiverAiBoardStatus;
    submittedAt: Date | null;
    lockedRevisionNumber: number | null;
    revisions: WaiverAiRevisionView[];
  };
  evidence: WaiverAiEvidenceView[];
};

function userLabel(user: { name: string | null; email: string | null }): string {
  return user.name ?? user.email ?? "admin";
}

export async function loadWaiverAiBoardView(profileId: string, contestId: string): Promise<WaiverAiBoardView | null> {
  const [profile, context] = await Promise.all([
    prisma.universalProfile.findUnique({
      where: { id: profileId },
      select: { id: true, username: true, displayName: true, profileType: true, status: true, competitorActive: true },
    }),
    loadWaiverAiContestContext(prisma, contestId),
  ]);
  if (!profile || profile.profileType !== "AI" || !context) return null;
  const now = await readWaiverClock();
  const phase = waiverPhaseAt(context.contest.locksAt, now);

  const [submission, evidence] = await Promise.all([
    prisma.waiverSubmission.findUnique({
      where: { contestId_universalProfileId: { contestId, universalProfileId: profileId } },
      select: {
        id: true,
        authority: true,
        status: true,
        submittedAt: true,
        lockedRevision: { select: { revisionNumber: true } },
        revisions: {
          orderBy: { revisionNumber: "desc" },
          select: {
            revisionNumber: true,
            kind: true,
            createdAt: true,
            callCount: true,
            author: { select: { name: true, email: true } },
            calls: {
              orderBy: { slot: "asc" },
              select: { slot: true, snapshotEntry: { select: { displayNameAtFreeze: true, teamAtFreeze: true } } },
            },
            aiResponse: {
              select: {
                modelLabel: true,
                promptVersion: true,
                promptSha256: true,
                parserVersion: true,
                responseText: true,
                responseSha256: true,
                responseByteLength: true,
                noCalls: true,
                importedAt: true,
                statedGeneratedAt: true,
                sourceReference: true,
                sourceNote: true,
              },
            },
          },
        },
      },
    }),
    prisma.waiverAiHistoricalEvidence.findMany({
      where: { contestId, universalProfileId: profileId },
      orderBy: [{ recordedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        modelLabel: true,
        responseText: true,
        responseSha256: true,
        responseByteLength: true,
        statedSourceAt: true,
        evidenceSource: true,
        evidenceReference: true,
        note: true,
        recordedAfterLock: true,
        recordedAt: true,
        recordedBy: { select: { name: true, email: true } },
        reviews: {
          orderBy: { sequence: "asc" },
          select: { sequence: true, status: true, note: true, reviewedAt: true, reviewer: { select: { name: true, email: true } } },
        },
      },
    }),
  ]);

  const lockedNumber = submission?.lockedRevision?.revisionNumber ?? null;
  const competitiveNumber =
    lockedNumber ??
    (submission && phase === "LOCKED"
      ? (submission.revisions.find((revision) => revision.kind === "SUBMISSION" && revision.createdAt < context.contest.locksAt)?.revisionNumber ?? null)
      : null);
  const evidenceCount = evidence.length;

  return {
    now,
    phase,
    profile: {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      profileType: profile.profileType,
      canSubmit: profile.status === "ACTIVE" && profile.competitorActive,
    },
    contest: {
      id: context.contest.id,
      weekId: context.contest.weekId,
      position: context.contest.position,
      locksAt: context.contest.locksAt,
      maxCalls: context.contest.maxCalls,
    },
    week: context.week,
    snapshot: {
      id: context.snapshot.id,
      version: context.snapshot.version,
      entriesFingerprint: context.snapshot.entriesFingerprint,
      frozenAt: context.snapshot.frozenAt,
    },
    prompt: {
      version: context.prompt.version,
      sha256: context.prompt.sha256,
      text: phase === "OPEN" ? context.prompt.text : null,
      availableSlots: context.prompt.availableSlots,
      poolSize: context.prompt.poolSize,
    },
    pool: context.rows
      .filter((row) => row.position === context.contest.position && row.eligible)
      .map((row) => ({ displayName: row.displayName, team: row.team })),
    board: submission
      ? {
          submissionId: submission.id,
          authority: submission.authority,
          status: waiverAiBoardStatus({ submissionStatus: submission.status, phase, evidenceCount }),
          submittedAt: submission.submittedAt,
          lockedRevisionNumber: competitiveNumber,
          revisions: submission.revisions.map((revision) => ({
            revisionNumber: revision.revisionNumber,
            createdAt: revision.createdAt,
            callCount: revision.callCount,
            authorLabel: userLabel(revision.author),
            competitive: revision.revisionNumber === competitiveNumber,
            calls: revision.calls.map((call) => ({
              slot: call.slot,
              label: waiverSlotLabel(call.slot),
              displayName: call.snapshotEntry.displayNameAtFreeze,
              team: call.snapshotEntry.teamAtFreeze,
            })),
            response: revision.aiResponse,
          })),
        }
      : null,
    evidence: evidence.map((row) => ({
      id: row.id,
      modelLabel: row.modelLabel,
      responseText: row.responseText,
      responseSha256: row.responseSha256,
      responseByteLength: row.responseByteLength,
      statedSourceAt: row.statedSourceAt,
      evidenceSource: row.evidenceSource,
      evidenceReference: row.evidenceReference,
      note: row.note,
      recordedAfterLock: row.recordedAfterLock,
      recordedAt: row.recordedAt,
      recordedByLabel: userLabel(row.recordedBy),
      reviews: row.reviews.map((review) => ({
        sequence: review.sequence,
        status: review.status,
        note: review.note,
        reviewerLabel: userLabel(review.reviewer),
        reviewedAt: review.reviewedAt,
      })),
      parse: parseWaiverAiResponse({
        text: row.responseText,
        position: context.contest.position,
        maxCalls: context.contest.maxCalls,
        rows: context.rows,
      }),
    })),
  };
}
