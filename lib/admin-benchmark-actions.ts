"use server";

import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/admin/audit";
import { LATE_CAPTURE_WARNING } from "@/lib/benchmark-sources";
import {
  BenchmarkCaptureError,
  captureBenchmarkSnapshot,
  markBenchmarkNotAvailable,
} from "@/lib/benchmarks/snapshots";
import { extractTopNFromPastedText } from "@/lib/benchmarks/parser";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { parseCreatorRankingPaste } from "@/lib/creators/ranking-paste";
import { assertAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type { BenchmarkCaptureType } from "@/lib/generated/prisma/client";
import { logServerEvent } from "@/lib/log";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import { parseChicagoDateTimeLocal } from "@/lib/timing/chicago";

function revalidateBenchmark(
  weekId?: string,
  profileId?: string,
  contestId?: string,
  options?: { includeBoard?: boolean },
) {
  revalidatePath("/admin");
  revalidatePath("/admin/benchmarks");
  revalidatePath("/admin/creators");
  revalidatePath("/leaderboards");
  revalidatePath("/consensus");
  if (weekId) {
    revalidatePath(`/admin/benchmarks?weekId=${weekId}`);
    revalidatePath(`/admin/creators?weekId=${weekId}`);
  }
  // Remounting the import board wipes client form state — only do it after
  // a confirmed official lock (or explicit not-available), never on soft errors.
  if (options?.includeBoard && profileId && contestId) {
    revalidatePath(`/admin/benchmarks/${profileId}/${contestId}`);
    revalidatePath(`/admin/creators/board/${profileId}/${contestId}`);
  }
}

function parseCapturedAt(raw: string | null | undefined, fallback: Date) {
  const value = String(raw ?? "").trim();
  if (!value) return fallback;
  const chicago = parseChicagoDateTimeLocal(value);
  if (chicago) return chicago;
  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    throw new BenchmarkCaptureError("capturedAt must be a valid date/time");
  }
  return asDate;
}

function logCaptureFailure(input: {
  profileId: string;
  contestId: string;
  position: string;
  expectedFieldSize: number;
  parsedCount: number;
  failingStep: string;
  message: string;
}) {
  logServerEvent(
    "admin.benchmark_capture_failed",
    {
      creatorProfileId: input.profileId,
      contestId: input.contestId,
      position: input.position,
      expectedFieldSize: input.expectedFieldSize,
      parsedCount: input.parsedCount,
      failingStep: input.failingStep,
      message: input.message.slice(0, 300),
    },
    "error",
  );
}

export async function adminCaptureBenchmarkAction(input: {
  contestId: string;
  profileId: string;
  weekId?: string;
  captureType: BenchmarkCaptureType;
  capturedAt?: string | null;
  sourcePublishedAt?: string | null;
  sourceUrl?: string | null;
  notes?: string | null;
  rawText: string;
  publicBoardAllowed: boolean;
  confirmedExclusions?: Array<{ sourceRank: number; reason?: string }>;
  correctionOfId?: string | null;
  correctionReason?: string | null;
  commitOfficial?: boolean;
}) {
  let position = "unknown";
  let expectedFieldSize = 0;
  let parsedCount = 0;
  let failingStep = "assert_admin";

  try {
    const admin = await assertAdmin();
    failingStep = "rate_limit";
    const limited = rateLimit({
      key: await rateLimitKey("admin-parser", admin.user.id),
      ...RATE_LIMITS.adminParser,
    });
    if (!limited.ok) {
      return { ok: false as const, error: rateLimitErrorMessage(limited) };
    }

    failingStep = "load_contest";
    const contest = await prisma.rankIQContest.findUnique({
      where: { id: input.contestId },
      include: {
        week: true,
        entries: {
          include: { rankableEntry: true },
        },
      },
    });
    if (!contest) return { ok: false as const, error: "Contest not found" };

    position = contest.position;
    expectedFieldSize = contest.rankingDepth;
    const defaultDepth = rankingDepthForPosition(contest.position);
    if (contest.position === "WR" && contest.rankingDepth !== defaultDepth) {
      const message = `WR contest must use Top ${defaultDepth} (found Top ${contest.rankingDepth})`;
      logCaptureFailure({
        profileId: input.profileId,
        contestId: input.contestId,
        position,
        expectedFieldSize: defaultDepth,
        parsedCount,
        failingStep: "assert_wr_depth",
        message,
      });
      return { ok: false as const, error: message };
    }

    failingStep = "load_eligible";
    const eligible = contest.entries
      .filter((entry) => !entry.excluded)
      .map((entry) => ({
        id: entry.rankableEntryId,
        name: entry.rankableEntry.name,
        team: entry.rankableEntry.team,
        shortName: entry.rankableEntry.shortName,
      }));
    const [universe, otherPositions] = await Promise.all([
      prisma.rankableEntry.findMany({
        where: { position: contest.position, active: true },
        select: { id: true, name: true, team: true, shortName: true },
      }),
      prisma.rankableEntry.findMany({
        where: { position: { not: contest.position }, active: true },
        select: { id: true, name: true, team: true, shortName: true },
      }),
    ]);

    failingStep = "parse_paste";
    const tiered = parseCreatorRankingPaste(input.rawText);
    if (!tiered.ok) {
      logCaptureFailure({
        profileId: input.profileId,
        contestId: input.contestId,
        position,
        expectedFieldSize,
        parsedCount: 0,
        failingStep,
        message: tiered.error,
      });
      return { ok: false as const, error: tiered.error };
    }
    parsedCount = tiered.lines.length;

    failingStep = "extract_top_n";
    const extracted = extractTopNFromPastedText({
      text: input.rawText,
      lines: tiered.lines,
      eligible,
      rankingDepth: contest.rankingDepth,
      universe,
      otherPositions,
      confirmedExclusions: input.confirmedExclusions,
    });

    if (!extracted.ready) {
      const message =
        extracted.blockingIssues[0] ?? "Ranking failed validation";
      logCaptureFailure({
        profileId: input.profileId,
        contestId: input.contestId,
        position,
        expectedFieldSize,
        parsedCount,
        failingStep,
        message,
      });
      return {
        ok: false as const,
        error: message,
      };
    }

    failingStep = "capture_snapshot";
    const now = new Date();
    const capturedAt = parseCapturedAt(input.capturedAt, now);
    const sourcePublishedAt = input.sourcePublishedAt
      ? parseCapturedAt(input.sourcePublishedAt, capturedAt)
      : null;

    const result = await captureBenchmarkSnapshot({
      contestId: input.contestId,
      universalProfileId: input.profileId,
      adminUserId: admin.user.id,
      captureType: input.captureType,
      capturedAt,
      sourcePublishedAt,
      sourceUrl: input.sourceUrl,
      notes: input.notes,
      rawText: input.rawText,
      publicBoardAllowed: input.publicBoardAllowed,
      picks: extracted.rows.map((row) => ({
        sourceRank: row.sourceRank,
        rawName: row.rawName,
        rankableEntryId: row.matchedEntryId,
        rankIqRank: row.rankIqRank,
        excluded: row.excluded,
        exclusionReason: row.exclusionReason,
        issue: row.issue,
        selected: row.selected,
      })),
      correctionOfId: input.correctionOfId,
      correctionReason: input.correctionReason,
      commitOfficial: input.commitOfficial ?? true,
    });

    failingStep = "audit_log";
    await logAdminAction({
      adminUserId: admin.user.id,
      action: input.correctionOfId
        ? "benchmark.snapshot_corrected"
        : result.late
          ? "benchmark.snapshot_late"
          : result.official
            ? "benchmark.board_locked"
            : "benchmark.snapshot_captured",
      entityType: "BenchmarkSnapshot",
      entityId: result.snapshot.id,
      metadata: {
        contestId: input.contestId,
        profileId: input.profileId,
        captureType: input.captureType,
        late: result.late,
        official: result.official,
        position: contest.position,
        rankingDepth: contest.rankingDepth,
        selectedCount: extracted.selected.length,
        correctionOfId: input.correctionOfId ?? null,
        correctionReason: input.correctionReason ?? null,
      },
    });

    // Only remount the board page after an official lock so Retry/remount
    // cannot wipe an in-progress paste after a soft failure.
    revalidateBenchmark(contest.weekId, input.profileId, input.contestId, {
      includeBoard: result.official || result.late,
    });

    return {
      ok: true as const,
      late: result.late,
      official: result.official,
      warnings: result.warnings,
      snapshotId: result.snapshot.id,
      message: result.late
        ? LATE_CAPTURE_WARNING
        : result.official
          ? "Official benchmark board locked and eligible for RankEYEQ scoring"
          : "Snapshot saved",
    };
  } catch (error) {
    const message =
      error instanceof BenchmarkCaptureError
        ? error.message
        : "Unable to capture benchmark snapshot";
    logCaptureFailure({
      profileId: input.profileId,
      contestId: input.contestId,
      position,
      expectedFieldSize,
      parsedCount,
      failingStep,
      message,
    });
    return { ok: false as const, error: message };
  }
}

export async function adminMarkBenchmarkNotAvailableAction(formData: FormData) {
  const admin = await assertAdmin();
  const contestId = String(formData.get("contestId") ?? "");
  const profileId = String(formData.get("profileId") ?? "");
  const notes = String(formData.get("notes") ?? "");
  try {
    const snapshot = await markBenchmarkNotAvailable({
      contestId,
      universalProfileId: profileId,
      adminUserId: admin.user.id,
      notes,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "benchmark.not_available",
      entityType: "BenchmarkSnapshot",
      entityId: snapshot.id,
      metadata: { contestId, profileId },
    });
    const contest = await prisma.rankIQContest.findUnique({
      where: { id: contestId },
      select: { weekId: true },
    });
    revalidateBenchmark(contest?.weekId, profileId, contestId, {
      includeBoard: true,
    });
  } catch (error) {
    const message =
      error instanceof BenchmarkCaptureError
        ? error.message
        : "Unable to mark not available";
    throw new BenchmarkCaptureError(message);
  }
}
