import { toEligibleParserEntry } from "@/lib/admin/ai-parser";
import type { EligibleParserEntry } from "@/lib/admin/ai-parser";
import { isThursdayKickoff } from "@/lib/benchmarks/merge";
import {
  formatCreatorAffiliationBadge,
  formatCreatorPrimaryName,
} from "@/lib/creator-identity";
import {
  findNextCreatorImportTarget,
  getCreatorRankingCoverage,
  type CreatorCoverageDashboard,
} from "@/lib/creators/coverage";
import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { logServerEvent } from "@/lib/log";

export type CreatorBoardTimingNotice = {
  kind: "thursday_started_no_snapshot" | "full_lock_passed";
  message: string;
  thursdayEligibleCount: number;
  thursdayStartedCount: number;
};

export type CreatorBoardPageModel = {
  profileId: string;
  contestId: string;
  weekId: string;
  position: ContestPosition;
  rankingDepth: number;
  weekLabel: string;
  contestTitle: string;
  primaryName: string;
  brandName: string | null;
  affiliationBadge: string;
  competitorActive: boolean;
  defaultSourceUrl: string | null;
  fullLockAt: Date | null;
  eligible: EligibleParserEntry[];
  eligibleCount: number;
  latestSnapshotId: string | null;
  latestSourceUrl: string | null;
  latestSourcePublishedAt: Date | null;
  latestCapturedAt: Date | null;
  hasOfficialBoard: boolean;
  submissionStatus: string | null;
  snapshots: Array<{
    id: string;
    captureType: string;
    status: string;
    late: boolean;
    sourceUrl: string | null;
    capturedAt: Date;
    sourcePublishedAt: Date | null;
  }>;
  positionLinks: Array<{ position: ContestPosition; contestId: string }>;
  nextHref: string | null;
  timingNotice: CreatorBoardTimingNotice | null;
};

function logBoardStep(
  step: string,
  fields: Record<string, unknown>,
  level: "info" | "error" = "info",
) {
  logServerEvent(
    "admin.creator_board_load",
    {
      step,
      ...fields,
    },
    level,
  );
}

/**
 * Build Creator import board page data.
 *
 * Intentionally does NOT load the global RankableEntry catalog into Client
 * Component props — WR catalogs can be thousands of rows and blow the RSC
 * payload. Client preview validates against contest eligible only; the server
 * action still loads universe / other-position catalogs on submit.
 */
export async function loadCreatorBoardPage(input: {
  profileId: string;
  contestId: string;
  weekId?: string;
  now?: Date;
}): Promise<CreatorBoardPageModel | { notFound: true }> {
  const now = input.now ?? new Date();
  let step = "creator_lookup";

  try {
    logBoardStep(step, {
      profileId: input.profileId,
      contestId: input.contestId,
    });

    const [profile, contest] = await Promise.all([
      prisma.universalProfile.findUnique({
        where: { id: input.profileId },
        include: { creatorCompetitor: true },
      }),
      prisma.rankIQContest.findUnique({
        where: { id: input.contestId },
        include: {
          week: true,
          entries: { include: { rankableEntry: true } },
          submissions: {
            where: { universalProfileId: input.profileId },
            include: { picks: true },
          },
        },
      }),
    ]);

    step = "contest_lookup";
    if (!profile || profile.profileType !== "CREATOR" || !contest) {
      logBoardStep(step, {
        profileId: input.profileId,
        contestId: input.contestId,
        foundProfile: Boolean(profile),
        profileType: profile?.profileType ?? null,
        foundContest: Boolean(contest),
      });
      return { notFound: true };
    }

    const weekId =
      typeof input.weekId === "string" && input.weekId
        ? input.weekId
        : contest.weekId;

    step = "week_lookup";
    logBoardStep(step, {
      profileId: profile.id,
      contestId: contest.id,
      weekId,
      position: contest.position,
      rankingDepth: contest.rankingDepth,
    });

    step = "prior_snapshot_lookup";
    const [snapshots, weekContests] = await Promise.all([
      prisma.benchmarkSnapshot.findMany({
        where: { contestId: contest.id, universalProfileId: profile.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          captureType: true,
          status: true,
          late: true,
          sourceUrl: true,
          capturedAt: true,
          sourcePublishedAt: true,
        },
      }),
      prisma.rankIQContest.findMany({
        where: { weekId },
        select: { id: true, position: true },
      }),
    ]);

    step = "prior_submission_lookup";
    const submission = contest.submissions[0] ?? null;
    logBoardStep(step, {
      profileId: profile.id,
      contestId: contest.id,
      position: contest.position,
      snapshotCount: snapshots.length,
      submissionStatus: submission?.status ?? null,
      submissionPickCount: submission?.picks.length ?? 0,
    });

    step = "pool_build";
    const eligible = contest.entries
      .filter((entry) => !entry.excluded)
      .map((entry) =>
        toEligibleParserEntry({
          id: entry.rankableEntryId,
          name: entry.rankableEntry.name,
          team: entry.rankableEntry.team,
          shortName: entry.rankableEntry.shortName,
          adminNotes: entry.rankableEntry.adminNotes,
        }),
      );
    logBoardStep(step, {
      profileId: profile.id,
      contestId: contest.id,
      position: contest.position,
      rankingDepth: contest.rankingDepth,
      eligibleCount: eligible.length,
      entryCount: contest.entries.length,
    });

    step = "timing_state";
    let thursdayEligibleCount = 0;
    let thursdayStartedCount = 0;
    for (const entry of contest.entries) {
      if (entry.excluded) continue;
      const kickoff = entry.rankableEntry.gameStartsAt;
      if (!isThursdayKickoff(kickoff)) continue;
      thursdayEligibleCount += 1;
      if (kickoff && now.getTime() >= kickoff.getTime()) {
        thursdayStartedCount += 1;
      }
    }
    const hasThursdaySnapshot = snapshots.some(
      (snap) => snap.captureType === "THURSDAY" && snap.status !== "NOT_AVAILABLE",
    );
    const fullLockPassed = Boolean(
      contest.week.fullLockAt &&
        now.getTime() >= contest.week.fullLockAt.getTime(),
    );

    let timingNotice: CreatorBoardTimingNotice | null = null;
    if (fullLockPassed && submission?.status !== "LOCKED" && submission?.status !== "GRADED") {
      timingNotice = {
        kind: "full_lock_passed",
        message:
          "Sunday full lock has passed. New captures are LATE and will not create an official scoring board. You can still store a LATE snapshot for evidence.",
        thursdayEligibleCount,
        thursdayStartedCount,
      };
    } else if (
      thursdayStartedCount > 0 &&
      !hasThursdaySnapshot &&
      submission?.status !== "LOCKED" &&
      submission?.status !== "GRADED"
    ) {
      timingNotice = {
        kind: "thursday_started_no_snapshot",
        message: `${thursdayStartedCount} Thursday-kickoff eligible ${contest.position} player(s) have already started and there is no Thursday snapshot for this creator. Sunday official lock may be incomplete for those players — capture a Thursday draft before kickoff when possible, or import only unlocked players.`,
        thursdayEligibleCount,
        thursdayStartedCount,
      };
    }
    logBoardStep(step, {
      profileId: profile.id,
      contestId: contest.id,
      position: contest.position,
      thursdayEligibleCount,
      thursdayStartedCount,
      hasThursdaySnapshot,
      fullLockPassed,
      timingNotice: timingNotice?.kind ?? null,
    });

    step = "coverage_lookup";
    let coverage: CreatorCoverageDashboard | null = null;
    try {
      coverage = await getCreatorRankingCoverage(weekId);
    } catch (error) {
      logBoardStep(
        step,
        {
          profileId: profile.id,
          contestId: contest.id,
          weekId,
          error:
            error instanceof Error ? error.message.slice(0, 200) : "coverage_failed",
        },
        "error",
      );
      coverage = null;
    }

    step = "form_prop_construction";
    const personName = profile.creatorCompetitor?.personName ?? null;
    const brandName = profile.creatorCompetitor?.brandName ?? null;
    const primaryName = formatCreatorPrimaryName({
      displayName: profile.displayName,
      personName,
      brandName,
    });
    const affiliationBadge =
      formatCreatorAffiliationBadge({
        displayName: profile.displayName,
        personName,
        brandName,
      }) ?? "CREATOR";

    const contestByPosition = new Map(
      weekContests.map((row) => [row.position, row.id]),
    );
    const next =
      coverage != null
        ? findNextCreatorImportTarget({
            rows: coverage.rows,
            contestByPosition,
            afterProfileId: profile.id,
            afterPosition: contest.position,
          })
        : null;
    const nextHref = next
      ? `/admin/creators/board/${next.profileId}/${next.contestId}?weekId=${weekId}`
      : null;

    const latest = snapshots[0] ?? null;
    const model: CreatorBoardPageModel = {
      profileId: profile.id,
      contestId: contest.id,
      weekId,
      position: contest.position,
      rankingDepth: contest.rankingDepth,
      weekLabel: contest.week.label,
      contestTitle: contest.title,
      primaryName,
      brandName,
      affiliationBadge,
      competitorActive: profile.competitorActive,
      defaultSourceUrl:
        latest?.sourceUrl ?? profile.creatorCompetitor?.sourceUrl ?? null,
      fullLockAt: contest.week.fullLockAt,
      eligible,
      eligibleCount: eligible.length,
      latestSnapshotId: latest?.id ?? null,
      latestSourceUrl: latest?.sourceUrl ?? null,
      latestSourcePublishedAt: latest?.sourcePublishedAt ?? null,
      latestCapturedAt: latest?.capturedAt ?? null,
      hasOfficialBoard:
        submission?.status === "LOCKED" || submission?.status === "GRADED",
      submissionStatus: submission?.status ?? null,
      snapshots,
      positionLinks: CONTEST_POSITIONS.flatMap((position) => {
        const id = contestByPosition.get(position);
        return id ? [{ position, contestId: id }] : [];
      }),
      nextHref,
      timingNotice,
    };

    logBoardStep(step, {
      profileId: profile.id,
      contestId: contest.id,
      position: contest.position,
      rankingDepth: contest.rankingDepth,
      eligibleCount: model.eligibleCount,
      // Client props intentionally exclude global universe catalogs.
      clientUniverseCount: 0,
      clientOtherPositionCount: 0,
      hasOfficialBoard: model.hasOfficialBoard,
      snapshotCount: snapshots.length,
    });

    return model;
  } catch (error) {
    logBoardStep(
      step,
      {
        profileId: input.profileId,
        contestId: input.contestId,
        error:
          error instanceof Error ? error.message.slice(0, 300) : "unknown_error",
      },
      "error",
    );
    throw error;
  }
}
