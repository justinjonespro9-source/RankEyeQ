import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { CreatorImportForm } from "@/components/admin/CreatorImportForm";
import { toEligibleParserEntry } from "@/lib/admin/ai-parser";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { adminMarkBenchmarkNotAvailableAction } from "@/lib/admin-benchmark-actions";
import {
  findNextCreatorImportTarget,
  getCreatorRankingCoverage,
} from "@/lib/creators/coverage";
import {
  formatCreatorAffiliationBadge,
  formatCreatorPrimaryName,
} from "@/lib/creator-identity";
import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
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
  const [profile, contest] = await Promise.all([
    prisma.universalProfile.findUnique({
      where: { id: profileId },
      include: { creatorCompetitor: true },
    }),
    prisma.rankIQContest.findUnique({
      where: { id: contestId },
      include: {
        week: true,
        entries: { include: { rankableEntry: true } },
        submissions: {
          where: { universalProfileId: profileId },
          include: { picks: true },
        },
      },
    }),
  ]);
  if (!profile || profile.profileType !== "CREATOR" || !contest) {
    notFound();
  }

  const weekId =
    typeof searchParams?.weekId === "string"
      ? searchParams.weekId
      : contest.weekId;

  const [eligibleUniverse, otherPositions, snapshots, coverage, weekContests] =
    await Promise.all([
      prisma.rankableEntry.findMany({
        where: { position: contest.position, active: true },
        select: {
          id: true,
          name: true,
          team: true,
          shortName: true,
          adminNotes: true,
        },
      }),
      prisma.rankableEntry.findMany({
        where: { position: { not: contest.position }, active: true },
        select: {
          id: true,
          name: true,
          team: true,
          shortName: true,
          adminNotes: true,
        },
      }),
      prisma.benchmarkSnapshot.findMany({
        where: { contestId, universalProfileId: profileId },
        orderBy: { createdAt: "desc" },
        include: { adminUser: { select: { email: true, name: true } } },
      }),
      getCreatorRankingCoverage(weekId),
      prisma.rankIQContest.findMany({
        where: { weekId },
        select: { id: true, position: true },
      }),
    ]);

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
  const submission = contest.submissions[0] ?? null;
  const latest = snapshots[0] ?? null;
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
  const next = findNextCreatorImportTarget({
    rows: coverage.rows,
    contestByPosition,
    afterProfileId: profileId,
    afterPosition: contest.position,
  });
  const nextHref = next
    ? `/admin/creators/board/${next.profileId}/${next.contestId}?weekId=${weekId}`
    : null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/creators" />
      <SectionHeading
        eyebrow={`${primaryName} · ${contest.position}`}
        title={`Creator import · ${contest.title}`}
        description={`${contest.week.label} Top ${contest.rankingDepth}. Source evidence stored on BenchmarkSnapshot. Official boards use RankingSubmission (LOCKED).`}
        action={
          <Link
            href={`/admin/creators?weekId=${weekId}`}
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Back to matrix
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {CONTEST_POSITIONS.map((position) => {
          const id = contestByPosition.get(position);
          if (!id) return null;
          return (
            <Link
              key={position}
              href={`/admin/creators/board/${profileId}/${id}?weekId=${weekId}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                position === contest.position
                  ? "bg-accent-soft text-ink"
                  : "border border-border bg-surface-elevated text-ink"
              }`}
            >
              {position}
            </Link>
          );
        })}
      </div>

      <p className="mb-4 text-sm text-muted">
        Official board: {submission?.status ?? "Missing"}
        {latest?.sourceUrl ? (
          <>
            {" · "}
            <a
              href={latest.sourceUrl}
              className="text-accent-ink hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              last source
            </a>
          </>
        ) : null}
        {latest?.sourcePublishedAt
          ? ` · source published ${formatInChicago(latest.sourcePublishedAt, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`
          : null}
        {latest?.capturedAt
          ? ` · imported ${formatInChicago(latest.capturedAt, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`
          : null}
      </p>

      <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
        <CreatorImportForm
          contestId={contest.id}
          profileId={profile.id}
          weekId={weekId}
          position={contest.position}
          rankingDepth={contest.rankingDepth}
          eligible={eligible}
          universe={eligibleUniverse.map(toEligibleParserEntry)}
          otherPositions={otherPositions.map(toEligibleParserEntry)}
          creatorName={primaryName}
          brandName={brandName}
          affiliationBadge={affiliationBadge}
          defaultSourceUrl={
            latest?.sourceUrl ?? profile.creatorCompetitor?.sourceUrl ?? null
          }
          competitorActive={profile.competitorActive}
          fullLockAt={contest.week.fullLockAt}
          latestSnapshotId={latest?.id ?? null}
          hasOfficialBoard={
            submission?.status === "LOCKED" || submission?.status === "GRADED"
          }
          nextHref={nextHref}
        />
      </section>

      <div className="mb-8">
        <ConfirmSubmit
          action={adminMarkBenchmarkNotAvailableAction}
          submitLabel="Mark not available"
          impact={`Mark ${primaryName} ${contest.position} as NOT_AVAILABLE for ${contest.week.label}. Does not invent a ranking.`}
          confirmPhrase="NOT AVAILABLE"
        >
          <input type="hidden" name="contestId" value={contest.id} />
          <input type="hidden" name="profileId" value={profile.id} />
          <input
            type="hidden"
            name="notes"
            value="Creator did not publish a compatible ranking for this position"
          />
        </ConfirmSubmit>
      </div>

      {snapshots.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Snapshot history
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {snapshots.map((snapshot) => (
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
