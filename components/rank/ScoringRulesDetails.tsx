import Link from "next/link";
import {
  eyeqFieldLabel,
  getCompactEyeqExplanation,
  getCompactFantasyScoringBullets,
} from "@/lib/scoring-messaging";

/**
 * Compact Scoring & Rules disclosure on ranking pages.
 * Values come from production fantasy + EYEQ engines via scoring-messaging.
 */
export function ScoringRulesDetails({
  slotCount,
  positionLabel,
}: {
  slotCount: number;
  positionLabel: string;
}) {
  const fantasy = getCompactFantasyScoringBullets();
  const eyeqLines = getCompactEyeqExplanation(slotCount);
  const field = eyeqFieldLabel(slotCount);

  return (
    <details className="mb-6 rounded-lg border border-border bg-surface-elevated px-4 py-3 sm:px-5">
      <summary className="cursor-pointer list-none text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          Scoring &amp; Rules
          <span className="font-normal text-muted">
            · Half PPR finishes · {positionLabel} {field} EYEQ
          </span>
        </span>
      </summary>

      <div className="mt-4 grid gap-5 border-t border-border pt-4 text-sm sm:grid-cols-2">
        <div>
          <h3 className="font-medium text-ink">Fantasy scoring (actual finishes)</h3>
          <p className="mt-1.5 leading-relaxed text-muted">{fantasy.summary}</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">
            {fantasy.formatLabel}
          </p>
          <ul className="mt-2 space-y-1 text-muted">
            {[
              ...fantasy.offenseRows.slice(0, 6),
              ...fantasy.offenseRows.filter((row) =>
                /bonus|milestone/i.test(row.category),
              ),
            ]
              .filter(
                (row, index, all) =>
                  all.findIndex((r) => r.category === row.category) === index,
              )
              .map((row) => (
              <li key={row.category} className="flex justify-between gap-3">
                <span>{row.category}</span>
                <span className="shrink-0 tabular-nums text-ink">{row.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Punt/kick return TDs: +6 for the returner and +6 for team D/ST (separate
            entities). INT/fumble-return TDs: +6 for D/ST. Milestone bonuses: +5 at
            300+ pass / 100+ rush / 100+ receiving (once each, stackable). Full table
            on How It Works.
          </p>
        </div>

        <div>
          <h3 className="font-medium text-ink">
            EYEQ Score · {positionLabel} {field}
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 leading-relaxed text-muted">
            {eyeqLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 text-sm">
        <Link href="/how-it-works#scoring" className="font-medium text-accent hover:underline">
          Full scoring rules &amp; worked example
        </Link>
      </p>
    </details>
  );
}
