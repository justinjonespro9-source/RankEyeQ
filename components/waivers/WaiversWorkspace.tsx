"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { WaiverLockClock } from "@/components/waivers/WaiverLockClock";
import { saveWaiverDraftAction, submitWaiverBoardAction } from "@/lib/waivers/actions";
import type { WaiverPosition } from "@/lib/waivers/constants";
import {
  WAIVER_EYEQ_FUTURE_COPY,
  WAIVER_NO_BOARD_AFTER_LOCK,
  WAIVER_RESULTS_PENDING,
  addWaiverCall,
  formatRosteredPercent,
  formatWaiverMatchup,
  moveWaiverCall,
  removeWaiverCall,
  sameWaiverCalls,
  waiverAddBlockReason,
  waiverAvailabilityLabel,
  waiverBoardHint,
  waiverBoardSummary,
  waiverCallCountLabel,
  waiverSignInHref,
  waiverSlotLabels,
  waiverSubmitFeedback,
  type WaiverDraftSaveState,
} from "@/lib/waivers/play-model";
import type { WaiverPlayBoard, WaiverPlayPoolEntry } from "@/lib/waivers/play-queries";

export type WaiverParticipation = "signed-out" | "needs-setup" | "suspended" | "view-only" | "ready";

export type WaiverWorkspacePoolEntry = WaiverPlayPoolEntry & { kickoffLabel: string | null };

const DRAFT_SAVE_DELAY_MS = 1200;

// Survives the remount the page triggers when a submit changes the board key.
let carriedFeedback: { contestId: string; text: string } | null = null;

const ERROR_COPY: Record<string, string> = {
  LOCKED: "This position is locked. Boards can no longer be changed.",
  SIGNED_OUT: "Sign in to submit Waiver picks.",
  NEEDS_SETUP: "Finish profile setup to submit Waiver picks.",
  RATE_LIMITED: "Too many saves in a short time. Wait a moment and try again.",
  INVALID_BOARD: "That board isn't valid for the official pool. Reload and try again.",
  CONFLICT: "Your board changed in another window. Reload and try again.",
};

function errorMessage(result: { error: string; code?: string }) {
  return (result.code && ERROR_COPY[result.code]) || result.error;
}

type Props = {
  position: WaiverPosition;
  contestId: string;
  locked: boolean;
  locksAt: string;
  lockLabel: string;
  serverNow: string;
  availableSlots: number;
  pool: WaiverWorkspacePoolEntry[];
  board: WaiverPlayBoard | null;
  participation: WaiverParticipation;
  snapshotLabel: string | null;
  snapshotSource: string | null;
};

export function WaiversWorkspace(props: Props) {
  const { position, contestId, locked, availableSlots, pool, board, participation } = props;
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  const poolById = useMemo(() => new Map(pool.map((entry) => [entry.rankableEntryId, entry])), [pool]);
  const poolIds = useMemo(() => new Set(pool.map((entry) => entry.rankableEntryId)), [pool]);
  const boardCallIds = useMemo(() => (board?.calls ?? []).map((call) => call.rankableEntryId), [board]);
  const competitive = board?.status === "SUBMITTED" || board?.status === "ABSTAINED";
  const canPlay = participation === "ready" && !locked;

  const [calls, setCalls] = useState<string[]>(boardCallIds);
  const [revising, setRevising] = useState(false);
  const [pending, setPending] = useState(false);
  const [lockReached, setLockReached] = useState(false);
  const [confirmZero, setConfirmZero] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(() =>
    carriedFeedback?.contestId === contestId ? { tone: "info", text: carriedFeedback.text } : null,
  );
  const [draftState, setDraftState] = useState<WaiverDraftSaveState>(
    board?.status === "DRAFT" ? "saved" : "idle",
  );
  const [query, setQuery] = useState("");

  const editing = canPlay && !lockReached && (!competitive || revising);
  const draftMode = editing && !competitive;
  const affected = useMemo(() => new Set(board?.affectedEntryIds ?? []), [board]);
  const hasIneligibleCall = calls.some((id) => !poolIds.has(id));

  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftInFlight = useRef<Promise<unknown> | null>(null);
  const lastSavedDraft = useRef<string[]>(board?.status === "DRAFT" ? boardCallIds : []);
  const statusId = useId();

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  useEffect(() => {
    if (carriedFeedback?.contestId === contestId && !isRefreshing) carriedFeedback = null;
  }, [contestId, isRefreshing]);

  useEffect(() => {
    if (!draftMode || sameWaiverCalls(calls, lastSavedDraft.current) || calls.some((id) => !poolIds.has(id))) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      const snapshot = [...calls];
      setDraftState("saving");
      const run = saveWaiverDraftAction({ contestId, playerIds: snapshot }).then((result) => {
        if (result.ok) {
          lastSavedDraft.current = snapshot;
          setDraftState("saved");
        } else if (result.code !== "ALREADY_SUBMITTED") {
          setDraftState("error");
          if (result.code === "LOCKED") {
            setMessage({ tone: "error", text: errorMessage(result) });
            refresh();
          }
        }
      });
      draftInFlight.current = run.finally(() => {
        draftInFlight.current = null;
      });
    }, DRAFT_SAVE_DELAY_MS);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [calls, contestId, draftMode, poolIds, refresh]);

  function edit(result: ReturnType<typeof addWaiverCall>, announce?: string) {
    if (!result.ok) return;
    setCalls(result.calls);
    if (announce) setMessage({ tone: "info", text: announce });
  }

  function addCall(id: string) {
    const name = poolById.get(id)?.displayName ?? "Player";
    const result = addWaiverCall(calls, id, { availableSlots, poolIds });
    if (!result.ok) return;
    const label = waiverSlotLabels(availableSlots)[result.calls.length - 1];
    edit(result, `${name} added at ${label}. ${waiverCallCountLabel(result.calls.length, availableSlots)}.`);
  }

  function nameOf(id: string) {
    return poolById.get(id)?.displayName ?? board?.calls.find((call) => call.rankableEntryId === id)?.displayName ?? "Player";
  }

  async function submit() {
    setConfirmZero(false);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (draftInFlight.current) await draftInFlight.current;
    setPending(true);
    setMessage(null);
    const result = await submitWaiverBoardAction({ contestId, playerIds: calls });
    setPending(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: errorMessage(result) });
      if (result.code === "LOCKED") refresh();
      return;
    }
    setRevising(false);
    const text = waiverSubmitFeedback({ position, changed: result.changed, callCount: result.callCount, revised: revising });
    carriedFeedback = { contestId, text };
    setMessage({ tone: "info", text });
    refresh();
  }

  function onSubmitClick() {
    if (calls.length === 0) setConfirmZero(true);
    else void submit();
  }

  function startRevise() {
    setCalls(boardCallIds);
    setRevising(true);
    setMessage({ tone: "info", text: "Revising. Your submitted board stays official until you submit again." });
  }

  function cancelRevise() {
    setCalls(boardCallIds);
    setRevising(false);
    setMessage({ tone: "info", text: "Revision canceled. Your submitted board is unchanged." });
  }

  const onLockReached = useCallback(() => {
    setLockReached(true);
    refresh();
  }, [refresh]);

  const busy = pending || isRefreshing;
  const unchangedRevision = revising && sameWaiverCalls(calls, boardCallIds);
  const submitDisabled = !editing || busy || hasIneligibleCall || unchangedRevision;
  const submitLabel = revising ? "Submit Revised Picks" : "Submit Waiver Picks";
  const countLabel = waiverCallCountLabel(calls.length, availableSlots);

  const filteredPool = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (entry) => entry.displayName.toLowerCase().includes(q) || (entry.team ?? "").toLowerCase().includes(q),
    );
  }, [pool, query]);

  const boardSummary = waiverBoardSummary({
    signedIn: participation !== "signed-out",
    locked,
    boardStatus: board?.status ?? null,
    editable: draftMode,
    revising,
    draftSave: draftState,
    callCount: calls.length,
    availableSlots,
  });

  const participationNotice =
    participation === "signed-out" ? (
      <p>
        You can browse this week&apos;s pool.{" "}
        <Link href={waiverSignInHref(position)} className="font-medium text-accent-ink underline-offset-2 hover:underline">
          Sign in
        </Link>{" "}
        to make and submit Waiver picks.
      </p>
    ) : participation === "needs-setup" ? (
      <p>
        Finish creating your RankEyeQ profile to submit Waiver picks.{" "}
        <Link href="/account/setup" className="font-medium text-accent-ink underline-offset-2 hover:underline">
          Complete profile setup
        </Link>
      </p>
    ) : participation === "suspended" ? (
      <p>This profile is suspended and can&apos;t submit Waiver picks.</p>
    ) : participation === "view-only" ? (
      <p>This profile can view Waivers but can&apos;t submit Waiver picks.</p>
    ) : null;

  const slotLabels = waiverSlotLabels(availableSlots);

  const boardPanel = (
    <section aria-labelledby="waiver-board-heading" className="rounded-lg border border-border bg-surface-elevated p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="waiver-board-heading" className="font-display text-lg font-semibold text-ink">
            Your {position} calls
          </h3>
          <p className="text-sm text-muted">{boardSummary}</p>
        </div>
        {locked ? (
          <Badge tone="warning">Locked</Badge>
        ) : competitive && !revising ? (
          <Badge tone="success">Submitted</Badge>
        ) : participation === "ready" ? (
          <Badge tone="neutral">{revising ? "Revising" : "Draft"}</Badge>
        ) : null}
      </div>

      {locked ? (
        <LockedBoard board={board} participation={participation} position={position} />
      ) : (
        <>
          <ol className="mt-4 space-y-2" aria-label={`${position} board, ${countLabel}`}>
            {slotLabels.map((label, index) => {
              const id = calls[index];
              const entry = id ? poolById.get(id) : undefined;
              const ineligible = Boolean(id) && !poolIds.has(id);
              return (
                <li
                  key={label}
                  className={`flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 ${
                    id
                      ? ineligible
                        ? "border-warning/50 bg-warning-soft/40"
                        : index === 0
                          ? "border-accent/40 bg-accent-soft/30"
                          : "border-border bg-surface"
                      : "border-dashed border-border bg-surface/60"
                  }`}
                >
                  <span className="w-14 shrink-0 font-display text-xs font-semibold uppercase tracking-wide text-accent-ink">
                    {label}
                  </span>
                  {id ? (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{nameOf(id)}</span>
                        <span className="block truncate text-xs text-muted">
                          {ineligible
                            ? "No longer in the official pool — remove before submitting"
                            : [entry?.team, entry ? formatWaiverMatchup(entry.opponent, entry.matchupSide) : null, entry ? `${formatRosteredPercent(entry.rosteredBps)} rostered` : null]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                      </span>
                      {editing ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => edit(moveWaiverCall(calls, index, -1), `${nameOf(id)} moved to ${slotLabels[index - 1]}.`)}
                            disabled={index === 0 || busy}
                            aria-label={`Move ${nameOf(id)} up to ${slotLabels[index - 1] ?? label}`}
                            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border bg-surface-elevated text-sm font-semibold text-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30"
                          >
                            <span aria-hidden="true">▲</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => edit(moveWaiverCall(calls, index, 1), `${nameOf(id)} moved to ${slotLabels[index + 1]}.`)}
                            disabled={index === calls.length - 1 || busy}
                            aria-label={`Move ${nameOf(id)} down to ${slotLabels[index + 1] ?? label}`}
                            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border bg-surface-elevated text-sm font-semibold text-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30"
                          >
                            <span aria-hidden="true">▼</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => edit(removeWaiverCall(calls, index), `${nameOf(id)} removed. ${waiverCallCountLabel(calls.length - 1, availableSlots)}.`)}
                            disabled={busy}
                            aria-label={`Remove ${nameOf(id)} from ${label}`}
                            className="inline-flex min-h-10 items-center justify-center rounded-md px-2.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            Remove
                          </button>
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-sm text-muted">{index === calls.length && editing ? "Next call — add from the pool" : "Open slot"}</span>
                  )}
                </li>
              );
            })}
          </ol>

          {board?.needsReview && affected.size > 0 && !revising && competitive ? (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
              The official pool was corrected and a player on your board is no longer eligible. Revise before lock.
            </p>
          ) : null}

          {editing ? <p className="mt-3 text-sm text-muted">{waiverBoardHint(calls.length, availableSlots)}</p> : null}
          {competitive && !revising && board?.status === "ABSTAINED" ? (
            <p className="mt-3 text-sm text-muted">You submitted {position} with no calls — you&apos;re sitting this position out.</p>
          ) : null}

          <div className="mt-4 hidden flex-col gap-2 sm:flex-row lg:flex">
            <ActionButtons
              participation={participation}
              position={position}
              editing={editing}
              competitive={competitive}
              revising={revising}
              busy={busy}
              submitDisabled={submitDisabled}
              submitLabel={submitLabel}
              onSubmit={onSubmitClick}
              onRevise={startRevise}
              onCancel={cancelRevise}
              lockReached={lockReached}
            />
          </div>
          {submitDisabled && editing && hasIneligibleCall ? (
            <p className="mt-2 text-xs text-warning">Remove players no longer in the official pool to submit.</p>
          ) : submitDisabled && editing && unchangedRevision ? (
            <p className="mt-2 text-xs text-muted">Change your calls to submit a revision.</p>
          ) : null}
        </>
      )}

      <p id={statusId} className={`mt-3 text-sm ${message?.tone === "error" ? "text-danger" : "text-accent-ink"}`} role="status" aria-live="polite">
        {message?.text ?? ""}
      </p>
    </section>
  );

  const poolPanel = (
    <section aria-labelledby="waiver-pool-heading" className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="waiver-pool-heading" className="font-display text-lg font-semibold text-ink">
            Official {position} pool
          </h3>
          <p className="text-xs text-muted">
            {pool.length} eligible {pool.length === 1 ? "player" : "players"} · Rostered % frozen
            {props.snapshotLabel ? ` ${props.snapshotLabel}` : ""}
            {props.snapshotSource ? ` (${props.snapshotSource})` : ""}
          </p>
        </div>
      </div>
      <label className="mt-3 block">
        <span className="sr-only">Search the {position} pool</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search player or team"
          className="min-h-11 w-full rounded-md border border-border bg-surface-elevated px-3 text-sm text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      </label>
      {editing && calls.length >= availableSlots ? (
        <p className="mt-2 text-xs text-muted" role="note">
          Board full — remove a call to add someone else.
        </p>
      ) : null}
      <ul className="mt-3 max-h-[min(36rem,70vh)] divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface-elevated">
        {filteredPool.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted">No players match.</li> : null}
        {filteredPool.map((entry) => {
          const block = waiverAddBlockReason({ playerId: entry.rankableEntryId, calls, availableSlots });
          const slotIndex = calls.indexOf(entry.rankableEntryId);
          const availability = waiverAvailabilityLabel(entry.availabilityDesignation);
          return (
            <li key={entry.rankableEntryId} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{entry.displayName}</span>
                <span className="block truncate text-xs text-muted">
                  {[entry.team, formatWaiverMatchup(entry.opponent, entry.matchupSide), entry.kickoffLabel].filter(Boolean).join(" · ")}
                  {availability ? <span className="ml-1 font-medium text-warning">· {availability}</span> : null}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums text-muted">
                <span className="font-semibold text-ink">{formatRosteredPercent(entry.rosteredBps)}</span> rostered
              </span>
              {editing ? (
                block === "ON_BOARD" ? (
                  <span className="inline-flex min-h-10 w-20 shrink-0 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-ink">
                    {slotLabels[slotIndex]}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => addCall(entry.rankableEntryId)}
                    disabled={block === "FULL" || busy}
                    aria-label={block === "FULL" ? `${entry.displayName} — board full` : `Add ${entry.displayName} at ${slotLabels[calls.length]}`}
                    className="inline-flex min-h-10 w-20 shrink-0 items-center justify-center rounded-md border border-ink/20 bg-surface-elevated text-xs font-semibold text-ink hover:border-ink/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                  >
                    {block === "FULL" ? "Full" : "Add"}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <div className="space-y-4">
      {!locked ? (
        <WaiverLockClock
          locksAt={props.locksAt}
          lockLabel={props.lockLabel}
          serverNow={props.serverNow}
          onLockReached={onLockReached}
        />
      ) : (
        <div className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning" role="status">
          <span className="font-semibold uppercase tracking-wide">Locked</span> · {props.lockLabel}. Boards are final.
        </div>
      )}

      {participationNotice ? (
        <div className="rounded-lg border border-border bg-surface-elevated px-4 py-3 text-sm text-muted">{participationNotice}</div>
      ) : null}

      <div
        className="sticky z-30 -mx-4 border-b border-border bg-surface/95 px-4 py-1.5 backdrop-blur lg:hidden"
        style={{ top: "calc(4rem + env(safe-area-inset-top, 0px))" }}
        aria-live="polite"
      >
        <p className="text-xs font-medium text-ink">
          {position} · {boardSummary}
        </p>
      </div>

      {locked ? (
        <div className="space-y-4">
          {boardPanel}
          <details className="rounded-lg border border-border bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              View the official {position} pool ({pool.length})
            </summary>
            <div className="mt-3">{poolPanel}</div>
          </details>
        </div>
      ) : (
        <div className={`grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start ${participation === "ready" ? "pb-28 lg:pb-0" : ""}`}>
          <div className="lg:order-2 lg:sticky lg:top-24">{boardPanel}</div>
          <div className="lg:order-1">{poolPanel}</div>
        </div>
      )}

      {!locked && participation === "ready" ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-elevated/95 px-4 pt-3 shadow-[0_-8px_24px_rgba(10,28,45,0.08)] backdrop-blur lg:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
            <p className="text-center text-xs text-muted">
              {position} · {boardSummary}
            </p>
            <div className="flex gap-2">
              <ActionButtons
                participation={participation}
                position={position}
                editing={editing}
                competitive={competitive}
                revising={revising}
                busy={busy}
                submitDisabled={submitDisabled}
                submitLabel={submitLabel}
                onSubmit={onSubmitClick}
                onRevise={startRevise}
                onCancel={cancelRevise}
                lockReached={lockReached}
              />
            </div>
          </div>
        </div>
      ) : null}

      {confirmZero ? (
        <ZeroCallDialog position={position} pending={busy} onCancel={() => setConfirmZero(false)} onConfirm={() => void submit()} />
      ) : null}
    </div>
  );
}

function ActionButtons(props: {
  participation: WaiverParticipation;
  position: WaiverPosition;
  editing: boolean;
  competitive: boolean;
  revising: boolean;
  busy: boolean;
  submitDisabled: boolean;
  submitLabel: string;
  lockReached: boolean;
  onSubmit: () => void;
  onRevise: () => void;
  onCancel: () => void;
}) {
  if (props.participation !== "ready") return null;
  if (props.lockReached) {
    return (
      <Button type="button" className="min-h-11 flex-1" disabled>
        Locking…
      </Button>
    );
  }
  if (props.competitive && !props.revising) {
    return (
      <Button type="button" variant="secondary" className="min-h-11 flex-1" onClick={props.onRevise} disabled={props.busy}>
        Revise Picks
      </Button>
    );
  }
  return (
    <>
      {props.revising ? (
        <Button type="button" variant="secondary" className="min-h-11 flex-1" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </Button>
      ) : null}
      <Button type="button" className="min-h-11 flex-1" onClick={props.onSubmit} disabled={props.submitDisabled}>
        {props.busy ? "Submitting…" : props.submitLabel}
      </Button>
    </>
  );
}

function LockedBoard({
  board,
  participation,
  position,
}: {
  board: WaiverPlayBoard | null;
  participation: WaiverParticipation;
  position: WaiverPosition;
}) {
  const results = (
    <div className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
      <p className="font-medium text-ink">{WAIVER_RESULTS_PENDING}</p>
      <p className="mt-1">{WAIVER_EYEQ_FUTURE_COPY}</p>
    </div>
  );
  if (participation === "signed-out") {
    return (
      <>
        <p className="mt-3 text-sm text-muted">
          <Link href={waiverSignInHref(position)} className="font-medium text-accent-ink underline-offset-2 hover:underline">
            Sign in
          </Link>{" "}
          to see your locked board.
        </p>
        {results}
      </>
    );
  }
  if (!board || board.status === "MISSED") {
    return (
      <>
        <p className="mt-3 text-sm font-medium text-ink">{WAIVER_NO_BOARD_AFTER_LOCK}</p>
        {board && board.calls.length > 0 ? <p className="mt-1 text-sm text-muted">Your unsubmitted draft didn&apos;t compete.</p> : null}
      </>
    );
  }
  if (board.status === "LOCKED_ABSTAINED") {
    return (
      <>
        <p className="mt-3 text-sm text-ink">You submitted {position} with no calls this week.</p>
        {results}
      </>
    );
  }
  return (
    <>
      <ol className="mt-4 space-y-2" aria-label={`Your locked ${position} board`}>
        {board.calls.map((call) => (
          <li key={call.slot} className="flex min-h-12 items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
            <span className="w-14 shrink-0 font-display text-xs font-semibold uppercase tracking-wide text-accent-ink">{call.label}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {call.displayName}
              {call.team ? <span className="ml-1 text-xs font-normal text-muted">{call.team}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">Official board</p>
      {results}
    </>
  );
}

function ZeroCallDialog({
  position,
  pending,
  onCancel,
  onConfirm,
}: {
  position: WaiverPosition;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiver-zero-title"
      aria-describedby="waiver-zero-desc"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-elevated p-5 shadow-lg">
        <h3 id="waiver-zero-title" className="font-display text-xl font-semibold text-ink">
          Submit this position with no calls?
        </h3>
        <p id="waiver-zero-desc" className="mt-2 text-sm text-muted">
          This records that you&apos;re sitting out {position} this week. You can still add calls and resubmit before
          lock.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            Keep editing
          </Button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-transparent bg-accent px-4 py-2.5 text-sm font-medium text-ink hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          >
            Submit with no calls
          </button>
        </div>
      </div>
    </div>
  );
}
