import {
  OFFICIAL_AI_USERNAMES,
  RETIRED_AI_USERNAMES,
} from "@/lib/ai-competitors";
import { OFFICIAL_BENCHMARK_USERNAMES } from "@/lib/benchmark-sources";

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/** Reserved usernames (system, brand, seeded AI bots, admin-adjacent). */
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "bot",
  "bots",
  "consensus",
  "creator",
  "following",
  "help",
  "howto",
  "leaderboard",
  "leaderboards",
  "mod",
  "moderator",
  "null",
  "official",
  "profile",
  "rank",
  "rankiq",
  "rankers",
  "rankiqadmin",
  "receipts",
  "results",
  "root",
  "staff",
  "support",
  "system",
  "undefined",
  ...OFFICIAL_AI_USERNAMES,
  ...RETIRED_AI_USERNAMES,
  ...OFFICIAL_BENCHMARK_USERNAMES,
]);

export type UsernameValidation =
  | { ok: true; username: string }
  | { ok: false; error: string };

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): UsernameValidation {
  const username = normalizeUsername(raw);
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error:
        "Username must be 3–24 characters: lowercase letters, numbers, underscores.",
    };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, error: "That username is reserved." };
  }
  return { ok: true, username };
}

export function validateDisplayName(raw: string): UsernameValidation {
  const displayName = raw.trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 40) {
    return {
      ok: false,
      error: "Display name must be between 2 and 40 characters.",
    };
  }
  return { ok: true, username: displayName };
}
