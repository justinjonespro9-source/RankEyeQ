import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { AiParserForm } from "@/components/admin/AiParserForm";
import { toEligibleParserEntry } from "@/lib/admin/ai-parser";
import { CopyButton } from "@/components/admin/CopyButton";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { RANKEYEQ_AI_WEEKLY_PROMPT_VERSION } from "@/lib/admin/ai-prompt";
import { loadAiPromptBundleForContest } from "@/lib/admin/ai-prompt-data";
import { contestAllowsRankingEdits } from "@/lib/contest-lifecycle";
import { submissionDepthFromScoring } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import { getWeekTimingState } from "@/lib/timing/week-windows";
import { RANKIQ_TIMEZONE } from "@/lib/timing/chicago";

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
    universalProfileId: profile.id,
  });
  if (!bundle) notFound();

  const submission = contest.submissions[0] ?? null;
  const eligible = contest.entries
    .filter((entry) => !entry.excluded)
    .filter((entry) => {
      const availability = entry.rankableEntry.availability;
      // Locked picks already on the board must remain matchable even if OUT.
      const onBoard = submission?.picks.some(
        (pick) => pick.rankableEntryId === entry.rankableEntryId,
      );
      if (onBoard) return true;
      return (
        availability === "ACTIVE" ||
        availability === "QUESTIONABLE" ||
        availability === "DOUBTFUL"
      );
    })
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
  const timing = getWeekTimingState({
    rankingsOpenAt: contest.week.rankingsOpenAt,
    fullLockAt: contest.week.fullLockAt,
    revealStartsAt: contest.week.revealStartsAt,
    publicReleaseAt: contest.week.publicReleaseAt,
    weekStatus: contest.week.status,
    now: generatedAt,
  });
  const contestOpen = contestAllowsRankingEdits({
    contestStatus: contest.status,
    fullBoardLocked: timing.fullBoardLocked,
    fullLockAt: contest.week.fullLockAt,
    now: generatedAt,
  });
  const canImport = contestOpen && timing.canEditUnlocked;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/ai" />
      <SectionHeading
        eyebrow={`${profile.displayName} · ${contest.position}`}
        title={`AI board · ${contest.title}`}
        description={`${contest.week.label} Top ${contest.rankingDepth} + 2 reserves. Refresh / Rerank uses current availability. Mode: ${bundle.meta.mode}. Same RankingSubmission path as humans.`}
        action={
          <Link
            href={`/admin/ai?weekId=${contest.weekId}&profileId=${profile.id}&position=${contest.position}`}
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Back to AI workflow
          </Link>
        }
      />

      {!canImport ? (
        <div
          className="mb-6 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {!contestOpen
            ? `Contest is ${contest.status}. Reopen to OPEN before importing a competing AI board.`
            : timing.fullBoardLocked
              ? "Sunday full lock has passed — competing AI boards can no longer be submitted."
              : "Weekly rankings have not opened yet."}
        </div>
      ) : null}

      <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetaItem label="AI identity" value={profile.displayName} />
        <MetaItem
          label="Season / week"
          value={`${contest.week.season.year} · ${contest.week.label}`}
        />
        <MetaItem
          label="Position / field size"
          value={`${contest.position} · Top ${contest.rankingDepth} + 2 reserves`}
        />
        <MetaItem label="Contest status" value={contest.status} />
        <MetaItem
          label="Week full lock"
          value={
            contest.week.fullLockAt
              ? `${contest.week.fullLockAt.toLocaleString("en-US", {
                  timeZone: RANKIQ_TIMEZONE,
                  dateStyle: "medium",
                  timeStyle: "short",
                })} ${RANKIQ_TIMEZONE}`
              : "—"
          }
        />
        <MetaItem
          label="Edit window"
          value={
            timing.canEditUnlocked
              ? "Open"
              : timing.fullBoardLocked
                ? "Closed (Sunday lock)"
                : "Not open yet"
          }
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-ink">
            Refresh / Rerank prompt
          </h2>
          <Badge tone={bundle.meta.mode === "fresh" ? "success" : "warning"}>
            {bundle.meta.mode === "fresh"
              ? "Fresh (no locked picks)"
              : "Rerank with locked slots"}
          </Badge>
        </div>
        <p className="mb-3 text-sm text-muted">
          {bundle.meta.mode === "fresh"
            ? "No kickoff-locked picks — prompt ranks independently from scratch using current eligibility. Previous AI board is not included."
            : "Some picks are kickoff-locked — prompt keeps those exact slots and re-ranks unlocked slots only."}
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          <CopyButton text={bundle.prompt} label="Copy Refresh / Rerank Prompt" />
          <CopyButton text={bundle.poolText} label="Copy eligible pool" />
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
          rankingDepth={submissionDepthFromScoring(contest.rankingDepth)}
          scoringDepth={contest.rankingDepth}
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
