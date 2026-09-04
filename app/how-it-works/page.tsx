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
  SCORING_CALL_THE_PODIUM,
  SCORING_FIND_THE_FIELD,
  SCORING_RANK_THE_REST,
  SCORING_TABLE_ROWS,
  getEyeqWorkedExample,
} from "@/lib/scoring-messaging";
import {
  NOT_DRAFT_OR_PROJECTIONS,
  SEASON_LEADERBOARD_NOTE,
  WEEKLY_RANKINGS_EXPLAINER,
  WEEKLY_RANKINGS_SHORT,
  WEEKLY_RANKINGS_TAGLINE,
} from "@/lib/weekly-messaging";
import { TOP_10_MAX_RAW, TOP_15_MAX_RAW } from "@/lib/scoring";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How RankEyeQ fantasy points and EYEQ Scores are calculated — Full PPR finishes and weekly ranking accuracy.",
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
    body: "After the Sunday lock, community, human, Expert, Creator, and AI rankings can be revealed during the reveal window.",
  },
  {
    title: "Watch the games decide",
    body: "Actual fantasy production determines each player's final positional order using FantasyTrack Full PPR scoring — the same engine RankEyeQ and FantasyTrack share.",
  },
  {
    title: "Build your RankEyeQ",
    body: "Your EYEQ Score rewards accurate rankings — especially getting the very top of the board right.",
  },
];

export default function HowItWorksPage() {
  const fantasySummary = getFantasyScoringSummary();
  const fantasyTables = getFantasyScoringReferenceTables();
  const example = getEyeqWorkedExample();

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
        <p className="mt-3 text-sm text-muted">
          Jump to{" "}
          <a href="#fantasy-scoring" className="font-medium text-accent hover:underline">
            fantasy scoring
          </a>{" "}
          or{" "}
          <a href="#scoring" className="font-medium text-accent hover:underline">
            EYEQ Score
          </a>
          .
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
              Humans, Experts, Creators, and labeled AI Competitors use the same
              weekly rules and scoring. See the{" "}
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
            <li>Community EYEQ is free after Sunday 10:00 AM CT.</li>
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
          className="scroll-mt-24 rounded-lg border border-border bg-surface-elevated p-6"
        >
          <h2 className="font-display text-xl font-semibold text-ink">
            How fantasy points are calculated
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {fantasySummary.summary} RankEyeQ and FantasyTrack use the same
            scoring engine — a player&apos;s fantasy points and positional finish
            are identical in both products for the same NFL week.
          </p>
          <p className="mt-3 text-sm font-medium text-ink">
            Format: {fantasySummary.formatLabel} · version{" "}
            <span className="font-mono text-xs">{fantasySummary.version}</span>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            There are <strong className="font-medium text-ink">no</strong>{" "}
            100-yard rushing or receiving bonuses and{" "}
            <strong className="font-medium text-ink">no</strong> 300-yard passing
            bonus in the production engine. Fumble scoring applies to{" "}
            <em>fumbles lost</em> only.
          </p>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <FantasyTable title="Offense" rows={fantasyTables.offenseRows} />
            <FantasyTable title="D/ST" rows={fantasyTables.defenseRows} />
          </div>

          <p className="mt-4 text-sm leading-relaxed text-muted">
            Positional finishes use competition ranking on fantasy points (e.g.
            tied scores share a rank such as 1, 2, 2, 4). Those ranks are what
            EYEQ grades against.
          </p>
        </section>

        <section
          id="scoring"
          className="scroll-mt-24 rounded-lg border border-border bg-surface-elevated p-6"
        >
          <h2 className="font-display text-xl font-semibold text-ink">
            How your EYEQ Score is calculated
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Pick the players you believe will finish at the top this week. Your
            EYEQ Score is raw ranking points divided by the theoretical maximum
            for that position depth ({TOP_10_MAX_RAW} for Top-10 contests,{" "}
            {TOP_15_MAX_RAW} for WR Top-15), then scaled to 0–100.
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <ScoringPillar title="Find the field" body={SCORING_FIND_THE_FIELD} />
            <ScoringPillar
              title="Call the podium"
              body={SCORING_CALL_THE_PODIUM}
            />
            <ScoringPillar title="Rank the rest" body={SCORING_RANK_THE_REST} />
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
                {SCORING_TABLE_ROWS.map((row) => (
                  <ScoringRow key={row.label} label={row.label} value={row.value} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-muted">
            Successful Podium Calls do not also receive precision points, even on
            an exact numerical match. If a Podium Pick misses the actual podium
            but still finishes inside the Top N, normal precision scoring applies.
            Actual podium finishers ranked outside your Top 3 still earn base +
            actual podium + precision, but not the Podium Call bonus. Picks whose
            actual finish is outside the scoring field earn 0.{" "}
            {SEASON_LEADERBOARD_NOTE}
          </p>

          <div className="mt-8 rounded-md border border-border bg-surface px-4 py-5">
            <h3 className="font-display text-lg font-semibold text-ink">
              Worked ranking example (Top 10)
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Point totals below are computed with the production{" "}
              <code className="text-xs">scorePlayerPick</code> engine — not
              hand-rounded marketing math.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[24rem] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Pick</th>
                    <th className="py-2 pr-3 font-semibold">Pts</th>
                    <th className="py-2 font-semibold">Why</th>
                  </tr>
                </thead>
                <tbody className="text-ink">
                  {example.picks.map((pick) => (
                    <tr
                      key={pick.label}
                      className="border-b border-border last:border-0 align-top"
                    >
                      <td className="py-2.5 pr-3 font-medium">{pick.label}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{pick.totalPoints}</td>
                      <td className="py-2.5 text-muted">{pick.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
              {example.narrative.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
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
