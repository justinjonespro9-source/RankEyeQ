/**
 * Official RankIQ AI competitor roster (Handicap Hero–aligned).
 * Seed/upsert and admin coverage should use this list — do not hardcode bots elsewhere.
 */

export type OfficialAiCompetitor = {
  username: string;
  displayName: string;
  universalUserId: string;
};

export const OFFICIAL_AI_COMPETITORS: readonly OfficialAiCompetitor[] = [
  { username: "gpt", displayName: "GPT", universalUserId: "uu_bot_gpt" },
  { username: "claude", displayName: "Claude", universalUserId: "uu_bot_claude" },
  {
    username: "deepseek",
    displayName: "DeepSeek",
    universalUserId: "uu_bot_deepseek",
  },
  { username: "gemini", displayName: "Gemini", universalUserId: "uu_bot_gemini" },
  { username: "llama", displayName: "Llama", universalUserId: "uu_bot_llama" },
  {
    username: "mistral",
    displayName: "Mistral",
    universalUserId: "uu_bot_mistral",
  },
  {
    username: "perplexity",
    displayName: "Perplexity",
    universalUserId: "uu_bot_perplexity",
  },
  { username: "grok", displayName: "Grok", universalUserId: "uu_bot_grok" },
] as const;

export const EXPECTED_ACTIVE_AI_COMPETITOR_COUNT = OFFICIAL_AI_COMPETITORS.length;

export const OFFICIAL_AI_USERNAMES = new Set(
  OFFICIAL_AI_COMPETITORS.map((bot) => bot.username),
);

/** Legacy usernames kept reserved so humans cannot claim them. */
export const RETIRED_AI_USERNAMES = new Set(["pipes", "chatgpt"]);

export function isOfficialAiUsername(username: string) {
  return OFFICIAL_AI_USERNAMES.has(username.trim().toLowerCase());
}

export function isRetiredAiUsername(username: string) {
  return RETIRED_AI_USERNAMES.has(username.trim().toLowerCase());
}
