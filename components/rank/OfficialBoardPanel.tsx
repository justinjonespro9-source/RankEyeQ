"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { publishOfficialBoardAction } from "@/lib/official-board-actions";

export type OfficialBoardPanelStatus =
  | { state: "PROTECTED"; canPublish: boolean; blockedReason: string | null }
  | {
      state: "PUBLISHED";
      versionNumber: number;
      hasPendingChanges: boolean;
      canUpdate: boolean;
      blockedReason: string | null;
    }
  | { state: "LOCKED"; publishedVersionNumber: number | null };

/**
 * Official RankEyeQ Board controls for the owner's own workspace board.
 * Publication is one-way; there is intentionally no Unpublish.
 */
export function OfficialBoardPanel({
  status,
  contestId,
  position,
  publicHref,
}: {
  status: OfficialBoardPanelStatus;
  contestId: string;
  position: string;
  publicHref: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function publish() {
    setMessage(null);
    startTransition(async () => {
      const result = await publishOfficialBoardAction({ contestId, position });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(
        result.outcome === "unchanged"
          ? "Your published board is already up to date."
          : `Published version ${result.versionNumber} is live.`,
      );
    });
  }

  return (
    <section
      aria-label="Official RankEyeQ Board"
      className="mb-4 rounded-md border border-border bg-surface-elevated px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            Official RankEyeQ Board
            <span className="ml-2 font-normal text-muted">
              {status.state === "PROTECTED"
                ? "· Protected"
                : status.state === "PUBLISHED"
                  ? status.hasPendingChanges
                    ? `· Published version ${status.versionNumber} is still live`
                    : "· Published"
                  : "· Official Board Locked"}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted">
            {status.state === "PROTECTED"
              ? "RankEyeQ never reveals your picks early. You can reveal your own — publishing shares this version now; later edits stay private until you update it."
              : status.state === "PUBLISHED"
                ? status.hasPendingChanges
                  ? "You have private changes. The public still sees your last published version."
                  : "The public sees this version of your board. Reserves stay private until lock."
                : "The Sunday lock has passed. Your final board is recorded as it competed."}
          </p>
          {status.state !== "LOCKED" && status.blockedReason ? (
            <p className="mt-1 text-xs text-muted">{status.blockedReason}</p>
          ) : null}
          {message ? (
            <p className="mt-1 text-sm text-ink" role="status">
              {message}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {status.state === "PROTECTED" ? (
            <Button
              size="sm"
              onClick={publish}
              disabled={pending || !status.canPublish}
            >
              Publish My Board
            </Button>
          ) : null}
          {status.state === "PUBLISHED" && status.hasPendingChanges ? (
            <Button
              size="sm"
              onClick={publish}
              disabled={pending || !status.canUpdate}
            >
              Update Published Board
            </Button>
          ) : null}
          {status.state === "PUBLISHED" ? (
            <Button size="sm" variant="secondary" href={publicHref}>
              View Public Board
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
