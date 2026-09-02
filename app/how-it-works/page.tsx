import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { NO_WAGERING_DISCLAIMER } from "@/lib/company";
import {
  CONTEST_ELIGIBILITY,
  POSITION_CONFIGS,
} from "@/lib/contest";
import { ELIGIBILITY_SUMMARY } from "@/lib/legal/eligibility";
import { policyRoute } from "@/lib/legal/policies";
import { canonicalMetadata, PUBLIC_INDEX } from "@/lib/seo";
import {
  getFantasyScoringReferenceTables,
  getFantasyScoringSummary,
} from "@/lib/fantasy/scoring-reference";
import {
  NOT_DRAFT_OR_PROJECTIONS,
  SEASON_LEADERBOARD_NOTE,
  WEEKLY_RANKINGS_EXPLAINER,
  WEEKLY_RANKINGS_SHORT,
  WEEKLY_RANKINGS_TAGLINE,
} from "@/lib/weekly-messaging";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "Weekly NFL player rankings: rank this week's slate before kickoff, graded against actual fantasy-point finishes. Not draft rankings or season-long projections.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/how-it-works"),
};

const HOW_STEPS = [
  {
    title: "Rank the players",
    body: "Each week, rank the players you think will finish highest at their fantasy position — Top 10 QB/RB/TE/DEF, Top 15 WR.",
  },
  {
    title: "Lock your rankings",
    body: "Players lock when their games begin. Remaining rankings fully lock Sunday 10:00 AM America/Chicago.",
  },
  {
    title: "See how everyone ranked them",
    body: "After the Sunday lock, community, human, and AI rankings can be revealed during the reveal window.",
  },
  {
    title: "Watch the games decide",
    body: "Actual fantasy production determines each player's final positional order using FantasyTrack Full PPR scoring.",
  },
  {
    title: "Build your RankEyeQ",
    body: "Your EYEQ Score rewards accurate rankings — especially getting the very top of the board right.",
  },
];

export default function HowItWorksPage() {
  const fantasySummary = getFantasyScoringSummary();
  const fantasyTables = getFantasyScoringReferenceTables();
  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Rules"
        title="How RankEyeQ works"
        description={WEEKLY_RANKINGS_EXPLAINER}
      />

      <div className="mb-10 rounded-lg border border-accent/30 bg-accent-soft/40 p-6">
        <p className="font-display text-lg font-semibold text-ink">
          {WEEKLY_RANKINGS_TAGLINE}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {WEEKLY_RANKINGS_SHORT} {NOT_DRAFT_OR_PROJECTIONS}
        </p>
      </div>

      <div className="space-y-10">
        <section className="rounded-lg border border-border bg-surface-elevated p-6">
          <h2 className="font-display text-xl font-semibold text-ink">
            Five steps
          </h2>
          <ol className="mt-4 space-y-4">
            {HOW_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4 text-sm">
                <span className="font-display font-semibold text-accent">
                  {index + 1}.
                </span>
                <div>
                  <p className="font-medium text-ink">{step.title}</p>
                  <p className="mt-1 leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-6">
          <h2 className="font-display text-xl font-semibold text-ink">
            Free-to-play
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>{NO_WAGERING_DISCLAIMER}</li>
            <li>{ELIGIBILITY_SUMMARY}</li>
            <li>
              Humans, Experts, and labeled AI Competitors use the same weekly
              rules and scoring. See the{" "}
              <Link href={policyRoute("ai-disclosure")} className="text-accent hover:underline">
                AI Disclosure
              </Link>{" "}
              for how automated participants work.
            </li>
            <li>
              Detailed policies:{" "}
              <Link href="/legal" className="text-accent hover:underline">
                Legal center
              </Link>
              .
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-6">
          <h2 className="font-display text-xl font-semibold text-ink">
            Weekly cadence
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>Contests open Tuesday (America/Chicago).</li>
            <li>{CONTEST_ELIGIBILITY}</li>
            <li>
              Each player or defense locks when their own NFL game begins.
              Locked slots cannot be added, removed, or moved.
            </li>
            <li>
              Remaining unlocked rankings lock Sunday 10:00 AM America/Chicago.
            </li>
            <li>
              Only explicitly submitted complete boards compete. In-progress saves
              (drafts) never count — and this is not a fantasy draft.
            </li>
            <li>
              Next NFL week: new slate, new rankings. Nothing carries over from
              prior weeks except your season EYEQ history.
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-6">
          <h2 className="font-display text-xl font-semibold text-ink">
            Reveal &amp; privacy
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>
              Before Sunday lock, other users’ boards, AI boards, and consensus
              stay private. Submission counts remain visible.
            </li>
            <li>
              Community EYEQ is free after Sunday 10:00 AM CT.
            </li>
            <li>
              Individual boards may be revealed during 10:00 AM–12:00 PM CT to
              entitled viewers. After noon CT, all official boards are public.
            </li>
            <li>Historical boards stay public after that release.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-6">
          <h2 className="font-display text-xl font-semibold text-ink">
            Position depths
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Each NFL week includes five position challenges for that week&apos;s
            slate. Rankings are ordered and order matters.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-ink">
            {POSITION_CONFIGS.map((config) => (
              <li
                key={config.position}
                className="flex justify-between gap-4 border-b border-border py-2 last:border-0"
              >
                <span>
                  {config.shortLabel} · {config.label}
                </span>
                <span className="font-medium">Top {config.slotCount}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="fantasy-scoring"
          className="rounded-lg border border-border bg-surface-elevated p-6"
        >
          <h2 className="font-display text-xl font-semibold text-ink">
            Actual finishes: Full PPR fantasy scoring
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {fantasySummary.summary} RankEyeQ and FantasyTrack use the same
            scoring engine — a player&apos;s fantasy points and positional finish
            are identical in both products for the same NFL week.
          </p>
          <p className="mt-3 text-sm font-medium text-ink">
            Format: {fantasySummary.formatLabel}
          </p>

          <details className="mt-6 rounded-md border border-border bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              Detailed Full PPR scoring table
            </summary>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <FantasyTable title="Offense" rows={fantasyTables.offenseRows} />
              <FantasyTable title="D/ST" rows={fantasyTables.defenseRows} />
            </div>
          </details>
        </section>

        <section
          id="scoring"
          className="rounded-lg border border-border bg-surface-elevated p-6"
        >
          <h2 className="font-display text-xl font-semibold text-ink">
            RankEyeQ EYEQ Score
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Pick the players you believe will finish at the top this week. Your
            EYEQ Score is normalized against the theoretical maximum for that
            position depth (210 for Top-10 contests, 285 for WR Top-15).
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <ScoringPillar
              title="Find the field"
              body="Every player you correctly put inside the actual Top 10 (Top 15 for WR) earns +10."
            />
            <ScoringPillar
              title="Call the podium"
              body="Your first 3 slots are Podium Picks. If any finish actual Top 3, you earn a +10 Podium Call bonus. Order within your Top 3 does not matter."
            />
            <ScoringPillar
              title="Rank the rest"
              body="For slots 4+, exact and near-exact placements earn precision points (+5 / +3 / +1)."
            />
          </div>

          <div className="mt-6 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[20rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Component</th>
                  <th className="px-4 py-3 font-semibold">Points</th>
                </tr>
              </thead>
              <tbody className="text-ink">
                <ScoringRow label="Top-N Hit" value="+10" />
                <ScoringRow label="Precision — exact" value="+5" />
                <ScoringRow label="Precision — off by 1" value="+3" />
                <ScoringRow label="Precision — off by 2" value="+1" />
                <ScoringRow label="Actual podium — #1" value="+20" />
                <ScoringRow label="Actual podium — #2" value="+15" />
                <ScoringRow label="Actual podium — #3" value="+10" />
                <ScoringRow label="Podium Call" value="+10" />
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-muted">
            Successful Podium Calls do not also receive precision points, even on
            an exact numerical match. If a Podium Pick misses the actual podium
            but still finishes inside the Top N, normal precision scoring applies.
            Actual podium finishers ranked outside your Top 3 still earn base +
            actual podium + precision, but not the Podium Call bonus.{" "}
            {SEASON_LEADERBOARD_NOTE}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-6">
          <h2 className="font-display text-xl font-semibold text-ink">
            AI Competitors
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            AI Competitors participate under the same weekly contest rules, slot
            depths, and scoring model as Humans. They are clearly labeled and are
            not human accounts. See the{" "}
            <Link href={policyRoute("ai-disclosure")} className="text-accent hover:underline">
              AI Disclosure
            </Link>{" "}
            for details.
          </p>
        </section>
      </div>
    </Container>
  );
}

function FantasyTable({
  title,
  rows,
}: {
  title: string;
  rows: { category: string; value: string }[];
}) {
  return (
    <div>
      <h3 className="font-medium text-ink">{title}</h3>
      <table className="mt-2 w-full text-left text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.category} className="border-b border-border last:border-0">
              <td className="py-2 text-muted">{row.category}</td>
              <td className="py-2 font-medium tabular-nums text-ink">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoringPillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-4">
      <h3 className="font-medium text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function ScoringRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">{label}</td>
      <td className="px-4 py-3 font-medium tabular-nums">{value}</td>
    </tr>
  );
}
