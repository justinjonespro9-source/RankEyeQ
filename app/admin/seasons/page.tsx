import type { Metadata } from "next";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  createSeasonAction,
  createWeekAction,
  setActiveSeasonAction,
} from "@/lib/admin-actions";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Seasons · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminSeasonsPage() {
  const seasons = await prisma.season.findMany({
    include: {
      weeks: { orderBy: { weekNumber: "asc" } },
      _count: { select: { contests: true } },
    },
    orderBy: { year: "desc" },
  });

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/seasons" />
      <SectionHeading
        eyebrow="Calendar"
        title="Seasons & weeks"
        description="Create NFL seasons and weekly windows that contests attach to."
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <form
          action={createSeasonAction}
          className="space-y-3 rounded-lg border border-border bg-surface-elevated p-5"
        >
          <h2 className="font-display text-lg font-semibold text-ink">
            Create season
          </h2>
          <label className="block text-sm">
            <span className="text-muted">Year</span>
            <input
              name="year"
              type="number"
              required
              defaultValue={2026}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Sport</span>
            <input
              name="sport"
              defaultValue="NFL"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input name="active" type="checkbox" defaultChecked />
            Set as active season
          </label>
          <Button type="submit">Create season</Button>
        </form>

        <form
          action={createWeekAction}
          className="space-y-3 rounded-lg border border-border bg-surface-elevated p-5"
        >
          <h2 className="font-display text-lg font-semibold text-ink">
            Create week
          </h2>
          <label className="block text-sm">
            <span className="text-muted">Season</span>
            <select
              name="seasonId"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
              defaultValue={seasons.find((s) => s.active)?.id}
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.sport} {season.year}
                  {season.active ? " (active)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">Week number</span>
            <input
              name="weekNumber"
              type="number"
              required
              min={1}
              defaultValue={1}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Label</span>
            <input
              name="label"
              defaultValue="Week 1"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Starts at</span>
            <input
              name="startsAt"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Ends at</span>
            <input
              name="endsAt"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Status</span>
            <select
              name="status"
              defaultValue="OPEN"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            >
              {["UPCOMING", "OPEN", "LOCKED", "COMPLETE", "ARCHIVED"].map(
                (status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ),
              )}
            </select>
          </label>
          <Button type="submit" disabled={seasons.length === 0}>
            Create week
          </Button>
        </form>
      </div>

      <div className="mt-10 space-y-4">
        {seasons.map((season) => (
          <article
            key={season.id}
            className="rounded-lg border border-border bg-surface-elevated p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">
                  {season.sport} {season.year}
                </h2>
                <p className="text-sm text-muted">
                  {season.active ? "Active" : "Inactive"} ·{" "}
                  {season._count.contests} contests · {season.weeks.length} weeks
                </p>
              </div>
              {!season.active ? (
                <form action={setActiveSeasonAction}>
                  <input type="hidden" name="seasonId" value={season.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    Make active
                  </Button>
                </form>
              ) : null}
            </div>
            <ul className="mt-4 divide-y divide-border rounded-md border border-border">
              {season.weeks.map((week) => (
                <li
                  key={week.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-ink">
                    {week.label} (#{week.weekNumber})
                  </span>
                  <span className="text-muted">{week.status}</span>
                </li>
              ))}
              {season.weeks.length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted">No weeks yet.</li>
              ) : null}
            </ul>
          </article>
        ))}
      </div>
    </Container>
  );
}
