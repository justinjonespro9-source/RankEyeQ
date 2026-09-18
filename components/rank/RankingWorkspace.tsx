"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ContestStatusPanel } from "@/components/rank/ContestStatus";
import { PlayerPool } from "@/components/rank/PlayerPool";
import { RankingBoard } from "@/components/rank/RankingBoard";
import { ResultsComparison } from "@/components/rank/ResultsComparison";
import { Button } from "@/components/ui/Button";
import type { PlayerPoolSortKey } from "@/lib/rank/player-pool-search";
import {
  boardDepthBadgeLabel,
  boardFullMessage,
  yourBoardTitle,
} from "@/lib/ranking-depth-copy";
import {
  saveDraftAction,
  submitRankingsAction,
} from "@/lib/submission-actions";
import { reorderAroundLockedSlots } from "@/lib/timing/partial-lock";
import { isSelectableUiAvailability } from "@/lib/eligibility/weekly-status";
import type { PositionChallenge, RankingPlayer } from "@/types/contest";

export type ParticipationState = "signed-out" | "needs-setup" | "ready";

function resolvePlayersFromPool(
  pool: RankingPlayer[],
  ids: (string | null)[],
): (RankingPlayer | null)[] {
  const byId = new Map(pool.map((player) => [player.id, player]));
  return ids.map((id) => (id ? (byId.get(id) ?? null) : null));
}

export function RankingWorkspace({
  challenge,
  players,
  contestId,
  contestStatus,
  participation,
  initialRankedEntryIds,
  initialSubmissionStatus,
  initialLockedEntryIds = [],
  kickoffLockedEntryIds = [],
  canEditUnlocked = true,
  fullBoardLocked = false,
  lockLabel,
  researchWindowLabel,
  gradedBreakdown,
  consensusPublic = false,
  consensusHref,
  consensusUnlockLabel = null,
}: {
  challenge: PositionChallenge;
  players: RankingPlayer[];
  contestId: string | null;
  contestStatus: string;
  participation: ParticipationState;
  initialRankedEntryIds: (string | null)[];
  initialSubmissionStatus: string;
  initialLockedEntryIds?: string[];
  kickoffLockedEntryIds?: string[];
  canEditUnlocked?: boolean;
  fullBoardLocked?: boolean;
  lockLabel?: string | null;
  researchWindowLabel?: string;
  gradedBreakdown?: {
    predicted: RankingPlayer[];
    actualByPlayerId: Record<string, number>;
  };
  /** True when Community EYEQ is publicly visible (fullLockAt / historical). */
  consensusPublic?: boolean;
  consensusHref?: string;
  /** Formatted unlock time from Week.fullLockAt / revealStartsAt. */
  consensusUnlockLabel?: string | null;
}) {
  const [rankedEntryIds, setRankedEntryIds] = useState<(string | null)[]>(
    () =>
      initialRankedEntryIds.length === challenge.slotCount
        ? initialRankedEntryIds
        : Array.from({ length: challenge.slotCount }, (_, index) =>
            initialRankedEntryIds[index] ?? null,
          ),
  );
  const [lockedEntryIds, setLockedEntryIds] = useState(
    () => new Set(initialLockedEntryIds),
  );
  const [submissionStatus, setSubmissionStatus] = useState(
    initialSubmissionStatus,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [pending, startTransition] = useTransition();
  const [poolFilters, setPoolFilters] = useState<{
    query: string;
    teamFilter: string;
    sortKey: PlayerPoolSortKey;
  }>({ query: "", teamFilter: "", sortKey: "name" });

  const slots = useMemo(
    () => resolvePlayersFromPool(players, rankedEntryIds),
    [players, rankedEntryIds],
  );

  const rankedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of rankedEntryIds) {
      if (id) ids.add(id);
    }
    return ids;
  }, [rankedEntryIds]);

  const kickoffLockedPoolIds = useMemo(
    () => new Set(kickoffLockedEntryIds),
    [kickoffLockedEntryIds],
  );

  const effectiveLockedEntryIds = useMemo(() => {
    const set = new Set(lockedEntryIds);
    for (const id of rankedEntryIds) {
      if (!id) continue;
      if (kickoffLockedPoolIds.has(id)) set.add(id);
    }
    return set;
  }, [lockedEntryIds, rankedEntryIds, kickoffLockedPoolIds]);

  const lockedIndexes = useMemo(() => {
    const indexes = new Set<number>();
    rankedEntryIds.forEach((id, index) => {
      if (id && effectiveLockedEntryIds.has(id)) indexes.add(index);
    });
    return indexes;
  }, [rankedEntryIds, effectiveLockedEntryIds]);

  const filledCount = rankedEntryIds.filter(Boolean).length;
  const allFilled = filledCount === challenge.slotCount;
  const scoringDepth = challenge.scoringDepth;
  const reserveCount = challenge.reserveCount;
  const boardTitle = yourBoardTitle(
    challenge.shortLabel,
    scoringDepth,
    reserveCount,
  );
  const depthLabel = boardDepthBadgeLabel(scoringDepth, reserveCount);

  const contestOpen =
    contestStatus === "DRAFT" ||
    contestStatus === "OPEN" ||
    contestStatus === "open" ||
    ((contestStatus === "LOCKED" || contestStatus === "locked") &&
      canEditUnlocked &&
      !fullBoardLocked);
  const submissionEditable =
    submissionStatus === "DRAFT" ||
    submissionStatus === "SUBMITTED" ||
    submissionStatus === "draft" ||
    submissionStatus === "submitted" ||
    ((submissionStatus === "LOCKED" || submissionStatus === "locked") &&
      canEditUnlocked &&
      !fullBoardLocked);
  const canPersist = participation === "ready" && Boolean(contestId);
  const editable =
    canPersist && contestOpen && submissionEditable && canEditUnlocked;
  const canSubmit = editable && allFilled && !pending;
  const showGraded =
    contestStatus === "FINAL" || submissionStatus === "GRADED";
  const submitted =
    submissionStatus.toUpperCase() === "SUBMITTED" ||
    submissionStatus.toUpperCase() === "LOCKED" ||
    submissionStatus.toUpperCase() === "GRADED";

  function updateLocal(next: (string | null)[]) {
    setRankedEntryIds(next);
  }

  function persistDraft(next: (string | null)[], message = "Progress saved") {
    if (!contestId || !editable) return;
    updateLocal(next);
    startTransition(async () => {
      const result = await saveDraftAction({
        contestId,
        rankedEntryIds: next,
        position: challenge.position,
      });
      if (!result.ok) {
        setStatusMessage(result.error);
        return;
      }
      setSubmissionStatus(result.status);
      if (result.lockedEntryIds) {
        setLockedEntryIds(new Set(result.lockedEntryIds));
      }
      setStatusMessage(message);
    });
  }

  function addPlayer(player: RankingPlayer) {
    if (!editable) return;
    if (rankedIds.has(player.id)) return;
    if (allFilled) {
      setStatusMessage(boardFullMessage(scoringDepth, reserveCount));
      return;
    }
    if (kickoffLockedPoolIds.has(player.id)) {
      setStatusMessage("Cannot add a player after their game has started.");
      return;
    }
    if (!isSelectableUiAvailability(player.availability)) {
      setStatusMessage(
        `Cannot add ${player.name} — status is ${player.availability.toUpperCase()}.`,
      );
      return;
    }
    const next = [...rankedEntryIds];
    const emptyIndex = next.findIndex(
      (id, index) => id === null && !lockedIndexes.has(index),
    );
    if (emptyIndex < 0) {
      setStatusMessage(boardFullMessage(scoringDepth, reserveCount));
      return;
    }
    next[emptyIndex] = player.id;
    persistDraft(next, `Added ${player.name}`);
  }

  function removeAt(index: number) {
    if (!editable || lockedIndexes.has(index)) return;
    const next = [...rankedEntryIds];
    next[index] = null;
    persistDraft(next, "Player removed");
  }

  function reorder(fromIndex: number, toIndex: number) {
    if (!editable) return;
    const next = reorderAroundLockedSlots(
      rankedEntryIds,
      fromIndex,
      toIndex,
      lockedIndexes,
    );
    persistDraft(next, "Order updated");
  }

  function handleSaveDraft() {
    if (!editable) return;
    persistDraft(rankedEntryIds, "Progress saved");
  }

  function handleConfirmSubmit() {
    if (!contestId || !canSubmit) return;
    startTransition(async () => {
      const result = await submitRankingsAction({
        contestId,
        rankedEntryIds,
        position: challenge.position,
      });
      if (!result.ok) {
        setStatusMessage(result.error);
        setConfirmSubmit(false);
        return;
      }
      setSubmissionStatus(result.status);
      if (result.lockedEntryIds) {
        setLockedEntryIds(new Set(result.lockedEntryIds));
      }
      setStatusMessage("Rankings submitted");
      setConfirmSubmit(false);
    });
  }

  if (!contestId) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning-soft/50 px-4 py-6 text-sm text-muted">
        This position challenge is not available in the database yet.
      </div>
    );
  }

  const consensusPanel =
    consensusHref != null ? (
      <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
        {consensusPublic ? (
          <>
            <p className="font-medium text-ink">Consensus is public</p>
            <p className="mt-1">
              Compare your {depthLabel} board with pregame predictions from
              Humans, Creators, Experts/Publishers, AI, and group-weighted All.
              Individual competitor boards still follow their own reveal rules.
            </p>
            <div className="mt-3">
              <Button href={consensusHref} variant="secondary" size="sm">
                Compare With Consensus
              </Button>
            </div>
          </>
        ) : submitted ? (
          <>
            <p className="font-medium text-ink">
              Board submitted
              {fullBoardLocked ? " · rankings locked" : ""}
            </p>
            <p className="mt-1">
              Crowd Consensus stays hidden until{" "}
              {consensusUnlockLabel ?? "Sunday lock"}. Kickoff-locked players
              cannot be edited; unlocked slots stay editable until that lock.
              Make your call before you see where Humans, Experts, and AI land.
            </p>
            <div className="mt-3">
              <Button href={consensusHref} variant="secondary" size="sm">
                Consensus timing
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-medium text-ink">Consensus still hidden</p>
            <p className="mt-1">
              Community EYEQ unlocks at{" "}
              {consensusUnlockLabel ?? "the configured Sunday lock"}. Submit your
              own board first — make your prediction before seeing where Humans,
              Experts, and AI land. Individual boards keep their existing reveal
              rules.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button href="#my-rankings-heading" size="sm">
                Build Your Rankings
              </Button>
              <Button href={consensusHref} variant="secondary" size="sm">
                Consensus timing
              </Button>
            </div>
          </>
        )}
      </div>
    ) : null;

  const rankingPanel = (
    <div className="space-y-4">
      {consensusPanel}

      {!editable && participation === "ready" ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          {fullBoardLocked
            ? `Rankings Locked${lockLabel ? ` · ${lockLabel}` : ""}. Only submitted weekly boards compete; unsubmitted in-progress saves do not. Kickoff-locked players stay fixed.`
            : "Rankings Locked — contest or submission state prevents edits. Only submitted weekly boards compete."}
        </div>
      ) : editable ? (
        <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
          <p className="font-medium text-ink">Board Open</p>
          <p className="mt-1">
            Players lock individually at their NFL kickoff. Remaining unlocked
            slots close at the Sunday lock
            {lockLabel ? ` (${lockLabel})` : " (10:00 AM CT)"}. Required
            submission: {depthLabel}.
          </p>
          {lockedIndexes.size > 0 ? (
            <p className="mt-2 text-warning">
              Some selections are locked because their games have started (
              {lockedIndexes.size} locked). Unlocked slots remain editable —
              locked players cannot be moved.
            </p>
          ) : null}
        </div>
      ) : null}

      <RankingBoard
        slots={slots}
        slotCount={challenge.slotCount}
        scoringDepth={scoringDepth}
        reserveCount={reserveCount}
        title={boardTitle}
        editable={editable && !pending}
        lockedIndexes={lockedIndexes}
        onReorder={reorder}
        onRemove={removeAt}
      />

      <div className="space-y-3 rounded-lg border border-border bg-surface-elevated p-4 sm:p-5">
        <ContestStatusPanel
          challenge={challenge}
          contestStatus={contestStatus}
          submissionStatus={submissionStatus}
          filledCount={filledCount}
          editable={editable}
          partialKickoffLocks={lockedIndexes.size > 0}
          fullBoardLocked={fullBoardLocked}
        />

        <div className="hidden flex-col gap-2 lg:flex lg:flex-row">
          {participation === "signed-out" ? (
            <Button
              href={`/signin?callbackUrl=/rank/${challenge.position}`}
              className="flex-1"
            >
              Sign in to build rankings
            </Button>
          ) : participation === "needs-setup" ? (
            <Button href="/account/setup" className="flex-1">
              Finish profile setup
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 flex-1"
                onClick={handleSaveDraft}
                disabled={!editable || pending}
              >
                Save Progress
              </Button>
              <Button
                type="button"
                className="min-h-11 flex-1"
                onClick={() => setConfirmSubmit(true)}
                disabled={!canSubmit}
              >
                Submit Rankings
              </Button>
            </>
          )}
        </div>

        {statusMessage ? (
          <p className="text-sm text-accent-ink" role="status">
            {statusMessage}
          </p>
        ) : null}
      </div>
    </div>
  );

  const mobileActionBar = (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-elevated/95 px-4 pt-3 shadow-[0_-8px_24px_rgba(10,28,45,0.08)] backdrop-blur lg:hidden"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
        <p className="text-center text-xs text-muted">
          {filledCount} / {challenge.slotCount} names · {depthLabel}
          {submitted ? " · Submitted" : ""}
        </p>
        <div className="flex gap-2">
          {participation === "signed-out" ? (
            <Button
              href={`/signin?callbackUrl=/rank/${challenge.position}`}
              className="min-h-11 flex-1"
            >
              Sign in to build rankings
            </Button>
          ) : participation === "needs-setup" ? (
            <Button href="/account/setup" className="min-h-11 flex-1">
              Finish profile setup
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 flex-1"
                onClick={handleSaveDraft}
                disabled={!editable || pending}
              >
                Save
              </Button>
              <Button
                type="button"
                className="min-h-11 flex-1"
                onClick={() => setConfirmSubmit(true)}
                disabled={!canSubmit}
              >
                Submit
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const poolProps = {
    players,
    rankedIds,
    disabled: !editable || pending,
    allFilled,
    kickoffLockedIds: kickoffLockedPoolIds,
    onAdd: addPlayer,
    teams: [...new Set(players.map((player) => player.team))].sort(),
    researchWindowLabel,
    slotCount: challenge.slotCount,
    scoringDepth,
    reserveCount,
    filterState: poolFilters,
    onFilterStateChange: setPoolFilters,
  };

  return (
    <div className="space-y-6">
      {participation === "signed-out" ? (
        <div className="rounded-lg border border-border bg-surface-elevated px-4 py-4 text-sm text-muted">
          You can browse this contest.{" "}
          <Link
            href={`/signin?callbackUrl=/rank/${challenge.position}`}
            className="font-medium text-accent-ink hover:underline"
          >
            Sign in
          </Link>{" "}
          to save and submit rankings on your UniversalProfile.
        </div>
      ) : null}
      {participation === "needs-setup" ? (
        <div className="rounded-lg border border-border bg-surface-elevated px-4 py-4 text-sm text-muted">
          Finish creating your RankEyeQ profile before participating.{" "}
          <Link
            href="/account/setup"
            className="font-medium text-accent-ink hover:underline"
          >
            Complete profile setup
          </Link>
        </div>
      ) : null}

      {showGraded && gradedBreakdown ? (
        <ResultsComparison
          predicted={gradedBreakdown.predicted}
          pool={players}
          scoringDepth={scoringDepth}
          actualFinishes={gradedBreakdown.actualByPlayerId}
        />
      ) : null}

      <div
        className="sticky z-30 -mx-4 border-b border-border bg-surface/95 px-4 py-1.5 backdrop-blur lg:hidden"
        style={{ top: "calc(4rem + env(safe-area-inset-top, 0px))" }}
        aria-live="polite"
      >
        <p className="text-xs font-medium text-ink sm:text-sm">
          {filledCount} / {challenge.slotCount} names · {boardTitle}
        </p>
      </div>

      <div className="space-y-4 pb-28 lg:hidden">
        <PlayerPool {...poolProps} mode="toolbar" />
        {rankingPanel}
        <PlayerPool
          {...poolProps}
          mode="list"
          listClassName="max-h-[min(28rem,55vh)]"
        />
      </div>

      {mobileActionBar}

      <div className="hidden gap-6 overflow-x-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
        <div className="min-h-0">
          <PlayerPool {...poolProps} />
        </div>
        <div>{rankingPanel}</div>
      </div>

      {confirmSubmit ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-confirm-title"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface-elevated p-5 shadow-lg">
            <h3
              id="submit-confirm-title"
              className="font-display text-xl font-semibold text-ink"
            >
              Submit {challenge.shortLabel} rankings?
            </h3>
            <p className="mt-2 text-sm text-muted">
              Only explicitly submitted rankings compete when the contest locks.
              Required board: {depthLabel} ({challenge.slotCount} submitted
              names). Kickoff-locked players stay in place. You can still edit
              unlocked slots until the Sunday lock
              {lockLabel ? ` (${lockLabel})` : ""}.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmSubmit(false)}
                disabled={pending}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={pending}
              >
                Confirm submit
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
