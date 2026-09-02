import { Badge } from "@/components/ui/Badge";
import type { StepStatus } from "@/lib/admin/command-center";

export function StatusPill({ status }: { status: StepStatus | string }) {
  const tone =
    status === "Complete" || status === "Ready"
      ? "success"
      : status === "Needs Attention" || status === "Missing"
        ? "warning"
        : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}
