/**
 * Read-only Week 1 production audit (revised reconstruction gate).
 * DOES NOT write. DOES NOT repair.
 *
 *   dotenv -e .env.production.local -- npx tsx scripts/audit-week1-snapshot-and-unscorable.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  isGradeablePickCount,
  isScorablePickCount,
  submissionDepthFromScoring,
} from "@/lib/contest-defaults";
import { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import {
  evaluateReconstructionEligibility,
  isStalePregameSnapshot,
} from "@/lib/consensus-snapshot-rebuild";

const CANONICAL_LOCK = new Date("2026-09-13T15:00:00.000Z");
const EARLY_LOCK = new Date("2026-09-06T15:00:00.000Z");

function pp(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function segmentLabel(input: {
  profileType: string;
  sourceKind: string | null;
}): string {
  if (input.profileType === "HUMAN") return "HUMAN";
  if (input.profileType === "AI") return "AI";
  if (input.profileType === "CREATOR") return "CREATOR";
  if (input.profileType === "BENCHMARK") {
    if (
      input.sourceKind === "PUBLISHER_CONSENSUS" ||
      input.sourceKind === "SITE_CONSENSUS"
    ) {
      return "PUBLISHER";
    }
    return "EXPERT";
  }
  return input.profileType;
}

async function main() {
  const week = await prisma.week.findFirst({
    where: {
      weekNumber: 1,
      isTest: false,
      season: { year: 2026, sport: "NFL" },
    },
    include: {
      season: true,
      contests: {
        orderBy: { position: "asc" },
        include: { pregameSnapshot: true },
      },
    },
  });

  if (!week) throw new Error("2026 NFL Week 1 not found");

  console.log("=== WEEK TIMING ===");
  console.log(
    pp({
      weekId: week.id,
      label: week.label,
      status: week.status,
      fullLockAt: week.fullLockAt?.toISOString() ?? null,
      canonicalLock: CANONICAL_LOCK.toISOString(),
      earlyWrongLock: EARLY_LOCK.toISOString(),
      fullLockMatchesCanonical:
        week.fullLockAt?.toISOString() === CANONICAL_LOCK.toISOString(),
    }),
  );

  console.log("\n=== SNAPSHOT FORENSICS ===");
  for (const contest of week.contests) {
    const snap = contest.pregameSnapshot;
    console.log(
      pp({
        position: contest.position,
        contestStatus: contest.status,
        rankingDepth: contest.rankingDepth,
        reserveCount: contest.reserveCount,
        snapshot: snap
          ? {
              lockedAt: snap.lockedAt.toISOString(),
              staleVsWeekFullLock: isStalePregameSnapshot({
                snapshotLockedAt: snap.lockedAt,
                weekFullLockAt: week.fullLockAt,
              }),
              matchesEarlyWrongLock:
                snap.lockedAt.toISOString() === EARLY_LOCK.toISOString(),
              sampleSizeAll: snap.sampleSizeAll,
              sampleSizeHuman: snap.sampleSizeHuman,
              sampleSizeAi: snap.sampleSizeAi,
              sampleSizeExpert: snap.sampleSizeExpert,
              sampleSizeCreator: snap.sampleSizeCreator,
              sampleSizePublisher: snap.sampleSizePublisher,
            }
          : null,
      }),
    );
  }

  console.log("\n=== RECONSTRUCTION SAFETY (pick evidence; ignore submission.updatedAt) ===");

  const expectedBySegment: Record<string, Record<string, number>> = {};
  const positionSummaries: unknown[] = [];
  let genuinelyPostLockPickBoards = 0;

  for (const contest of week.contests) {
    const submissions = await prisma.rankingSubmission.findMany({
      where: { contestId: contest.id },
      include: {
        picks: {
          include: { rankableEntry: { select: { id: true, name: true } } },
          orderBy: { predictedRank: "asc" },
        },
        universalProfile: {
          include: {
            expertSource: true,
            creatorCompetitor: true,
            publicFromWeek: true,
          },
        },
      },
    });

    const entryMeta = await prisma.contestEntry.findMany({
      where: { contestId: contest.id },
      select: { rankableEntryId: true, excluded: true },
    });
    const excludedIds = new Set(
      entryMeta.filter((e) => e.excluded).map((e) => e.rankableEntryId),
    );

    const reserveCount = contest.reserveCount ?? 0;
    const maxScorable = submissionDepthFromScoring(
      contest.rankingDepth,
      reserveCount,
    );

    const unscorableFull: unknown[] = [];
    const reconstructionRejected: unknown[] = [];
    const segmentCounts: Record<string, number> = {
      HUMAN: 0,
      AI: 0,
      EXPERT: 0,
      CREATOR: 0,
      PUBLISHER: 0,
    };
    let candidateCount = 0;

    for (const sub of submissions) {
      const profile = sub.universalProfile;
      const sourceKind = profile.expertSource?.sourceKind ?? null;
      const segment = segmentLabel({
        profileType: profile.profileType,
        sourceKind,
      });
      const pickCount = sub.picks.length;
      const scorable = isScorablePickCount(
        pickCount,
        contest.rankingDepth,
        reserveCount,
      );
      const gradeable = isGradeablePickCount(pickCount, contest.rankingDepth);
      const hasExcludedPick = sub.picks.some((p) =>
        excludedIds.has(p.rankableEntryId),
      );

      let unscorableReason: string | null = null;
      if (!scorable) {
        if (pickCount === 0) unscorableReason = "empty board (0 picks)";
        else if (pickCount < contest.rankingDepth) {
          unscorableReason = `incomplete: pickCount ${pickCount} < rankingDepth ${contest.rankingDepth}`;
        } else {
          unscorableReason = `over-depth for reserveCount=${reserveCount}: pickCount ${pickCount} > max ${maxScorable} (GRADEABLE Top ${contest.rankingDepth})`;
        }
      }

      if (!scorable && submissionIsEligible(sub.status)) {
        let recommendation: "GRADE_TOP_N" | "SKIP" | "IGNORE_DRAFT" = "SKIP";
        let recommendationReason = unscorableReason ?? "unscorable";
        if (sub.status === "DRAFT") {
          recommendation = "IGNORE_DRAFT";
          recommendationReason = "DRAFT shells are not competitors";
        } else if (gradeable) {
          recommendation = "GRADE_TOP_N";
          recommendationReason =
            `Over-depth but gradeable: ignore picks beyond Top ${contest.rankingDepth}; do not treat extras as reserves.`;
        } else {
          recommendation = "SKIP";
          recommendationReason = `Truly incomplete (<${contest.rankingDepth} picks)`;
        }
        unscorableFull.push({
          position: contest.position,
          submissionId: sub.id,
          status: sub.status,
          segment,
          displayName: profile.displayName,
          username: profile.username,
          publication: profile.expertSource?.publicationName ?? null,
          brandName: profile.creatorCompetitor?.brandName ?? null,
          pickCount,
          expectedWeek1PickCount: contest.rankingDepth,
          scorable,
          gradeable,
          unscorableReason,
          hasExcludedPick,
          submittedAt: sub.submittedAt?.toISOString() ?? null,
          submissionUpdatedAt: sub.updatedAt.toISOString(),
          recommendation,
          recommendationReason,
          pickPreview: sub.picks.slice(0, 4).map((p) => ({
            rank: p.predictedRank,
            name: p.rankableEntry.name,
            committedAt: p.committedAt?.toISOString() ?? null,
            lockedAt: p.lockedAt?.toISOString() ?? null,
          })),
        });
      }

      const statusOk = submissionIsEligible(sub.status);
      const consensusEligible =
        filterEligibleConsensusSubmissions(
          [
            {
              status: sub.status,
              profileType: profile.profileType,
              sourceKind,
              picks: sub.picks,
              competitorActive: profile.competitorActive,
              publicVisible: profile.publicVisible,
              publicFromWeekId: profile.publicFromWeekId,
              publicFromWeek: profile.publicFromWeek
                ? {
                    id: profile.publicFromWeek.id,
                    seasonId: profile.publicFromWeek.seasonId,
                    weekNumber: profile.publicFromWeek.weekNumber,
                    startsAt: profile.publicFromWeek.startsAt,
                  }
                : null,
              week: {
                id: week.id,
                seasonId: week.seasonId,
                weekNumber: week.weekNumber,
                startsAt: week.startsAt,
              },
            },
          ],
          segment === "PUBLISHER"
            ? "PUBLISHER"
            : segment === "EXPERT"
              ? "EXPERT"
              : segment === "CREATOR"
                ? "CREATOR"
                : segment === "AI"
                  ? "AI"
                  : segment === "HUMAN"
                    ? "HUMAN"
                    : "ALL",
        ).length > 0;

      const eligibility = evaluateReconstructionEligibility(
        {
          status: sub.status,
          submittedAt: sub.submittedAt,
          rankingDepth: contest.rankingDepth,
          picks: sub.picks.map((p) => ({
            predictedRank: p.predictedRank,
            rankableEntryId: p.rankableEntryId,
            committedAt: p.committedAt,
            lockedAt: p.lockedAt,
          })),
          publicConsensusEligible: consensusEligible,
          statusEligible: statusOk,
        },
        CANONICAL_LOCK,
      );

      if (
        eligibility.pickIssues.some((i) => i.issue.includes("after canonical"))
      ) {
        genuinelyPostLockPickBoards += 1;
      }

      if (eligibility.qualifies) {
        segmentCounts[segment] = (segmentCounts[segment] ?? 0) + 1;
        candidateCount += 1;
      } else if (statusOk && pickCount >= contest.rankingDepth) {
        reconstructionRejected.push({
          submissionId: sub.id,
          segment,
          displayName: profile.displayName,
          pickCount,
          publicVisible: profile.publicVisible,
          reasons: eligibility.reasons,
          pickIssues: eligibility.pickIssues.slice(0, 5),
          submittedAt: sub.submittedAt?.toISOString() ?? null,
          submissionUpdatedAt: sub.updatedAt.toISOString(),
          note: "submission.updatedAt is informational only — not a reject reason",
        });
      }
    }

    const allGroups = (["HUMAN", "EXPERT", "CREATOR", "AI"] as const).filter(
      (key) => (segmentCounts[key] ?? 0) > 0,
    );
    const allBallots = allGroups.reduce(
      (sum, key) => sum + (segmentCounts[key] ?? 0),
      0,
    );

    expectedBySegment[contest.position] = { ...segmentCounts };
    const summary = {
      position: contest.position,
      reconstructionEligibleCounts: segmentCounts,
      reconstructionCandidateCount: candidateCount,
      reconstructionRejectedCount: reconstructionRejected.length,
      expectedAllBallots: allBallots,
      expectedContributingGroups: allGroups.length,
      expectedAllGroups: allGroups,
      publisherSeparate: segmentCounts.PUBLISHER,
      reconstructionRejectedSample: reconstructionRejected.slice(0, 8),
    };
    positionSummaries.push(summary);

    console.log(`\n--- ${contest.position} reconstruction ---`);
    console.log(pp(summary));
    console.log(`\n--- ${contest.position} UNSCORABLE (full) ---`);
    console.log(unscorableFull.length === 0 ? "[]" : pp(unscorableFull));
  }

  console.log("\n=== TRUST VERDICT ===");
  console.log(
    pp({
      revisedGate:
        "Pick committedAt/lockedAt only; RankingSubmission.updatedAt ignored",
      expectedBySegment,
      positionSummaries,
      genuinelyPostLockPickBoards,
      snapshotRebuildTrustworthyHint:
        genuinelyPostLockPickBoards === 0 &&
        Object.values(expectedBySegment).every((c) => (c.AI ?? 0) >= 6),
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
