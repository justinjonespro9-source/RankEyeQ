import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { AiParserForm } from "@/components/admin/AiParserForm";
import { toEligibleParserEntry } from "@/lib/admin/ai-parser";
import { CopyButton } from "@/components/admin/CopyButton";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { RANKEYEQ_AI_WEEKLY_PROMPT_VERSION } from "@/lib/admin/ai-prompt";
import { loadAiPromptBundleForContest } from "@/lib/admin/ai-prompt-data";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "AI board · Admin" };
}

export default async function AdminAiContestPage(
  props: PageProps<"/admin/ai/[profileId]/[contestId]">,
) {
  const { profileId, contestId } = await props.params;
  const generatedAt = new Date();
  const [profile, contest] = await Promise.all([
    prisma.universalProfile.findUnique({ where: { id: profileId } }),
    prisma.rankIQContest.findUnique({
      where: { id: contestId },
      include: {
        week: { include: { season: true } },
        entries: {
          include: { rankableEntry: true },
        },
        submissions: {
          where: { universalProfileId: profileId },
          include: { picks: { orderBy: { predictedRank: "asc" } } },
        },
      },
    }),
  ]);
  if (!profile || profile.profileType !== "AI" || !contest) {
    notFound();
  }

  const bundle = await loadAiPromptBundleForContest(contestId, {
    aiDisplayName: profile.displayName,
    generatedAt,
  });
  if (!bundle) notFound();

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
  const universe = await prisma.rankableEntry.findMany({
    where: { position: contest.position, active: true },
    select: {
      id: true,
      name: true,
      team: true,
      shortName: true,
      adminNotes: true,
    },
  });
  const otherPositions = await prisma.rankableEntry.findMany({
    where: { position: { not: contest.position }, active: true },
    select: {
      id: true,
      name: true,
      team: true,
      shortName: true,
      adminNotes: true,
    },
    take: 500,
  });
  const submission = contest.submissions[0] ?? null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/ai" />
      <SectionHeading
        eyebrow={`${profile.displayName} · ${contest.position}`}
        title={`AI board · ${contest.title}`}
        description={`${contest.week.label} Top ${contest.rankingDepth}. Same RankingSubmission path as humans. Kickoff and Sunday locks apply.`}
        action={
          <Link
            href={`/admin/ai?weekId=${contest.weekId}&profileId=${profile.id}&position=${contest.position}`}
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Back to AI workflow
          </Link>
        }
      />

      <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetaItem label="AI identity" value={profile.displayName} />
        <MetaItem
          label="Season / week"
          value={`${contest.week.season.year} · ${contest.week.label}`}
        />
        <MetaItem
          label="Position / field size"
          value={`${contest.position} · Top ${contest.rankingDepth}`}
        />
        <MetaItem
          label="Eligible pool"
          value={`${bundle.meta.eligiblePoolCount} players`}
        />
        <MetaItem label="Prompt version" value={bundle.meta.version} />
        <MetaItem label="Generated" value={bundle.meta.generatedAtLabel} />
        <MetaItem
          label="Submission status"
          value={submission?.status ?? "Missing"}
        />
        <MetaItem
          label="Submitted at"
          value={
            submission?.submittedAt
              ? submission.submittedAt.toISOString()
              : "—"
          }
        />
      </dl>

      <p className="mb-4 text-xs text-muted">
        Prompt text is not stored in the database (no migration). Receipts use{" "}
        <code className="rounded bg-surface px-1">RankingSubmission.submittedAt</code>{" "}
        plus picks; prompt identity is{" "}
        <code className="rounded bg-surface px-1">
          {RANKEYEQ_AI_WEEKLY_PROMPT_VERSION}
        </code>{" "}
        in code.
      </p>

      <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <CopyButton text={bundle.prompt} label="Copy Prompt" />
          <CopyButton text={bundle.poolText} label="Copy player pool" />
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted">
          {bundle.prompt}
        </pre>
      </section>

      <section className="rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">
          Parse AI response
        </h2>
        <AiParserForm
          contestId={contest.id}
          profileId={profile.id}
          weekId={contest.weekId}
          rankingDepth={contest.rankingDepth}
          eligible={eligible}
          universe={universe.map(toEligibleParserEntry)}
          otherPositions={otherPositions.map(toEligibleParserEntry)}
        />
      </section>
    </Container>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}
