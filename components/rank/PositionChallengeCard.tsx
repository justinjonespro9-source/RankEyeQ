import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ctaForContestState } from "@/lib/homepage-cta";
import type { ContestStatus, SubmissionStatus } from "@/lib/generated/prisma/client";
import type { PositionChallenge } from "@/types/contest";
import { WEEKLY_CONTEST_HELPER } from "@/lib/weekly-messaging";

export function PositionChallengeCard({
  challenge,
  contestStatus,
  submittedCount,
  profileSubmissionStatus = null,
  resultsHref,
}: {
  challenge: PositionChallenge;
  contestStatus?: ContestStatus;
  submittedCount?: number;
  profileSubmissionStatus?: SubmissionStatus | null;
  resultsHref?: string;
}) {
  const dbStatus = contestStatus ?? (challenge.status === "open" ? "OPEN" : "LOCKED");
  const cta = ctaForContestState(dbStatus, profileSubmissionStatus);
  const href =
    (dbStatus === "FINAL" || dbStatus === "ARCHIVED") && resultsHref
      ? resultsHref
      : `/rank/${challenge.position}`;

  return (
    <article className="flex flex-col rounded-lg border border-border bg-surface-elevated p-5 transition-colors hover:border-ink/25">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-3xl font-semibold tracking-tight text-ink">
            {challenge.shortLabel}
          </p>
          <p className="mt-1 text-sm text-muted">{challenge.label}</p>
        </div>
        <Badge tone={dbStatus === "OPEN" ? "success" : "neutral"}>
          {dbStatus}
        </Badge>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        {WEEKLY_CONTEST_HELPER}
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Players to rank</dt>
          <dd className="font-medium text-ink">Top {challenge.slotCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Week</dt>
          <dd className="font-medium text-ink">{challenge.weekLabel}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Lock timing</dt>
          <dd className="max-w-[14rem] text-right font-medium text-ink">
            {challenge.lockLabel}
          </dd>
        </div>
        {typeof submittedCount === "number" ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Submitted</dt>
            <dd className="font-medium text-ink">{submittedCount}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-6">
        <Button
          href={href}
          variant={dbStatus === "OPEN" ? "primary" : "secondary"}
          className="w-full"
        >
          {cta}
        </Button>
      </div>
    </article>
  );
}
