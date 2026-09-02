import { prisma } from "@/lib/db";
import { LATE_CAPTURE_WARNING } from "@/lib/benchmark-sources";
import {
  isLateCapture,
  isThursdayKickoff,
  mergeSundayWithThursdayLocks,
  type MergePick,
} from "@/lib/benchmarks/merge";
import { scoreContest, type ScoreablePick } from "@/lib/scoring";
import type {
  BenchmarkCaptureType,
  BenchmarkSnapshotStatus,
} from "@/lib/generated/prisma/client";

export class BenchmarkCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkCaptureError";
  }
}

export type SnapshotPickInput = {
  sourceRank: number;
  rawName: string;
  rankableEntryId: string | null;
  rankIqRank: number | null;
  excluded: boolean;
  exclusionReason: string | null;
  issue: string | null;
  selected: boolean;
};

async function loadKickoffMap(contestId: string) {
  const entries = await prisma.contestEntry.findMany({
    where: { contestId, excluded: false },
    include: {
      game: true,
      rankableEntry: { include: { game: true } },
    },
  });
  const map = new Map<string, Date | null>();
  for (const entry of entries) {
    map.set(
      entry.rankableEntryId,
      entry.game?.startsAt ??
        entry.rankableEntry.game?.startsAt ??
        entry.rankableEntry.gameStartsAt ??
        null,
    );
  }
  return map;
}

function selectedMergePicks(
  picks: SnapshotPickInput[],
  kickoffs: Map<string, Date | null>,
): MergePick[] {
  return picks
    .filter(
      (pick): pick is SnapshotPickInput & { rankableEntryId: string; rankIqRank: number } =>
        pick.selected && Boolean(pick.rankableEntryId) && pick.rankIqRank != null,
    )
    .map((pick) => ({
      rankableEntryId: pick.rankableEntryId,
      sourceRank: pick.sourceRank,
      rankIqRank: pick.rankIqRank,
      kickoffAt: kickoffs.get(pick.rankableEntryId) ?? null,
      rawName: pick.rawName,
    }));
}

export async function latestBenchmarkSnapshot(input: {
  contestId: string;
  universalProfileId: string;
}) {
  return prisma.benchmarkSnapshot.findFirst({
    where: {
      contestId: input.contestId,
      universalProfileId: input.universalProfileId,
    },
    orderBy: { createdAt: "desc" },
    include: { picks: { orderBy: { sourceRank: "asc" } } },
  });
}

async function latestCaptureOfType(input: {
  contestId: string;
  universalProfileId: string;
  captureType: BenchmarkCaptureType;
}) {
  return prisma.benchmarkSnapshot.findFirst({
    where: {
      contestId: input.contestId,
      universalProfileId: input.universalProfileId,
      captureType: input.captureType,
      status: { not: "NOT_AVAILABLE" },
    },
    orderBy: { createdAt: "desc" },
    include: { picks: { orderBy: { sourceRank: "asc" } } },
  });
}

async function regradeSubmissionIfActualsExist(submissionId: string) {
  const submission = await prisma.rankingSubmission.findUnique({
    where: { id: submissionId },
    include: {
      picks: { orderBy: { predictedRank: "asc" } },
      contest: { include: { entries: true } },
    },
  });
  if (!submission) return;
  const ranked = submission.contest.entries.filter(
    (entry) => entry.actualRank != null && entry.actualRank > 0,
  );
  if (ranked.length < submission.contest.rankingDepth) return;
  if (submission.picks.length !== submission.contest.rankingDepth) return;

  const actualByEntryId = new Map(
    submission.contest.entries
      .filter((entry) => entry.actualRank != null)
      .map((entry) => [
        entry.rankableEntryId,
        {
          actualRank: entry.actualRank as number,
          fantasyPoints: entry.fantasyPoints,
        },
      ]),
  );

  const scoreable: ScoreablePick[] = submission.picks.map((pick) => {
    const result = actualByEntryId.get(pick.rankableEntryId);
    return {
      playerId: pick.rankableEntryId,
      playerName: pick.rankableEntryId,
      predictedRank: pick.predictedRank,
      actualRank: result?.actualRank ?? submission.contest.rankingDepth + 100,
    };
  });
  const summary = scoreContest(scoreable, submission.contest.rankingDepth);

  for (const row of summary.players) {
    const pick = submission.picks.find((p) => p.rankableEntryId === row.playerId);
    if (!pick) continue;
    const result = actualByEntryId.get(row.playerId);
    await prisma.rankingPick.update({
      where: { id: pick.id },
      data: {
        actualRank: row.actualRank,
        fantasyPoints: result?.fantasyPoints ?? null,
        basePoints: row.basePoints,
        accuracyPoints: row.accuracyPoints,
        podiumPoints: row.podiumPoints,
        totalPoints: row.totalPoints,
      },
    });
  }

  await prisma.rankingSubmission.update({
    where: { id: submission.id },
    data: {
      status: "GRADED",
      rawScore: summary.rawPoints,
      normalizedScore: summary.rankIqScore,
    },
  });
}

async function upsertOfficialBenchmarkSubmission(input: {
  contestId: string;
  universalProfileId: string;
  rankingDepth: number;
  capturedAt: Date;
  slots: Array<{
    rankIqRank: number;
    rankableEntryId: string;
    sourceRank: number;
    slotLocked: boolean;
    lockedAt: Date | null;
    lockedRank: number | null;
    kickoffAt: Date | null;
  }>;
}) {
  const existing = await prisma.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId: input.contestId,
        universalProfileId: input.universalProfileId,
      },
    },
  });

  const submission = existing
    ? await prisma.rankingSubmission.update({
        where: { id: existing.id },
        data: {
          status: existing.status === "GRADED" ? "GRADED" : "LOCKED",
          submittedAt: existing.submittedAt ?? input.capturedAt,
          lockedAt: existing.lockedAt ?? input.capturedAt,
        },
      })
    : await prisma.rankingSubmission.create({
        data: {
          contestId: input.contestId,
          universalProfileId: input.universalProfileId,
          status: "LOCKED",
          submittedAt: input.capturedAt,
          lockedAt: input.capturedAt,
        },
      });

  await prisma.rankingPick.deleteMany({ where: { submissionId: submission.id } });

  for (const slot of input.slots) {
    await prisma.rankingPick.create({
      data: {
        submissionId: submission.id,
        rankableEntryId: slot.rankableEntryId,
        predictedRank: slot.rankIqRank,
        sourceRank: slot.sourceRank,
        slotLocked: slot.slotLocked,
        lockedAt: slot.lockedAt,
        lockedRank: slot.lockedRank,
        committedAt: slot.lockedAt ?? input.capturedAt,
      },
    });
  }

  if (existing?.status === "GRADED") {
    await regradeSubmissionIfActualsExist(submission.id);
  }

  return submission.id;
}

export async function captureBenchmarkSnapshot(input: {
  contestId: string;
  universalProfileId: string;
  adminUserId: string;
  captureType: BenchmarkCaptureType;
  capturedAt: Date;
  sourcePublishedAt?: Date | null;
  sourceUrl?: string | null;
  notes?: string | null;
  rawText?: string | null;
  publicBoardAllowed?: boolean;
  picks: SnapshotPickInput[];
  correctionOfId?: string | null;
  correctionReason?: string | null;
  commitOfficial?: boolean;
}) {
  const [profile, contest] = await Promise.all([
    prisma.universalProfile.findUnique({
      where: { id: input.universalProfileId },
    }),
    prisma.rankIQContest.findUnique({
      where: { id: input.contestId },
      include: { week: true },
    }),
  ]);

  if (!profile || profile.profileType !== "BENCHMARK") {
    throw new BenchmarkCaptureError("Benchmark captures require a BENCHMARK profile");
  }
  if (profile.status === "SUSPENDED") {
    throw new BenchmarkCaptureError("This benchmark source is suspended");
  }
  if (!contest) throw new BenchmarkCaptureError("Contest not found");

  const isCorrection = Boolean(input.correctionOfId);
  if (isCorrection && !input.correctionReason?.trim()) {
    throw new BenchmarkCaptureError("Corrections require a reason");
  }

  const late =
    !isCorrection && isLateCapture(input.capturedAt, contest.week.fullLockAt);
  const kickoffs = await loadKickoffMap(input.contestId);

  let status: BenchmarkSnapshotStatus = late ? "LATE" : "CAPTURED";
  const warnings: string[] = [];
  if (late) warnings.push(LATE_CAPTURE_WARNING);

  const snapshot = await prisma.benchmarkSnapshot.create({
    data: {
      universalProfileId: input.universalProfileId,
      contestId: input.contestId,
      weekId: contest.weekId,
      captureType: input.captureType,
      capturedAt: input.capturedAt,
      sourcePublishedAt: input.sourcePublishedAt ?? null,
      sourceUrl: input.sourceUrl?.trim() || null,
      notes: input.notes?.trim() || null,
      rawText: input.rawText ?? null,
      status,
      publicBoardAllowed: input.publicBoardAllowed ?? true,
      late,
      adminUserId: input.adminUserId,
      correctionOfId: input.correctionOfId ?? null,
      correctionReason: input.correctionReason?.trim() || null,
    },
  });

  for (const pick of input.picks) {
    const kickoff = pick.rankableEntryId
      ? (kickoffs.get(pick.rankableEntryId) ?? null)
      : null;
    const thursdayLock =
      pick.selected &&
      input.captureType === "THURSDAY" &&
      isThursdayKickoff(kickoff);

    await prisma.benchmarkSnapshotPick.create({
      data: {
        snapshotId: snapshot.id,
        rankableEntryId: pick.rankableEntryId,
        rawName: pick.rawName,
        sourceRank: pick.sourceRank,
        rankIqRank: pick.rankIqRank,
        excluded: pick.excluded,
        exclusionReason: pick.exclusionReason,
        issue: pick.issue,
        selected: pick.selected,
        slotLocked: thursdayLock,
        lockedAt: thursdayLock ? input.capturedAt : null,
        lockedRank: thursdayLock ? pick.rankIqRank : null,
        kickoffAt: kickoff,
      },
    });
  }

  let official = false;
  const shouldAttemptOfficial =
    input.commitOfficial !== false &&
    !late &&
    (input.captureType === "SUNDAY" || input.captureType === "MANUAL_FINAL");

  if (shouldAttemptOfficial) {
    const thursdaySnap = await latestCaptureOfType({
      contestId: input.contestId,
      universalProfileId: input.universalProfileId,
      captureType: "THURSDAY",
    });
    const thursdayPicks: MergePick[] = (thursdaySnap?.picks ?? [])
      .filter(
        (pick) =>
          pick.selected && pick.rankableEntryId && pick.rankIqRank != null,
      )
      .map((pick) => ({
        rankableEntryId: pick.rankableEntryId as string,
        sourceRank: pick.sourceRank,
        rankIqRank: pick.rankIqRank as number,
        kickoffAt: pick.kickoffAt,
        rawName: pick.rawName,
      }));

    const merged = mergeSundayWithThursdayLocks({
      rankingDepth: contest.rankingDepth,
      now: input.capturedAt,
      thursday: thursdaySnap
        ? { capturedAt: thursdaySnap.capturedAt, selected: thursdayPicks }
        : null,
      sunday: {
        capturedAt: input.capturedAt,
        selected: selectedMergePicks(input.picks, kickoffs),
      },
    });
    warnings.push(...merged.warnings);

    if (merged.complete) {
      await upsertOfficialBenchmarkSubmission({
        contestId: input.contestId,
        universalProfileId: input.universalProfileId,
        rankingDepth: contest.rankingDepth,
        capturedAt: input.capturedAt,
        slots: merged.slots.filter(
          (slot): slot is NonNullable<typeof slot> => slot != null,
        ),
      });
      official = true;
      status = "LOCKED";
      await prisma.benchmarkSnapshot.update({
        where: { id: snapshot.id },
        data: { status: "LOCKED" },
      });
    }
  }

  const saved = await prisma.benchmarkSnapshot.findUniqueOrThrow({
    where: { id: snapshot.id },
    include: { picks: { orderBy: { sourceRank: "asc" } } },
  });

  return { snapshot: saved, late, official, warnings };
}

export async function markBenchmarkNotAvailable(input: {
  contestId: string;
  universalProfileId: string;
  adminUserId: string;
  notes?: string | null;
}) {
  const [profile, contest] = await Promise.all([
    prisma.universalProfile.findUnique({
      where: { id: input.universalProfileId },
    }),
    prisma.rankIQContest.findUnique({ where: { id: input.contestId } }),
  ]);
  if (!profile || profile.profileType !== "BENCHMARK") {
    throw new BenchmarkCaptureError("Benchmark captures require a BENCHMARK profile");
  }
  if (!contest) throw new BenchmarkCaptureError("Contest not found");

  const snapshot = await prisma.benchmarkSnapshot.create({
    data: {
      universalProfileId: input.universalProfileId,
      contestId: input.contestId,
      weekId: contest.weekId,
      captureType: "MANUAL_FINAL",
      capturedAt: new Date(),
      notes: input.notes?.trim() || "Source did not publish a compatible ranking",
      status: "NOT_AVAILABLE",
      publicBoardAllowed: false,
      late: false,
      adminUserId: input.adminUserId,
    },
  });

  return snapshot;
}

export async function latestSnapshotAllowsPublicBoard(input: {
  contestId: string;
  universalProfileId: string;
}) {
  const latest = await prisma.benchmarkSnapshot.findFirst({
    where: {
      contestId: input.contestId,
      universalProfileId: input.universalProfileId,
    },
    orderBy: { createdAt: "desc" },
    select: { publicBoardAllowed: true, status: true },
  });
  if (!latest) return true;
  if (latest.status === "NOT_AVAILABLE") return false;
  return latest.publicBoardAllowed;
}
