import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-5 py-10 text-center">
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
      {actionHref && actionLabel ? (
        <div className="mt-5">
          <Button href={actionHref} size="sm">
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
