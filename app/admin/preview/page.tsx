import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getCommandCenterSnapshot } from "@/lib/admin/command-center";
import { adminTestPreviewLinks } from "@/lib/admin/test-preview";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Test week preview",
  description: "Admin-only preview of test week data on public surfaces.",
};

export const dynamic = "force-dynamic";

export default async function AdminTestPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string }>;
}) {
  const params = await searchParams;
  const snapshot = await getCommandCenterSnapshot(params.weekId);

  const testWeeks = await prisma.week.findMany({
    where: { isTest: true },
    orderBy: [{ season: { year: "desc" } }, { weekNumber: "desc" }],
    include: { season: true },
    take: 20,
  });

  const weekId = params.weekId ?? testWeeks[0]?.id ?? null;
  const week = testWeeks.find((row) => row.id === weekId) ?? testWeeks[0] ?? null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/preview" />
      <SectionHeading
        eyebrow="Admin"
        title="Test week preview"
        description="Inspect how test-week data renders on public pages. Test weeks never appear for signed-out users or non-admins."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {testWeeks.map((item) => (
          <Link
            key={item.id}
            href={`/admin/preview?weekId=${item.id}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              item.id === week?.id
                ? "bg-accent text-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.season.year} · {item.label}
          </Link>
        ))}
      </div>

      {week ? (
        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            {week.label}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Append <code className="text-ink">?adminTest=1</code> while signed in as
            admin. Production users never see this data.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {adminTestPreviewLinks(week.id).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block rounded-md border border-border px-3 py-2 text-sm font-medium text-accent hover:underline"
                >
                  {link.label} →
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            Profile stats: add{" "}
            <code>?adminTest=1</code> when viewing a test ranker profile (admin session required).
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted">No test weeks found.</p>
      )}

      {snapshot.selectedWeekId && !week?.isTest ? (
        <p className="mt-4 text-sm text-warning">
          Selected command-center week is not marked isTest — use a test week from the list above.
        </p>
      ) : null}
    </Container>
  );
}
