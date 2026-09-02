import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { createContestAction } from "@/lib/admin-actions";
import { CONTEST_POSITIONS, rankingDepthForPosition } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Contests · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminContestsPage() {
  const [weeks, contests] = await Promise.all([
    prisma.week.findMany({
      include: { season: true },
      orderBy: [{ season: { year: "desc" } }, { weekNumber: "asc" }],
    }),
    prisma.rankIQContest.findMany({
      include: {
        week: true,
        season: true,
        _count: { select: { entries: true, submissions: true } },
      },
      orderBy: [{ week: { weekNumber: "asc" } }, { position: "asc" }],
    }),
  ]);

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/contests" />
      <SectionHeading
        eyebrow="Weekly challenges"
        title="Contest management"
        description="Each position challenge is its own RankEyeQ contest with a persisted ranking depth."
      />

      <form
        action={createContestAction}
        className="mb-10 grid gap-3 rounded-lg border border-border bg-surface-elevated p-5 sm:grid-cols-2"
      >
        <h2 className="font-display text-lg font-semibold text-ink sm:col-span-2">
          Create contest
        </h2>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Week</span>
          <select
            name="weekId"
            required
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            {weeks.map((week) => (
              <option key={week.id} value={week.id}>
                {week.season.sport} {week.season.year} · {week.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Position</span>
          <select
            name="position"
            required
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            {CONTEST_POSITIONS.map((position) => (
              <option key={position} value={position}>
                {position} (Top {rankingDepthForPosition(position)})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Status</span>
          <select
            name="status"
            defaultValue="OPEN"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            {[
              "DRAFT",
              "OPEN",
              "LOCKED",
              "LIVE",
              "GRADING",
              "FINAL",
              "ARCHIVED",
            ].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Title</span>
          <input
            name="title"
            placeholder="Optional — defaults from position depth"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Opens at</span>
          <input
            name="opensAt"
            type="datetime-local"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Locks at</span>
          <input
            name="locksAt"
            type="datetime-local"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={weeks.length === 0}>
            Create contest
          </Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">Contest</th>
              <th className="px-3 py-3">Depth</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Entries</th>
              <th className="px-3 py-3">Subs</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {contests.map((contest) => (
              <tr key={contest.id} className="border-b border-border last:border-0">
                <td className="px-3 py-3">
                  <p className="font-medium text-ink">
                    {contest.position} · {contest.week.label}
                  </p>
                  <p className="text-xs text-muted">{contest.title}</p>
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {contest.rankingDepth}
                </td>
                <td className="px-3 py-3">
                  <Badge
                    tone={contest.status === "OPEN" ? "success" : "neutral"}
                  >
                    {contest.status}
                  </Badge>
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {contest._count.entries}
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {contest._count.submissions}
                </td>
                <td className="px-3 py-3 text-right">
                  <Link
                    href={`/admin/contests/${contest.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
            {contests.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-muted">
                  No contests yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Container>
  );
}
