import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import {
  SCORING_CALL_THE_PODIUM,
  SCORING_FIND_THE_FIELD,
  SCORING_HEADLINE,
  SCORING_RANK_THE_REST,
  SCORING_TABLE_ROWS,
} from "@/lib/scoring-messaging";

const PILLARS = [
  {
    title: "Find the field",
    body: SCORING_FIND_THE_FIELD,
  },
  {
    title: "Call the podium",
    body: SCORING_CALL_THE_PODIUM,
  },
  {
    title: "Rank the rest",
    body: SCORING_RANK_THE_REST,
  },
];

export function ScoringBrief() {
  return (
    <section className="border-t border-border bg-surface py-16 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow="Scoring"
          title={SCORING_HEADLINE}
          description="Your EYEQ Score reflects how well your weekly rankings match actual fantasy-point finishes — not projections."
          action={
            <Button href="/how-it-works#scoring" variant="secondary" size="sm">
              Full scoring rules
            </Button>
          }
        />

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-lg border border-border bg-surface-elevated p-5"
            >
              <h3 className="font-display text-lg font-semibold text-ink">
                {pillar.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {pillar.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
          <table className="w-full min-w-[20rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Component</th>
                <th className="px-4 py-3 font-semibold">Points</th>
              </tr>
            </thead>
            <tbody>
              {SCORING_TABLE_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-ink">{row.label}</td>
                  <td className="px-4 py-3 font-medium tabular-nums text-ink">
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  );
}
