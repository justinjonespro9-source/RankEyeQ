import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";

export function AdminBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-6 rounded-lg border border-dashed border-warning/40 bg-warning-soft/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warning">Admin</Badge>
        <p className="text-sm text-muted">
          Internal operator tooling. Admin role required. Public scoring is unchanged.
        </p>
      </div>
      {children}
    </div>
  );
}
