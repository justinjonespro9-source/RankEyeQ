import { Container } from "@/components/layout/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { AiVsHumanSummary } from "@/lib/homepage";
import { formatRankIqScore } from "@/lib/scoring";

export function AiVsHuman({ summary }: { summary: AiVsHumanSummary | null }) {
  const sample =
    (summary?.sampleHumans ?? 0) +
    (summary?.sampleExperts ?? 0) +
    (summary?.sampleAi ?? 0);
  const thin = !summary || sample < 2;

  return (
    <section className="border-y border-border bg-surface py-16 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow="Same rules for everyone"
          title="Experts vs Humans vs AI"
          description="Simple averages from graded weekly boards — each NFL week is a separate contest. Expert sources are scored independently and are not mixed into Human averages."
        />
        {thin || !summary ? (
          <EmptyState
            title="Not enough graded data yet"
            description="Averages appear once graded contests exist. Expert sources are scored independently and are not mixed into Human averages."
          />
        ) : (
          <div className="grid gap-6 sm:grid-cols-3">
            <AverageCard
              title="Humans"
              average={summary.humanAverage}
              sample={summary.sampleHumans}
              top={summary.topHuman}
            />
            <AverageCard
              title="Expert sources"
              average={summary.expertAverage}
              sample={summary.sampleExperts}
              top={summary.topExpert}
              isExpert
            />
            <AverageCard
              title="AI bots"
              average={summary.aiAverage}
              sample={summary.sampleAi}
              top={summary.topAi}
              isAi
            />
          </div>
        )}
      </Container>
    </section>
  );
}

function AverageCard({
  title,
  average,
  sample,
  top,
  isAi = false,
  isExpert = false,
}: {
  title: string;
  average: number | null;
  sample: number;
  top: AiVsHumanSummary["topHuman"];
  isAi?: boolean;
  isExpert?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-elevated p-6">
      <h3 className="font-display text-xl font-semibold text-ink">{title}</h3>
      <p className="mt-3 font-display text-3xl font-semibold tabular-nums text-ink">
        {average == null ? "—" : formatRankIqScore(average)}
      </p>
      <p className="mt-1 text-sm text-muted">
        Average EYEQ Score · {sample} profile{sample === 1 ? "" : "s"}
      </p>
      {top ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Top:</span>
          <ProfileLink
            username={top.username}
            displayName={top.displayName}
            isAi={isAi}
            isExpert={isExpert}
          />
          <span className="tabular-nums text-ink">
            ({formatRankIqScore(top.averageScore)})
          </span>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">No graded boards yet.</p>
      )}
    </div>
  );
}
