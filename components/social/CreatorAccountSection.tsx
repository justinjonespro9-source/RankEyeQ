"use client";

import { useState, useTransition } from "react";
import {
  setBoardRevealPreferenceAction,
  setCreatorOptInAction,
  setDefaultRevealPreferenceAction,
} from "@/lib/social-actions";
import { Button } from "@/components/ui/Button";
import type { BoardRevealPreference } from "@/lib/generated/prisma/client";
import type { QualificationStatus } from "@/lib/social/qualification";

type CurrentBoard = {
  contestId: string;
  position: string;
  status: string;
  revealPreference: BoardRevealPreference;
};

export function CreatorAccountSection({
  status,
  eligible,
  reasons,
  enabled,
  defaultRevealPreference,
  gradedContestCount,
  minGradedContests,
  currentWeekBoards,
}: {
  status: QualificationStatus;
  eligible: boolean;
  reasons: string[];
  enabled: boolean;
  defaultRevealPreference: BoardRevealPreference;
  gradedContestCount: number;
  minGradedContests: number;
  currentWeekBoards: CurrentBoard[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="mt-10 rounded-lg border border-border bg-surface-elevated p-5">
      <h2 className="font-display text-xl font-semibold text-ink">
        Creator / Rankings Access
      </h2>
      <p className="mt-1 text-sm text-muted">
        Sample-size qualification for future paid pre-kickoff board access.
        Payments are not live.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Status</dt>
          <dd className="mt-1 font-medium text-ink">{status.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">
            Graded contests
          </dt>
          <dd className="mt-1 font-medium text-ink">
            {gradedContestCount} / {minGradedContests} min
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">
            Creator mode
          </dt>
          <dd className="mt-1 font-medium text-ink">{enabled ? "On" : "Off"}</dd>
        </div>
      </dl>

      {reasons.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || (!enabled && !eligible)}
          onClick={() => {
            startTransition(async () => {
              const result = await setCreatorOptInAction(!enabled);
              if (!result.ok) {
                setError(result.error);
                setMessage(null);
                return;
              }
              setError(null);
              setMessage(enabled ? "Creator mode off" : "Creator mode on");
            });
          }}
        >
          {enabled ? "Opt out of creator mode" : "Opt into creator mode"}
        </Button>
      </div>

      {enabled ? (
        <div className="mt-6 space-y-4">
          <div>
            <p className="text-sm font-medium text-ink">
              Default Sunday 10 AM–noon reveal
            </p>
            <p className="mt-1 text-xs text-muted">
              After noon CT every official board is public. Historical boards stay public.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["FREE_REVEAL", "PREMIUM_REVEAL"] as const).map((pref) => (
                <Button
                  key={pref}
                  type="button"
                  size="sm"
                  variant={
                    defaultRevealPreference === pref ? "primary" : "secondary"
                  }
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await setDefaultRevealPreferenceAction(pref);
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      setError(null);
                      setMessage("Default reveal preference saved");
                    });
                  }}
                >
                  {pref === "FREE_REVEAL" ? "Free reveal" : "Premium reveal"}
                </Button>
              ))}
            </div>
          </div>

          {currentWeekBoards.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-ink">Current-week boards</p>
              <ul className="mt-2 space-y-2">
                {currentWeekBoards.map((board) => (
                  <li
                    key={board.contestId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="text-ink">
                      {board.position} · {board.status}
                    </span>
                    <span className="flex gap-1">
                      {(["FREE_REVEAL", "PREMIUM_REVEAL"] as const).map((pref) => (
                        <Button
                          key={pref}
                          type="button"
                          size="sm"
                          variant={
                            board.revealPreference === pref
                              ? "primary"
                              : "secondary"
                          }
                          disabled={pending}
                          onClick={() => {
                            startTransition(async () => {
                              const result = await setBoardRevealPreferenceAction({
                                contestId: board.contestId,
                                preference: pref,
                              });
                              if (!result.ok) {
                                setError(result.error);
                                return;
                              }
                              setError(null);
                              setMessage(`${board.position} reveal updated`);
                            });
                          }}
                        >
                          {pref === "FREE_REVEAL" ? "Free" : "Premium"}
                        </Button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-warning">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-accent">{message}</p> : null}
    </section>
  );
}
