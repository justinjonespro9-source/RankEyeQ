import { Badge } from "@/components/ui/Badge";

export function CreatorBadge({
  enabled,
  qualified,
}: {
  enabled?: boolean;
  qualified?: boolean;
}) {
  if (enabled) {
    return <Badge tone="success">Creator</Badge>;
  }
  if (qualified) {
    return <Badge tone="neutral">Qualified</Badge>;
  }
  return null;
}
