import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { ResultsSubnav } from "@/components/layout/ResultsSubnav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { prisma } from "@/lib/db";
import { PUBLIC_INDEX, canonicalMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Season archive",
  description: "Browse finalized RankEyeQ weeks by season and position.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/archive"),
};

export const dynamic = "force-dynamic";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ seasonId?: string }>;
}) {
  const params = await searchParams;
  const seasons = await prisma.season.findMany({
    where: { sport: "NFL" },
    include: {
      weeks: {
        where: { isTest: false },
        orderBy: { weekNumber: "desc" },
        include: {
          contests: {
            where: { status: { in: ["FINAL", "ARCHIVED"] } },
            orderBy: { position: "asc" },
          },
        },
      },
    },
    orderBy: { year: "desc" },
  });

  const seasonId =
    params.seasonId ?? seasons.find((season) => season.active)?.id ?? seasons[0]?.id;
  const season = seasons.find((item) => item.id === seasonId) ?? seasons[0];

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="History"
        title="Season archive"
        description="Finalized weeks stay permanently viewable. Browse by season, week, and position."
      />
      <ResultsSubnav />

      <div className="mb-6 flex flex-wrap gap-2">
        {seasons.map((item) => (
          <Link
            key={item.id}
            href={`/archive?seasonId=${item.id}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              season?.id === item.id
                ? "bg-accent text-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.year}
            {item.active ? " (current)" : ""}
          </Link>
        ))}
      </div>

      {!season ? (
        <p className="text-sm text-muted">No seasons configured yet.</p>
      ) : (
        <div className="space-y-6">
          {season.weeks.map((week) => (
            <section
              key={week.id}
              className="rounded-lg border border-border bg-surface-elevated p-5"
            >
              <h2 className="font-display text-lg font-semibold text-ink">
                {week.label}
              </h2>
              {week.contests.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No finalized contests yet.</p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {week.contests.map((contest) => (
                    <li key={contest.id}>
                      <Link
                        href={`/results?contestId=${contest.id}`}
                        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-ink/30"
                      >
                        {contest.position} results
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Container>
  );
}
