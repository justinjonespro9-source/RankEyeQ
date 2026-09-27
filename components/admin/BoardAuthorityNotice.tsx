import type { CaptureAuthorityDecision } from "@/lib/boards/authority";

type RefusedDecision = Extract<CaptureAuthorityDecision, { allowed: false }>;

/** Neutral replacement for capture controls when capture is not permitted. */
export function BoardAuthorityNotice({
  decision,
  profileName,
}: {
  decision: RefusedDecision;
  profileName: string;
}) {
  const ownerManaged =
    decision.reason === "owner_authored_board" ||
    decision.reason === "owner_managed_profile";
  const title = ownerManaged
    ? "Owner-managed"
    : decision.reason === "system_operated_board"
      ? "System-operated"
      : "Capture unavailable";
  const body = ownerManaged
    ? `${profileName} manages this contest board in the RankEyeQ ranking workspace. Capture controls are not used for this contest.`
    : decision.message;

  return (
    <section
      className="mb-8 rounded-lg border border-border bg-surface-elevated p-5"
      role="status"
    >
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </section>
  );
}
