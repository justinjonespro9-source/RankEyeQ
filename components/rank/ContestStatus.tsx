import { Badge } from "@/components/ui/Badge";
import type { PositionChallenge } from "@/types/contest";
import {
  boardDepthBadgeLabel,
  submissionProgressFillLabel,
} from "@/lib/ranking-depth-copy";
import { WEEKLY_CONTEST_HELPER } from "@/lib/weekly-messaging";

function formatSubmissionStatus(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "DRAFT") return "Draft";
  if (normalized === "SUBMITTED") return "Submitted";
  if (normalized === "GRADED") return "Graded";
  return status;
}

export function submissionProgressMessage(input: {
  filledCount: number;
  slotCount: number;
  scoringDepth: number;
  reserveCount: number;
  submissionStatus: string;
  editable: boolean;
  partialKickoffLocks?: boolean;
  fullBoardLocked?: boolean;
}): string {
  return submissionProgressFillLabel(input);
}

export function ContestStatusPanel({
  challenge,
  contestStatus,
  submissionStatus,
  filledCount,
  editable,
  partialKickoffLocks = false,
  fullBoardLocked = false,
}: {
  challenge: PositionChallenge;
  contestStatus: string;
  submissionStatus: string;
  filledCount: number;
  editable: boolean;
  partialKickoffLocks?: boolean;
  fullBoardLocked?: boolean;
}) {
  const progress = submissionProgressMessage({
    filledCount,
    slotCount: challenge.slotCount,
    scoringDepth: challenge.scoringDepth,
    reserveCount: challenge.reserveCount,
    submissionStatus,
    editable,
    partialKickoffLocks,
    fullBoardLocked,
  });
  const normalized = submissionStatus.toUpperCase();
  const isComplete = filledCount === challenge.slotCount;

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">{progress}</p>
        {fullBoardLocked ? (
          <Badge tone="warning">Rankings Locked</Badge>
        ) : editable ? (
          <Badge tone="success">Board Open</Badge>
        ) : (
          <Badge tone="warning">Locked</Badge>
        )}
        {partialKickoffLocks && editable ? (
          <Badge tone="warning">Partial kickoff locks</Badge>
        ) : null}
        {normalized === "SUBMITTED" ? (
          <Badge tone="neutral">Submitted</Badge>
        ) : normalized === "DRAFT" ? (
          <Badge tone="neutral">Draft</Badge>
        ) : null}
        {isComplete && normalized === "DRAFT" ? (
          <Badge tone="success">Complete</Badge>
        ) : null}
        {contestStatus === "FINAL" ? (
          <Badge tone="neutral">Final</Badge>
        ) : null}
      </div>
      <dl className="mt-3 space-y-1.5 text-muted">
        <div className="border-b border-border pb-2 text-xs leading-relaxed text-muted">
          {WEEKLY_CONTEST_HELPER}
        </div>
        <div className="flex justify-between gap-3">
          <dt>Board</dt>
          <dd className="font-medium text-ink">
            {boardDepthBadgeLabel(
              challenge.scoringDepth,
              challenge.reserveCount,
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Week</dt>
          <dd className="font-medium text-ink">{challenge.weekLabel}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Board window</dt>
          <dd className="max-w-[14rem] text-right font-medium text-ink">
            {challenge.lockLabel}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Submission</dt>
          <dd className="font-medium text-ink">
            {formatSubmissionStatus(submissionStatus)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Contest</dt>
          <dd className="font-medium uppercase text-ink">{contestStatus}</dd>
        </div>
      </dl>
    </div>
  );
}

/** @deprecated Use ContestStatusPanel */
export const ContestStatus = ContestStatusPanel;
