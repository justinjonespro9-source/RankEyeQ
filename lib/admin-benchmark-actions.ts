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
import { assertAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type { BenchmarkCaptureType } from "@/lib/generated/prisma/client";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import { parseChicagoDateTimeLocal } from "@/lib/timing/chicago";

function revalidateBenchmark(weekId?: string, profileId?: string, contestId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/benchmarks");
  revalidatePath("/leaderboards");
  revalidatePath("/consensus");
  if (weekId) revalidatePath(`/admin/benchmarks?weekId=${weekId}`);
  if (profileId && contestId) {
    revalidatePath(`/admin/benchmarks/${profileId}/${contestId}`);
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
  const admin = await assertAdmin();
  const limited = rateLimit({
    key: await rateLimitKey("admin-parser", admin.user.id),
    ...RATE_LIMITS.adminParser,
  });
  if (!limited.ok) {
    return { ok: false as const, error: rateLimitErrorMessage(limited) };
  }

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

  const extracted = extractTopNFromPastedText({
    text: input.rawText,
    eligible,
    rankingDepth: contest.rankingDepth,
    universe,
    otherPositions,
    confirmedExclusions: input.confirmedExclusions,
  });

  const now = new Date();
  try {
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
        correctionOfId: input.correctionOfId ?? null,
        correctionReason: input.correctionReason ?? null,
      },
    });

    revalidateBenchmark(contest.weekId, input.profileId, input.contestId);
    return {
      ok: true as const,
      late: result.late,
      official: result.official,
      warnings: result.warnings,
      snapshotId: result.snapshot.id,
      extracted,
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
    return { ok: false as const, error: message, extracted };
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
    revalidateBenchmark(contest?.weekId, profileId, contestId);
  } catch (error) {
    const message =
      error instanceof BenchmarkCaptureError
        ? error.message
        : "Unable to mark not available";
    throw new BenchmarkCaptureError(message);
  }
}
