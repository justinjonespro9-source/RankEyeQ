import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { BenchmarkImportForm } from "@/components/admin/BenchmarkImportForm";
import { toEligibleParserEntry } from "@/lib/admin/ai-parser";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { adminMarkBenchmarkNotAvailableAction } from "@/lib/admin-benchmark-actions";
import { benchmarkAffiliationDisclaimer } from "@/lib/benchmark-sources";
import { prisma } from "@/lib/db";
import { formatInChicago } from "@/lib/timing/chicago";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Benchmark board · Admin" };
}

export default async function AdminBenchmarkContestPage(
  props: PageProps<"/admin/benchmarks/[profileId]/[contestId]">,
) {
  const { profileId, contestId } = await props.params;
  const [profile, contest] = await Promise.all([
    prisma.universalProfile.findUnique({ where: { id: profileId } }),
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
  if (!profile || profile.profileType !== "BENCHMARK" || !contest) {
    notFound();
  }

  const [eligibleUniverse, otherPositions, snapshots] = await Promise.all([
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

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/benchmarks" />
      <SectionHeading
        eyebrow={`${profile.displayName} · ${contest.position}`}
        title={`Benchmark · ${contest.title}`}
        description={`${contest.week.label} Top ${contest.rankingDepth}. Same RankEyeQ scoring engine as humans and AI. Capture timestamps are the source of truth.`}
        action={
          <Link
            href={`/admin/benchmarks?weekId=${contest.weekId}`}
            className="text-sm font-medium text-accent hover:underline"
          >
            Back to benchmark grid
          </Link>
        }
      />

      <p className="mb-4 text-sm text-muted">
        {benchmarkAffiliationDisclaimer(profile.displayName)}
      </p>
      <p className="mb-6 text-sm text-muted">
        Submission status: {submission?.status ?? "None (snapshot only until official lock)"}
        {contest.week.fullLockAt
          ? ` · Official lock ${formatInChicago(contest.week.fullLockAt, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            })}`
          : ""}
      </p>

      <BenchmarkImportForm
        contestId={contest.id}
        profileId={profile.id}
        weekId={contest.weekId}
        rankingDepth={contest.rankingDepth}
        eligible={eligible}
        universe={eligibleUniverse.map(toEligibleParserEntry)}
        otherPositions={otherPositions.map(toEligibleParserEntry)}
        sourceName={profile.displayName}
        fullLockAt={contest.week.fullLockAt}
        latestSnapshotId={latest?.id ?? null}
        hasOfficialBoard={
          submission?.status === "LOCKED" || submission?.status === "GRADED"
        }
      />

      <div className="mt-8">
        <ConfirmSubmit
          action={adminMarkBenchmarkNotAvailableAction}
          submitLabel="Mark not available"
          impact={`Mark ${profile.displayName} ${contest.position} as NOT_AVAILABLE for ${contest.week.label}. This does not invent a ranking and does not block Finalize Week.`}
          confirmPhrase="NOT AVAILABLE"
        >
          <input type="hidden" name="contestId" value={contest.id} />
          <input type="hidden" name="profileId" value={profile.id} />
          <input
            type="hidden"
            name="notes"
            value="Source did not publish a compatible ranking for this position"
          />
        </ConfirmSubmit>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold text-ink">
          Snapshot history
        </h2>
        {snapshots.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No captures yet.</p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {snapshots.map((snapshot) => (
              <li
                key={snapshot.id}
                className="rounded-md border border-border px-3 py-2"
              >
                <span className="font-medium text-ink">
                  {snapshot.captureType} · {snapshot.status}
                </span>
                {snapshot.late ? (
                  <span className="ml-2 text-warning">Late / non-competing</span>
                ) : null}
                <span className="block text-muted">
                  Captured{" "}
                  {formatInChicago(snapshot.capturedAt, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}{" "}
                  by {snapshot.adminUser.email ?? snapshot.adminUser.name ?? "admin"}
                  {snapshot.correctionOfId ? " · correction" : ""}
                </span>
                {snapshot.correctionReason ? (
                  <span className="block text-muted">
                    Reason: {snapshot.correctionReason}
                  </span>
                ) : null}
                {snapshot.sourceUrl ? (
                  <span className="block truncate text-muted">
                    {snapshot.sourceUrl}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </Container>
  );
}
