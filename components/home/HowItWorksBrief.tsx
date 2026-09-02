import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { CONTEST_ELIGIBILITY } from "@/lib/contest";
import { SEASON_LEADERBOARD_NOTE } from "@/lib/weekly-messaging";

const STEPS = [
  {
    title: "Pick a weekly contest",
    body: "Each NFL week has five position boards — QB, RB, WR, TE, and DEF. A new slate every week.",
  },
  {
    title: "Rank before kickoff",
    body: "Order this week's players for that position. Slots lock at each player's kickoff; the board fully locks Sunday 10:00 AM CT.",
  },
  {
    title: "Get graded on actual results",
    body: "After games finish, your board is scored against that week's actual fantasy-point finishes — not projections or season-long guesses.",
  },
  {
    title: "Climb the season ladder",
    body: `Weekly EYEQ scores roll into season leaderboards. ${SEASON_LEADERBOARD_NOTE}`,
  },
];

export function HowItWorksBrief() {
  return (
    <section className="py-16 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow="The game"
          title="How it works"
          description="Weekly rankings for this week's NFL slate — not a draft board and not season-long projections."
          action={
            <Button href="/how-it-works" variant="secondary" size="sm">
              Full rules
            </Button>
          }
        />
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              <span className="font-display text-sm font-semibold text-accent">
                0{index + 1}
              </span>
              <h3 className="mt-2 font-display text-lg font-semibold text-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-muted">{CONTEST_ELIGIBILITY}</p>
      </Container>
    </section>
  );
}
