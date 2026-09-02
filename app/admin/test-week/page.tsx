import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  createHistoricalTestWeekAction,
  runHistoricalTestStepAction,
} from "@/lib/admin-historical-actions";
import { listHistoricalTestWeeks } from "@/lib/admin/historical-test";
import { privatePageMetadata } from "@/lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Historical test week · Admin",
  "Run a completed NFL week end-to-end without contaminating live leaderboards.",
);

export const dynamic = "force-dynamic";

const STEPS = [
  { key: "schedule", label: "1. Fetch schedule + pool import" },
  { key: "contests", label: "2. Build contests" },
  { key: "pool", label: "3. Build player pools" },
  { key: "stats", label: "4. Fetch final stats + fantasy points" },
  { key: "finishes", label: "5. Calculate actual finishes" },
  { key: "seed_bots", label: "6. Seed AI test submissions" },
  { key: "grade", label: "7. Grade" },
] as const;

export default async function HistoricalTestWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string; notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const weeks = await listHistoricalTestWeeks();
  const selected = weeks.find((week) => week.id === params.weekId) ?? weeks[0] ?? null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/test-week" />
      <SectionHeading
        eyebrow="Sandbox"
        title="Historical test week"
        description="Run a completed NFL week against the real provider to validate mappings before live Week 1. Test weeks are excluded from public leaderboards and consensus."
      />

      <div className="mb-6 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
        This is a historical TEST run. It cannot be confused with live production contests.
      </div>

      {params.notice ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          {params.notice}
        </p>
      ) : null}
      {params.error ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          {params.error}
        </p>
      ) : null}

      <form
        action={createHistoricalTestWeekAction}
        className="mb-8 grid gap-2 rounded-lg border border-border bg-surface-elevated p-5 sm:grid-cols-4"
      >
        <label className="text-sm sm:col-span-1">
          Season year
          <input
            name="year"
            type="number"
            required
            defaultValue={2025}
            className="mt-1 w-full rounded-md border border-border px-3 py-2"
          />
        </label>
        <label className="text-sm sm:col-span-1">
          Week number
          <input
            name="weekNumber"
            type="number"
            required
            min={1}
            max={22}
            defaultValue={18}
            className="mt-1 w-full rounded-md border border-border px-3 py-2"
          />
        </label>
        <div className="flex items-end sm:col-span-2">
          <Button type="submit" size="sm">
            Create / open historical test week
          </Button>
        </div>
      </form>

      {weeks.length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {weeks.map((week) => (
            <Link
              key={week.id}
              href={`/admin/test-week?weekId=${week.id}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                selected?.id === week.id
                  ? "bg-accent text-white"
                  : "border border-border bg-surface-elevated text-ink"
              }`}
            >
              {week.label}
            </Link>
          ))}
        </div>
      ) : null}

      {selected ? (
        <section className="rounded-lg border border-dashed border-warning/50 bg-warning-soft/20 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">TEST</Badge>
            <h2 className="font-display text-xl font-semibold text-ink">
              {selected.label}
            </h2>
            <Badge tone="neutral">{selected.status}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted">
            {selected.season.year} · {selected.season.sport} · {selected.contests.length} contests
          </p>
          <ol className="mt-4 space-y-2">
            {STEPS.map((step) => (
              <li key={step.key}>
                <form action={runHistoricalTestStepAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="weekId" value={selected.id} />
                  <input type="hidden" name="step" value={step.key} />
                  <Button type="submit" size="sm" variant="secondary">
                    {step.label}
                  </Button>
                </form>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/consensus?test=1&weekId=${selected.id}`}
              className="font-medium text-accent hover:underline"
            >
              Review test consensus
            </Link>
            <Link
              href={`/leaderboards?test=1&weekId=${selected.id}`}
              className="font-medium text-accent hover:underline"
            >
              Review test leaderboard
            </Link>
            <Link href="/admin/ai" className="font-medium text-accent hover:underline">
              Enter more AI boards
            </Link>
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted">Create a historical test week to begin.</p>
      )}
    </Container>
  );
}
