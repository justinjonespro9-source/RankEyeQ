"use client";

import Link from "next/link";
import { StatusPill } from "@/components/admin/StatusPill";
import type { ReadinessChecklistItem } from "@/lib/admin/readiness-checklist";

export function ReadinessChecklistPanel({
  items,
}: {
  items: ReadinessChecklistItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        Weekly readiness checklist
      </h2>
      <p className="mt-1 text-sm text-muted">
        Derived automatically from schedule, pools, timing, and submission state.
      </p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item, index) => (
          <li
            key={item.key}
            className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <div>
              <p className="font-medium text-ink">
                {index + 1}. {item.label}
              </p>
              <p className="mt-0.5 text-muted">{item.summary}</p>
              {item.href ? (
                <Link href={item.href} className="mt-1 inline-block text-xs text-accent hover:underline">
                  Open →
                </Link>
              ) : null}
            </div>
            <StatusPill status={item.status} />
          </li>
        ))}
      </ol>
    </section>
  );
}
