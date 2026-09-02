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
import { buildAiRankingPrompt, formatEligiblePlayerPool } from "@/lib/admin/ai-prompt";
import { loadAiPromptContest } from "@/lib/admin/ai-prompt-data";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "AI board · Admin" };
}

export default async function AdminAiContestPage(
  props: PageProps<"/admin/ai/[profileId]/[contestId]">,
) {
  const { profileId, contestId } = await props.params;
  const [profile, promptContest, contest] = await Promise.all([
    prisma.universalProfile.findUnique({ where: { id: profileId } }),
    loadAiPromptContest(contestId),
    prisma.rankIQContest.findUnique({
      where: { id: contestId },
      include: {
        week: true,
        entries: {
          include: { rankableEntry: true },
        },
        submissions: {
          where: { universalProfileId: profileId },
          include: { picks: true },
        },
      },
    }),
  ]);
  if (!profile || profile.profileType !== "AI" || !promptContest || !contest) {
    notFound();
  }

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
  const prompt = buildAiRankingPrompt(promptContest);
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
            href={`/admin/ai?weekId=${contest.weekId}`}
            className="text-sm font-medium text-accent hover:underline"
          >
            Back to AI grid
          </Link>
        }
      />

      <p className="mb-4 text-sm text-muted">
        Current status: {submission?.status ?? "Missing"}
      </p>

      <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <CopyButton text={prompt} label="Copy prompt" />
          <CopyButton
            text={formatEligiblePlayerPool(promptContest.players)}
            label="Copy player pool"
          />
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted">
          {prompt}
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
        />
      </section>
    </Container>
  );
}
