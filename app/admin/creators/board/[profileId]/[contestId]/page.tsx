import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { CreatorImportForm } from "@/components/admin/CreatorImportForm";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { adminMarkBenchmarkNotAvailableAction } from "@/lib/admin-benchmark-actions";
import { loadCreatorBoardPage } from "@/lib/admin/creator-board-page";
import { formatInChicago } from "@/lib/timing/chicago";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Creator board import · Admin" };
}

export default async function AdminCreatorBoardPage(props: {
  params: Promise<{ profileId: string; contestId: string }>;
  searchParams: Promise<{ weekId?: string }>;
}) {
  const { profileId, contestId } = await props.params;
  const searchParams = await props.searchParams;
  const model = await loadCreatorBoardPage({
    profileId,
    contestId,
    weekId:
      typeof searchParams?.weekId === "string" ? searchParams.weekId : undefined,
  });
  if ("notFound" in model) {
    notFound();
  }

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/creators" />
      <SectionHeading
        eyebrow={`${model.primaryName} · ${model.position}`}
        title={`Creator import · ${model.contestTitle}`}
        description={`${model.weekLabel} Top ${model.rankingDepth}. Source evidence stored on BenchmarkSnapshot. Official boards use RankingSubmission (LOCKED).`}
        action={
          <Link
            href={`/admin/creators?weekId=${model.weekId}`}
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Back to matrix
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {model.positionLinks.map((link) => (
          <Link
            key={link.position}
            href={`/admin/creators/board/${model.profileId}/${link.contestId}?weekId=${model.weekId}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              link.position === model.position
                ? "bg-accent-soft text-ink"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {link.position}
          </Link>
        ))}
      </div>

      <p className="mb-4 text-sm text-muted">
        Official board: {model.submissionStatus ?? "Missing"}
        {model.latestSourceUrl ? (
          <>
            {" · "}
            <a
              href={model.latestSourceUrl}
              className="text-accent-ink hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              last source
            </a>
          </>
        ) : null}
        {model.latestSourcePublishedAt
          ? ` · source published ${formatInChicago(model.latestSourcePublishedAt, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`
          : null}
        {model.latestCapturedAt
          ? ` · imported ${formatInChicago(model.latestCapturedAt, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`
          : null}
      </p>

      {model.timingNotice ? (
        <p
          className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning"
          role="status"
        >
          {model.timingNotice.message}
        </p>
      ) : null}

      <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
        <CreatorImportForm
          contestId={model.contestId}
          profileId={model.profileId}
          weekId={model.weekId}
          position={model.position}
          rankingDepth={model.rankingDepth}
          eligible={model.eligible}
          creatorName={model.primaryName}
          brandName={model.brandName}
          affiliationBadge={model.affiliationBadge}
          defaultSourceUrl={model.defaultSourceUrl}
          competitorActive={model.competitorActive}
          fullLockAt={model.fullLockAt}
          latestSnapshotId={model.latestSnapshotId}
          hasOfficialBoard={model.hasOfficialBoard}
          nextHref={model.nextHref}
        />
      </section>

      <div className="mb-8">
        <ConfirmSubmit
          action={adminMarkBenchmarkNotAvailableAction}
          submitLabel="Mark not available"
          impact={`Mark ${model.primaryName} ${model.position} as NOT_AVAILABLE for ${model.weekLabel}. Does not invent a ranking.`}
          confirmPhrase="NOT AVAILABLE"
        >
          <input type="hidden" name="contestId" value={model.contestId} />
          <input type="hidden" name="profileId" value={model.profileId} />
          <input
            type="hidden"
            name="notes"
            value="Creator did not publish a compatible ranking for this position"
          />
        </ConfirmSubmit>
      </div>

      {model.snapshots.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Snapshot history
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {model.snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                {snapshot.captureType} · {snapshot.status}
                {snapshot.late ? " · LATE" : ""}
                {snapshot.sourceUrl ? (
                  <>
                    {" · "}
                    <a
                      href={snapshot.sourceUrl}
                      className="text-accent-ink hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      source
                    </a>
                  </>
                ) : null}
                {" · "}
                imported{" "}
                {formatInChicago(snapshot.capturedAt, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {snapshot.sourcePublishedAt
                  ? ` · published ${formatInChicago(snapshot.sourcePublishedAt, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}
