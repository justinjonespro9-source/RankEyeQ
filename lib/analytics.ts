import { logServerEvent } from "@/lib/log";

export type AnalyticsEventName =
  | "signup_completed"
  | "ranking_started"
  | "ranking_submitted"
  | "ranking_reordered"
  | "consensus_viewed"
  | "profile_followed"
  | "ranker_profile_viewed"
  | "premium_board_gate_viewed"
  | "board_unlocked"
  | "creator_enabled"
  | "thursday_receipt_viewed"
  | "leaderboard_shared"
  | "share_clicked";

export type AnalyticsProps = Record<string, string | number | boolean | null>;

const PII_KEYS = /(email|phone|token|secret|password|name|ip|address)/i;

function sanitizeProps(props?: AnalyticsProps) {
  if (!props) return undefined;
  const out: AnalyticsProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (PII_KEYS.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Vendor-agnostic analytics stub. Swap the sink later (Vercel Analytics, etc.).
 * Never send PII.
 */
export function trackEvent(
  event: AnalyticsEventName,
  props?: AnalyticsProps,
) {
  const safe = sanitizeProps(props);
  logServerEvent(`analytics.${event}`, safe);
}

export function trackClientEvent(
  event: AnalyticsEventName,
  props?: AnalyticsProps,
) {
  if (typeof window === "undefined") return;
  const safe = sanitizeProps(props);
  window.dispatchEvent(
    new CustomEvent("rankiq:analytics", { detail: { event, props: safe } }),
  );
}
