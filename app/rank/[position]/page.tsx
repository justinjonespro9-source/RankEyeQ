import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { AdPlacement } from "@/components/sponsors/AdPlacement";
import { RankingWorkspace } from "@/components/rank/RankingWorkspace";
import { ScoringRulesDetails } from "@/components/rank/ScoringRulesDetails";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getAuthContext } from "@/lib/auth/session";
import { parsePositionParam } from "@/lib/contest";
import { contestAllowsRankingEdits } from "@/lib/contest-lifecycle";
import { getPublicPositionContest } from "@/lib/contests";
import { logServerEvent } from "@/lib/log";
import {
  getOrCreateDraftSubmission,
  getSubmissionForProfile,
  picksToRankedIds,
} from "@/lib/submissions";
import {
  ensureWeekFullLock,
  healPrematureWeekLocks,
} from "@/lib/timing/apply-locks";
import { formatInChicago } from "@/lib/timing/chicago";
import { getWeekTimingState } from "@/lib/timing/week-windows";
import { kickoffLockedEntryIdsFromMap } from "@/lib/timing/kickoff-locks";
import {
  parsePlayerResearchWindow,
  researchWindowLabel,
} from "@/lib/player-research";
import {
  NO_INDEX,
  canonicalMetadata,
  rankPositionCanonicalPath,
} from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/rank/[position]">,
): Promise<Metadata> {
  const { position: rawPosition } = await props.params;
  const position = parsePositionParam(rawPosition);
  if (!position) {
    return { title: "Challenge", ...NO_INDEX };
  }
  const canonicalPath = rankPositionCanonicalPath(position);
  try {
    const { challenge } = await getPublicPositionContest(position);
    return {
      title: `${challenge.shortLabel} Rankings`,
      description: `Weekly ${challenge.shortLabel} rankings for this NFL slate — Top ${challenge.slotCount}. Rank before kickoff; graded against that week's actual fantasy-point finishes.`,
      ...NO_INDEX,
      ...canonicalMetadata(canonicalPath),
    };
  } catch {
    return {
      title: "Challenge",
      description:
        "Weekly NFL position rankings on RankEyeQ — rank before kickoff.",
      ...NO_INDEX,
      ...canonicalMetadata(canonicalPath),
    };
  }
}

export default async function PositionRankPage(
  props: PageProps<"/rank/[position]">,
) {
  const { position: rawPosition } = await props.params;
  const searchParams = await props.searchParams;
  const researchWindow =
    typeof searchParams.window === "string" ? searchParams.window : undefined;

  const position = parsePositionParam(rawPosition);
  if (!position) {
    logServerEvent(
      "rank.position_invalid",
      {
        route: "/rank/[position]",
        rawPosition:
          typeof rawPosition === "string" ? rawPosition.slice(0, 16) : null,
      },
      "warn",
    );
    notFound();
  }

  // Use canonical lowercase Position for all data lookups. Do not redirect for
  // casing alone — on case-insensitive hosts (/rank/QB vs /rank/qb) a redirect
  // can no-op and strand the client on loading.tsx.

  let contestData;
  let authCtx;
  try {
    [contestData, authCtx] = await Promise.all([
      getPublicPositionContest(position, { researchWindow }),
      getAuthContext(),
    ]);
  } catch (error) {
    logServerEvent(
      "rank.page_load_failed",
      {
        route: "/rank/[position]",
        position,
        researchWindow: researchWindow ?? null,
        step: "contest_or_auth",
        message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      },
      "error",
    );
    throw error;
  }

  const {
    challenge,
    players,
    contestId,
    contestStatus,
    source,
    actualFinishes,
    weekId,
    weekNumber,
    seasonYear,
    weekStatus,
    rankingsOpenAt,
    fullLockAt,
    revealStartsAt,
    publicReleaseAt,
    kickoffByEntryId,
  } = contestData;

  if (weekId) {
    try {
      // Heal stale Contest.status=LOCKED / submission LOCKED before Sunday full lock.
      await healPrematureWeekLocks(weekId);
      await ensureWeekFullLock(weekId);
    } catch (error) {
      logServerEvent(
        "rank.lock_sync_failed",
        {
          route: "/rank/[position]",
          position,
          weekId,
          message:
            error instanceof Error ? error.message.slice(0, 160) : "unknown",
        },
        "warn",
      );
      // Non-fatal: continue with existing timing; lock sync can retry next request.
    }
  }

  // Prefer Week.fullLockAt over stale Contest.status for board editability.
  // After healPrematureWeekLocks, LOCKED contests are reopened when before fullLockAt;
  // still treat premature LOCKED as editable if heal failed.
  const requestNow = new Date();
  const kickoffLockedEntryIds = kickoffLockedEntryIdsFromMap(
    kickoffByEntryId,
    requestNow,
  );
  const anyKickoffStarted = kickoffLockedEntryIds.length > 0;

  const timing = getWeekTimingState({
    rankingsOpenAt,
    fullLockAt,
    revealStartsAt,
    publicReleaseAt,
    weekStatus,
    anyKickoffStarted,
    now: requestNow,
  });

  const boardEditableByWeek = contestAllowsRankingEdits({
    contestStatus,
    fullBoardLocked: timing.fullBoardLocked,
    fullLockAt,
    now: requestNow,
  });
  // Display OPEN when week timing still allows edits even if status row was stale LOCKED.
  const displayContestStatus =
    contestStatus === "LOCKED" &&
    fullLockAt &&
    requestNow < fullLockAt &&
    timing.canEditUnlocked
      ? "OPEN"
      : contestStatus;

  const profile = authCtx?.universalProfile ?? null;
  const participation =
    !authCtx
      ? ("signed-out" as const)
      : !profile
        ? ("needs-setup" as const)
        : ("ready" as const);

  let initialRankedEntryIds: (string | null)[] = Array.from(
    { length: challenge.slotCount },
    () => null,
  );
  let initialSubmissionStatus = "DRAFT";
  let initialLockedEntryIds: string[] = [];
  let gradedPredicted = players.slice(0, 0);

  const canCreateOrEdit =
    Boolean(contestId) && boardEditableByWeek && timing.canEditUnlocked;

  if (contestId && profile && participation === "ready") {
    try {
      const submission = canCreateOrEdit
        ? await getOrCreateDraftSubmission(contestId, profile.id)
        : await getSubmissionForProfile(contestId, profile.id);
      if (submission) {
        initialRankedEntryIds = picksToRankedIds(
          submission.picks,
          challenge.slotCount,
        );
        // Premature LOCKED before global lock displays/behaves as SUBMITTED.
        initialSubmissionStatus =
          submission.status === "LOCKED" && timing.canEditUnlocked
            ? "SUBMITTED"
            : submission.status;
        // Only kickoff-locked (or full-board) picks are immutable — not OUT status.
        initialLockedEntryIds = submission.picks
          .filter((pick) => {
            if (!pick.slotLocked) return false;
            const kickoffIso = kickoffByEntryId[pick.rankableEntryId];
            if (kickoffIso && new Date(kickoffIso) <= requestNow) return true;
            return timing.fullBoardLocked;
          })
          .map((pick) => pick.rankableEntryId);
        gradedPredicted = submission.picks.map((pick) => {
          const player = players.find((p) => p.id === pick.rankableEntryId);
          return (
            player ?? {
              id: pick.rankableEntryId,
              name: pick.rankableEntry.name,
              team: pick.rankableEntry.team,
              opponent: pick.rankableEntry.opponent,
              position,
              gameDay: "",
              gameTime: "",
              availability: "active" as const,
            }
          );
        });
      }
    } catch (error) {
      logServerEvent(
        "rank.submission_load_failed",
        {
          route: "/rank/[position]",
          position,
          weekId: weekId ?? null,
          contestId,
          step: "submission",
          message:
            error instanceof Error ? error.message.slice(0, 160) : "unknown",
        },
        "error",
      );
      throw error;
    }
  }

  const parsedWindow = parsePlayerResearchWindow(
    researchWindow,
    weekNumber ?? 1,
  );
  const windowLabel =
    seasonYear != null
      ? researchWindowLabel(parsedWindow, seasonYear)
      : undefined;

  const researchWindowLinks: { key: string; label: string }[] = [];
  if (weekNumber != null && weekNumber > 1) {
    researchWindowLinks.push({ key: "season", label: "Season" });
    researchWindowLinks.push({ key: "last3", label: "Last 3" });
    for (let week = weekNumber - 1; week >= 1; week -= 1) {
      researchWindowLinks.push({ key: `week-${week}`, label: `Wk ${week}` });
    }
  }

  // Empty pool is a real empty state — never leave Suspense hanging.
  if (players.length === 0) {
    return (
      <Container className="py-8 sm:py-12">
        <EmptyState
          title={`No ${challenge.shortLabel} players yet`}
          description={`${challenge.weekLabel} ${challenge.shortLabel} does not have an eligible pool yet. Check back when the weekly contest is configured.`}
          actionHref="/rank"
          actionLabel="Back to weekly rankings"
        />
      </Container>
    );
  }

  return (
    <Container className="py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="neutral">{challenge.weekLabel}</Badge>
          <Badge tone="success">Top {challenge.slotCount}</Badge>
          <Badge tone="neutral">{players.length} players</Badge>
          <Badge tone={source === "database" ? "success" : "warning"}>
            {source === "database" ? "Persisted pool" : "Mock pool"}
          </Badge>
          <Badge tone="neutral">{displayContestStatus}</Badge>
          <Badge tone={timing.fullBoardLocked ? "warning" : "success"}>
            {timing.phase}
          </Badge>
        </div>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {challenge.shortLabel} · Weekly rankings
        </h1>
        <p className="mt-2 max-w-2xl text-base text-muted">
          {challenge.description} Weekly contest for {challenge.weekLabel} —
          rankings reset next week. Not a draft board or season-long projection.
          Players lock at kickoff; remaining slots stay editable until Sunday
          10:00 AM America/Chicago. Only explicitly submitted boards compete.
        </p>
        {fullLockAt ? (
          <p className="mt-2 text-sm text-muted">
            Sunday lock:{" "}
            {formatInChicago(fullLockAt, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            })}
          </p>
        ) : null}
        {researchWindowLinks.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Research window:</span>
            {researchWindowLinks.map((link) => {
              const active =
                (researchWindow ?? "season") === link.key ||
                (!researchWindow && link.key === "season");
              const href =
                link.key === "season"
                  ? `/rank/${position}`
                  : `/rank/${position}?window=${link.key}`;
              return (
                <Link
                  key={link.key}
                  href={href}
                  className={`rounded-md px-2 py-1 ${
                    active
                      ? "bg-accent/15 font-medium text-accent-ink"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        ) : null}
      </header>

      <ScoringRulesDetails
        slotCount={challenge.slotCount}
        positionLabel={challenge.shortLabel}
      />

      <RankingWorkspace
        challenge={challenge}
        players={players}
        contestId={contestId}
        contestStatus={displayContestStatus}
        participation={participation}
        initialRankedEntryIds={initialRankedEntryIds}
        initialSubmissionStatus={initialSubmissionStatus}
        initialLockedEntryIds={initialLockedEntryIds}
        kickoffLockedEntryIds={kickoffLockedEntryIds}
        canEditUnlocked={timing.canEditUnlocked && boardEditableByWeek}
        fullBoardLocked={timing.fullBoardLocked}
        researchWindowLabel={windowLabel}
        lockLabel={
          fullLockAt
            ? formatInChicago(fullLockAt, {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })
            : null
        }
        gradedBreakdown={
          Object.keys(actualFinishes).length > 0 && gradedPredicted.length > 0
            ? {
                predicted: gradedPredicted,
                actualByPlayerId: actualFinishes,
              }
            : undefined
        }
      />

      <AdPlacement placementKey="rank_sidebar" className="mt-8 sm:mt-10" />
    </Container>
  );
}
