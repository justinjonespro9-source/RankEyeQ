/**
 * Rankings AI verified historical / backfill entry.
 *
 * Reuses Expert/Creator competitive-clock rules and WaiverEyeQ-style evidence
 * attestation. Does not bypass NFL kickoffs, rewrite pools, or alter normal
 * AI wall-clock entry.
 */
import { createHash } from "node:crypto";
import {
  isOfficiallyCompetitiveBackfill,
  HISTORICAL_SOURCE_REQUIRED,
} from "@/lib/benchmarks/historical-backfill";
import { submissionDepthFromScoring } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import {
  parseWeeklyDesignation,
  WEEKLY_SELECTABLE_DESIGNATIONS,
  WEEKLY_UNAVAILABLE_DESIGNATIONS,
} from "@/lib/eligibility/player-week-availability";
import type { RankingAiHistoricalEvidenceType } from "@/lib/generated/prisma/client";
import { gradeContest } from "@/lib/grading";
import {
  AI_HISTORICAL_BACKFILL_BADGE,
  AI_HISTORICAL_ENTRY_LABEL,
  AI_HISTORICAL_EVIDENCE_TYPES,
} from "@/lib/rankings/ai-historical-backfill-ui";
import { resolveWeekScopedKickoff } from "@/lib/timing/resolve-contest-kickoff";
import { kickoffHasPassed } from "@/lib/timing/partial-lock";

export {
  AI_HISTORICAL_BACKFILL_BADGE,
  AI_HISTORICAL_ENTRY_LABEL,
  AI_HISTORICAL_EVIDENCE_TYPES,
};

export type AiHistoricalEvidenceType = (typeof AI_HISTORICAL_EVIDENCE_TYPES)[number];

export class AiHistoricalBackfillError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_INPUT"
      | "NOT_AI"
      | "DUPLICATE"
      | "NOT_READY"
      | "STALE_PREVIEW"
      | "HOLD"
      | "FORBIDDEN" = "INVALID_INPUT",
  ) {
    super(message);
    this.name = "AiHistoricalBackfillError";
  }
}

export type AiHistoricalPickIssue = {
  rankableEntryId: string;
  name: string;
  code:
    | "NOT_IN_POOL"
    | "KICKED_OFF_AT_PREDICTION"
    | "HARD_UNAVAILABLE_BEFORE_PREDICTION"
    | "LATER_OUT_AFTER_PREDICTION"
    | "POOL_ADDED_AFTER_PREDICTION"
    | "IDENTITY_CREATED_AFTER_PREDICTION";
  detail: string;
};

/**
 * Admin resolution for a later OUT / INACTIVE designation whose dated evidence
 * is at or after the original prediction time:
 *
 * 1. Open the official injury / inactive report and read sourcePublishedAt
 *    (or the contemporaneous artifact time), not the wall-clock import time.
 * 2. If that official time is BEFORE the original prediction → update
 *    PlayerWeekAvailability.sourcePublishedAt to the official time and
 *    re-run Eligibility Preview (will BLOCK as hard-unavailable).
 * 3. If that official time is AFTER the original prediction → the pick stays
 *    historically eligible. Later OUT never auto-invalidates. Commit proceeds
 *    with a warning. Kickoff freeze / reserve promotion still use kickoff-time
 *    evidence (not prediction-time) via the established stamp path.
 * 4. If the official time cannot be established → HOLD the board (do not commit).
 */

export type AiHistoricalPreviewResult = {
  ready: boolean;
  status: "READY" | "HOLD" | "BLOCKED";
  blockers: string[];
  warnings: string[];
  holdReasons: string[];
  pickIssues: AiHistoricalPickIssue[];
  previewFingerprint: string;
  competitiveAt: string;
  capturedAt: string;
  officiallyCompetitive: boolean;
  thursdayPlayerCount: number;
  rankedEntryIds: string[];
  contestId: string;
  profileId: string;
  weekId: string;
  position: string;
  rankingDepth: number;
  reserveCount: number;
};

export type AiHistoricalCommitInput = {
  contestId: string;
  universalProfileId: string;
  adminUserId: string;
  rankedEntryIds: string[];
  originalPredictionAt: Date;
  evidenceType: string;
  evidenceReference: string;
  sourceIdentifier?: string | null;
  rawResponseText?: string | null;
  attestationAccepted: boolean;
  previewFingerprint: string;
  /** Wall-clock capture; defaults to now. Never replaced by prediction time. */
  capturedAt?: Date;
  now?: Date;
};

function sha256Text(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isEvidenceType(value: string): value is AiHistoricalEvidenceType {
  return (AI_HISTORICAL_EVIDENCE_TYPES as readonly string[]).includes(value);
}

export function buildAiHistoricalPreviewFingerprint(input: {
  contestId: string;
  universalProfileId: string;
  rankedEntryIds: string[];
  originalPredictionAt: Date;
  evidenceType: string;
  evidenceReference: string;
  sourceIdentifier?: string | null;
  responseSha256: string;
}): string {
  const payload = [
    input.contestId,
    input.universalProfileId,
    input.rankedEntryIds.join(","),
    input.originalPredictionAt.toISOString(),
    input.evidenceType,
    input.evidenceReference.trim(),
    (input.sourceIdentifier ?? "").trim(),
    input.responseSha256,
  ].join("|");
  return sha256Text(payload);
}

function historicalStatusEvidenceAt(input: {
  sourcePublishedAt: Date | null;
  observedAt: Date;
}): Date {
  return input.sourcePublishedAt ?? input.observedAt;
}

/**
 * Hard-unavailable only blocks when dated evidence shows the designation
 * existed before the competitive prediction time.
 *
 * A later OUT/INACTIVE (evidence at/after prediction) never auto-invalidates
 * the pick — it is a warning. Admin resolves via timestamped official injury
 * evidence (see module doc above). Only when pool/status evidence is missing
 * or contradictory enough that eligibility cannot be established do we HOLD.
 */
export function evaluateHistoricalAvailability(input: {
  designation: string | null | undefined;
  sourcePublishedAt: Date | null;
  observedAt: Date;
  competitiveAt: Date;
}): {
  block: boolean;
  /** Later OUT after prediction — warn only; still historically eligible. */
  laterOutWarning: boolean;
  detail: string | null;
} {
  // PlayerWeekAvailability uses WeeklyAvailabilityDesignation (AVAILABLE…),
  // not EntryAvailability (ACTIVE…). Treat selectable/unknown as pass.
  const designation = parseWeeklyDesignation(input.designation);
  if (
    !designation ||
    WEEKLY_SELECTABLE_DESIGNATIONS.has(designation) ||
    !WEEKLY_UNAVAILABLE_DESIGNATIONS.has(designation)
  ) {
    return { block: false, laterOutWarning: false, detail: null };
  }
  const evidenceAt = historicalStatusEvidenceAt(input);
  if (evidenceAt.getTime() < input.competitiveAt.getTime()) {
    return {
      block: true,
      laterOutWarning: false,
      detail: `Officially ${designation} as of ${evidenceAt.toISOString()} (before prediction ${input.competitiveAt.toISOString()})`,
    };
  }
  return {
    block: false,
    laterOutWarning: true,
    detail: `Later ${designation} dated ${evidenceAt.toISOString()} is at/after prediction ${input.competitiveAt.toISOString()} — not applied retroactively; pick remains historically eligible. Confirm official injury timestamp before commit.`,
  };
}

async function loadContestContext(contestId: string) {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      week: true,
      entries: {
        where: { excluded: false },
        include: {
          game: true,
          rankableEntry: {
            select: {
              id: true,
              name: true,
              team: true,
              availability: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });
  if (!contest) throw new AiHistoricalBackfillError("Contest not found");
  return contest;
}

export async function previewAiHistoricalBoard(input: {
  contestId: string;
  universalProfileId: string;
  rankedEntryIds: string[];
  originalPredictionAt: Date;
  evidenceType: string;
  evidenceReference: string;
  sourceIdentifier?: string | null;
  rawResponseText?: string | null;
  attestationAccepted: boolean;
  capturedAt?: Date;
  now?: Date;
}): Promise<AiHistoricalPreviewResult> {
  const capturedAt = input.capturedAt ?? input.now ?? new Date();
  const competitiveAt = input.originalPredictionAt;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const holdReasons: string[] = [];
  const pickIssues: AiHistoricalPickIssue[] = [];

  if (!input.attestationAccepted) {
    blockers.push(
      "Explicit historical-entry attestation is required (predictions were produced before kickoff with supporting evidence).",
    );
  }
  if (!input.evidenceReference?.trim()) {
    blockers.push("Evidence reference is required.");
  }
  if (!isEvidenceType(input.evidenceType)) {
    blockers.push("Evidence type is invalid.");
  }
  if (Number.isNaN(competitiveAt.getTime())) {
    blockers.push(HISTORICAL_SOURCE_REQUIRED);
  }
  if (competitiveAt.getTime() > capturedAt.getTime()) {
    blockers.push(
      "Original prediction timestamp cannot be after the capture timestamp.",
    );
  }

  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    select: {
      id: true,
      profileType: true,
      status: true,
      competitorActive: true,
      displayName: true,
    },
  });
  if (
    !profile ||
    profile.profileType !== "AI" ||
    profile.status !== "ACTIVE" ||
    !profile.competitorActive
  ) {
    throw new AiHistoricalBackfillError(
      "Verified historical entry requires an active SYSTEM_OPERATED AI competitor profile.",
      "NOT_AI",
    );
  }

  const contest = await loadContestContext(input.contestId);
  const reserveCount = contest.reserveCount ?? 0;
  const submissionDepth = submissionDepthFromScoring(
    contest.rankingDepth,
    reserveCount,
  );
  const ranked = input.rankedEntryIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  if (ranked.length !== submissionDepth) {
    blockers.push(
      `Board must have exactly ${submissionDepth} ordered picks (Top ${contest.rankingDepth} + ${reserveCount} reserves); received ${ranked.length}.`,
    );
  }
  if (new Set(ranked).size !== ranked.length) {
    blockers.push("Duplicate players are not allowed.");
  }

  const existing = await prisma.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId: input.contestId,
        universalProfileId: input.universalProfileId,
      },
    },
    select: {
      id: true,
      status: true,
      historicalBackfill: true,
      _count: { select: { picks: true } },
    },
  });
  if (existing && (existing.status !== "DRAFT" || existing._count.picks > 0)) {
    blockers.push(
      "This AI already has a board for this contest; historical entry never replaces an existing submission.",
    );
  }

  if (contest.week.rankingsOpenAt && competitiveAt < contest.week.rankingsOpenAt) {
    blockers.push(
      `Original prediction ${competitiveAt.toISOString()} is before rankings open ${contest.week.rankingsOpenAt.toISOString()}.`,
    );
  }
  if (
    contest.week.fullLockAt &&
    competitiveAt.getTime() >= contest.week.fullLockAt.getTime()
  ) {
    blockers.push(
      `Original prediction ${competitiveAt.toISOString()} is at/after Sunday full lock ${contest.week.fullLockAt.toISOString()} — not competitively eligible.`,
    );
  }

  const officiallyCompetitive = isOfficiallyCompetitiveBackfill({
    historicalBackfill: true,
    sourcePublishedAt: competitiveAt,
    capturedAt,
    fullLockAt: contest.week.fullLockAt,
  });

  const poolById = new Map(
    contest.entries.map((entry) => [entry.rankableEntryId, entry]),
  );
  const pwaRows = await prisma.playerWeekAvailability.findMany({
    where: {
      weekId: contest.weekId,
      rankableEntryId: { in: ranked },
    },
  });
  const pwaById = new Map(pwaRows.map((row) => [row.rankableEntryId, row]));

  const wallNow = input.now ?? capturedAt;
  let thursdayPlayerCount = 0;
  for (const id of ranked) {
    const entry = poolById.get(id);
    if (!entry) {
      pickIssues.push({
        rankableEntryId: id,
        name: id,
        code: "NOT_IN_POOL",
        detail: "Player is not in the non-excluded contest pool.",
      });
      blockers.push(`Pick not in pool: ${id}`);
      continue;
    }
    // Pool membership at prediction time: contest-entry / identity rows created
    // after the claimed prediction cannot be proven as valid historical options.
    if (entry.createdAt.getTime() > competitiveAt.getTime()) {
      pickIssues.push({
        rankableEntryId: id,
        name: entry.rankableEntry.name,
        code: "POOL_ADDED_AFTER_PREDICTION",
        detail: `Contest pool row created ${entry.createdAt.toISOString()} after prediction ${competitiveAt.toISOString()}.`,
      });
      holdReasons.push(
        `${entry.rankableEntry.name}: added to contest pool after claimed prediction time — HOLD without contemporaneous pool evidence.`,
      );
    } else if (
      entry.rankableEntry.createdAt.getTime() > competitiveAt.getTime()
    ) {
      pickIssues.push({
        rankableEntryId: id,
        name: entry.rankableEntry.name,
        code: "IDENTITY_CREATED_AFTER_PREDICTION",
        detail: `RankableEntry created ${entry.rankableEntry.createdAt.toISOString()} after prediction ${competitiveAt.toISOString()}.`,
      });
      holdReasons.push(
        `${entry.rankableEntry.name}: player identity created after claimed prediction time — HOLD without contemporaneous identity evidence.`,
      );
    }

    // Team / weekTeam corrections after prediction do not change identity;
    // eligibility is keyed by rankableEntryId + original contest pool row.
    if (
      entry.weekTeam &&
      entry.rankableEntry.team &&
      entry.weekTeam !== entry.rankableEntry.team
    ) {
      warnings.push(
        `${entry.rankableEntry.name}: weekTeam=${entry.weekTeam} differs from current team=${entry.rankableEntry.team} — identity preserved; team correction ignored for historical eligibility.`,
      );
    }

    const kickoff = resolveWeekScopedKickoff({
      weekId: contest.weekId,
      contestGame: entry.game,
    });
    if (kickoff && kickoffHasPassed(kickoff, competitiveAt)) {
      pickIssues.push({
        rankableEntryId: id,
        name: entry.rankableEntry.name,
        code: "KICKED_OFF_AT_PREDICTION",
        detail: `Kickoff ${kickoff.toISOString()} had already passed at prediction time.`,
      });
      blockers.push(
        `${entry.rankableEntry.name} had already kicked off at the original prediction time.`,
      );
    }
    // Players already kicked off now, but still eligible at the historical
    // prediction time — the boards that need verified historical entry.
    if (
      kickoff &&
      kickoffHasPassed(kickoff, wallNow) &&
      !kickoffHasPassed(kickoff, competitiveAt)
    ) {
      thursdayPlayerCount += 1;
    }

    const pwa = pwaById.get(id);
    if (pwa) {
      const avail = evaluateHistoricalAvailability({
        designation: pwa.designation,
        sourcePublishedAt: pwa.sourcePublishedAt,
        observedAt: pwa.observedAt,
        competitiveAt,
      });
      if (avail.block) {
        pickIssues.push({
          rankableEntryId: id,
          name: entry.rankableEntry.name,
          code: "HARD_UNAVAILABLE_BEFORE_PREDICTION",
          detail: avail.detail ?? "Hard-unavailable before prediction",
        });
        blockers.push(
          `${entry.rankableEntry.name} was officially unavailable before the prediction time.`,
        );
      } else if (avail.laterOutWarning) {
        pickIssues.push({
          rankableEntryId: id,
          name: entry.rankableEntry.name,
          code: "LATER_OUT_AFTER_PREDICTION",
          detail: avail.detail ?? "Later OUT after prediction",
        });
        warnings.push(
          `${entry.rankableEntry.name}: ${avail.detail}`,
        );
      }
    }
  }

  const responseSha256 = sha256Text(
    input.rawResponseText?.trim() || ranked.join(","),
  );
  const previewFingerprint = buildAiHistoricalPreviewFingerprint({
    contestId: input.contestId,
    universalProfileId: input.universalProfileId,
    rankedEntryIds: ranked,
    originalPredictionAt: competitiveAt,
    evidenceType: input.evidenceType,
    evidenceReference: input.evidenceReference,
    sourceIdentifier: input.sourceIdentifier,
    responseSha256,
  });

  if (holdReasons.length > 0 && blockers.length === 0) {
    warnings.push(
      "Historical pool/identity eligibility cannot be established for one or more picks — HOLD for owner review. Do not commit.",
    );
  }

  const ready = blockers.length === 0 && holdReasons.length === 0;
  const status = blockers.length
    ? "BLOCKED"
    : holdReasons.length
      ? "HOLD"
      : "READY";

  return {
    ready,
    status,
    blockers,
    warnings,
    holdReasons,
    pickIssues,
    previewFingerprint,
    competitiveAt: competitiveAt.toISOString(),
    capturedAt: capturedAt.toISOString(),
    officiallyCompetitive,
    thursdayPlayerCount,
    rankedEntryIds: ranked,
    contestId: contest.id,
    profileId: profile.id,
    weekId: contest.weekId,
    position: contest.position,
    rankingDepth: contest.rankingDepth,
    reserveCount,
  };
}

export async function commitAiHistoricalBoard(
  input: AiHistoricalCommitInput,
): Promise<{
  submissionId: string;
  provenanceId: string;
  auditLogId: string;
  status: string;
  historicalBackfill: true;
  competitiveAt: string;
  capturedAt: string;
}> {
  if (!input.attestationAccepted) {
    throw new AiHistoricalBackfillError(
      "Explicit historical-entry attestation is required.",
    );
  }
  if (!isEvidenceType(input.evidenceType)) {
    throw new AiHistoricalBackfillError("Evidence type is invalid.");
  }

  const capturedAt = input.capturedAt ?? input.now ?? new Date();
  const preview = await previewAiHistoricalBoard({
    contestId: input.contestId,
    universalProfileId: input.universalProfileId,
    rankedEntryIds: input.rankedEntryIds,
    originalPredictionAt: input.originalPredictionAt,
    evidenceType: input.evidenceType,
    evidenceReference: input.evidenceReference,
    sourceIdentifier: input.sourceIdentifier,
    rawResponseText: input.rawResponseText,
    attestationAccepted: input.attestationAccepted,
    capturedAt,
  });

  if (preview.status === "HOLD") {
    throw new AiHistoricalBackfillError(
      `HOLD — owner review required: ${preview.holdReasons.slice(0, 3).join("; ")}`,
      "HOLD",
    );
  }
  if (!preview.ready) {
    throw new AiHistoricalBackfillError(
      preview.blockers[0] ?? "Historical preview is not ready",
      "NOT_READY",
    );
  }
  if (preview.previewFingerprint !== input.previewFingerprint) {
    throw new AiHistoricalBackfillError(
      "Stale preview — re-run eligibility Preview before committing.",
      "STALE_PREVIEW",
    );
  }

  const competitiveAt = input.originalPredictionAt;
  const responseSha256 = sha256Text(
    input.rawResponseText?.trim() || preview.rankedEntryIds.join(","),
  );
  const contest = await loadContestContext(input.contestId);

  let result: {
    submission: { id: string };
    provenance: { id: string };
    audit: { id: string };
  };
  try {
    result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.rankingSubmission.findUnique({
          where: {
            contestId_universalProfileId: {
              contestId: input.contestId,
              universalProfileId: input.universalProfileId,
            },
          },
          include: { picks: true, aiHistoricalProvenance: true },
        });
        if (
          existing &&
          (existing.status !== "DRAFT" ||
            existing.picks.length > 0 ||
            existing.aiHistoricalProvenance ||
            existing.historicalBackfill)
        ) {
          throw new AiHistoricalBackfillError(
            "This AI already has a board for this contest.",
            "DUPLICATE",
          );
        }

        const submission = existing
          ? await tx.rankingSubmission.update({
              where: { id: existing.id },
              data: {
                status: "LOCKED",
                submittedAt: competitiveAt,
                lockedAt: competitiveAt,
                historicalBackfill: true,
                authority: "SYSTEM_OPERATED",
              },
            })
          : await tx.rankingSubmission.create({
              data: {
                contestId: input.contestId,
                universalProfileId: input.universalProfileId,
                status: "LOCKED",
                submittedAt: competitiveAt,
                lockedAt: competitiveAt,
                historicalBackfill: true,
                authority: "SYSTEM_OPERATED",
              },
            });

        if (existing) {
          await tx.rankingPick.deleteMany({
            where: { submissionId: submission.id },
          });
        }

        // Picks recorded as of competitive prediction time. Kickoff freeze /
        // reserve promotion stamps wasUnavailableAtKickoff later via the
        // established grade-time path — never rewritten here.
        await tx.rankingPick.createMany({
          data: preview.rankedEntryIds.map((rankableEntryId, index) => ({
            submissionId: submission.id,
            rankableEntryId,
            predictedRank: index + 1,
            slotLocked: false,
            lockedRank: null,
            lockedAt: null,
            committedAt: competitiveAt,
            wasUnavailableAtKickoff: null,
          })),
        });

        const provenance = await tx.rankingAiHistoricalProvenance.create({
          data: {
            submissionId: submission.id,
            contestId: input.contestId,
            weekId: contest.weekId,
            universalProfileId: input.universalProfileId,
            originalPredictionAt: competitiveAt,
            capturedAt,
            evidenceType: input.evidenceType as RankingAiHistoricalEvidenceType,
            evidenceReference: input.evidenceReference.trim(),
            sourceIdentifier: input.sourceIdentifier?.trim() || null,
            rawResponseText: input.rawResponseText?.trim() || null,
            responseSha256,
            rankedEntryIds: preview.rankedEntryIds,
            previewFingerprint: preview.previewFingerprint,
            adminUserId: input.adminUserId,
            attestationAcceptedAt: capturedAt,
          },
        });

        // Audit inside the same transaction so a board cannot land without
        // an auditable historical-backfill designation.
        const audit = await tx.adminAuditLog.create({
          data: {
            adminUserId: input.adminUserId,
            action: "ai.board_locked_historical_backfill",
            entityType: "RankingSubmission",
            entityId: submission.id,
            metadata: {
              contestId: input.contestId,
              weekId: contest.weekId,
              profileId: input.universalProfileId,
              position: contest.position,
              provenanceId: provenance.id,
              originalPredictionAt: competitiveAt.toISOString(),
              capturedAt: capturedAt.toISOString(),
              evidenceType: input.evidenceType,
              evidenceReference: input.evidenceReference.trim(),
              sourceIdentifier: input.sourceIdentifier?.trim() || null,
              responseSha256,
              previewFingerprint: preview.previewFingerprint,
              thursdayPlayerCount: preview.thursdayPlayerCount,
              rankedEntryIds: preview.rankedEntryIds,
              historicalBackfill: true,
              badge: AI_HISTORICAL_BACKFILL_BADGE,
              kickoffTimestampsMutated: false,
              consensusSnapshotRewritten: false,
            },
          },
        });

        return { submission, provenance, audit };
      },
      {
        // Serialize concurrent Preview→Commit races for the same AI+contest.
        isolationLevel: "Serializable",
      },
    );
  } catch (error) {
    if (error instanceof AiHistoricalBackfillError) throw error;
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "P2002") {
      throw new AiHistoricalBackfillError(
        "This AI already has a board for this contest.",
        "DUPLICATE",
      );
    }
    throw error;
  }

  // Match Expert historical path: if week already COMPLETE and actuals exist, grade.
  // Grading is outside the write transaction (same as Expert backfill) and only
  // touches scores — never mutates other participant boards' picks.
  if (contest.week.status === "COMPLETE") {
    const withActuals = await prisma.contestEntry.count({
      where: {
        contestId: input.contestId,
        excluded: false,
        actualRank: { not: null },
      },
    });
    if (withActuals > 0) {
      await gradeContest(input.contestId);
    }
  }

  return {
    submissionId: result.submission.id,
    provenanceId: result.provenance.id,
    auditLogId: result.audit.id,
    status: "LOCKED",
    historicalBackfill: true,
    competitiveAt: competitiveAt.toISOString(),
    capturedAt: capturedAt.toISOString(),
  };
}
