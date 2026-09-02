import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { ThursdayReceiptRow } from "@/lib/timing/thursday-receipts";

export function ThursdayReceiptsPreview({
  weekLabel,
  rows,
}: {
  weekLabel: string | null;
  rows: ThursdayReceiptRow[];
}) {
  if (rows.length === 0) return null;
  const highlight = rows.find((row) => row.numberOneCallers.length > 0) ?? rows[0];

  return (
    <section className="border-b border-border py-12 sm:py-16">
      <Container>
        <SectionHeading
          eyebrow="Thursday Receipts"
          title="Early-game receipts"
          description={`${weekLabel ?? "This week"} · completed performances and pre-kickoff conviction only.`}
          action={
            <Link
              href="/receipts"
              className="text-sm font-medium text-accent hover:underline"
            >
              Full receipts
            </Link>
          }
        />
        {highlight ? (
          <p className="mt-4 text-sm text-ink">
            <strong>
              {highlight.boardsIncluding} official board
              {highlight.boardsIncluding === 1 ? "" : "s"}
            </strong>{" "}
            had {highlight.name} before kickoff
            {highlight.numberOneCallers[0]
              ? ` · ${highlight.numberOneCallers[0].displayName} had ${highlight.name.split(" ").slice(-1)[0]} ${highlight.position}1`
              : ""}
            .
          </p>
        ) : null}
        <ol className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface-elevated">
          {rows.slice(0, 5).map((row) => (
            <li
              key={row.rankableEntryId}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="min-w-0 truncate font-medium text-ink">
                {row.name}{" "}
                <span className="text-muted">
                  {row.position} · {row.team}
                </span>
              </span>
              <span className="tabular-nums text-ink">
                {row.fantasyPoints?.toFixed(1) ?? "—"} pts
              </span>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
