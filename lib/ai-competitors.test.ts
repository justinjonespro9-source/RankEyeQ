import { describe, expect, it } from "vitest";
import {
  EXPECTED_ACTIVE_AI_COMPETITOR_COUNT,
  OFFICIAL_AI_COMPETITORS,
  OFFICIAL_AI_USERNAMES,
  RETIRED_AI_USERNAMES,
  isOfficialAiUsername,
} from "@/lib/ai-competitors";

describe("official AI competitor roster", () => {
  it("defines exactly eight active competitors", () => {
    expect(EXPECTED_ACTIVE_AI_COMPETITOR_COUNT).toBe(8);
    expect(OFFICIAL_AI_COMPETITORS).toHaveLength(8);
    expect(OFFICIAL_AI_USERNAMES.size).toBe(8);
  });

  it("uses GPT (not ChatGPT) and does not include Pipes", () => {
    const usernames = OFFICIAL_AI_COMPETITORS.map((bot) => bot.username);
    const names = OFFICIAL_AI_COMPETITORS.map((bot) => bot.displayName);
    expect(usernames).toEqual([
      "gpt",
      "claude",
      "deepseek",
      "gemini",
      "llama",
      "mistral",
      "perplexity",
      "grok",
    ]);
    expect(names).toContain("GPT");
    expect(names).not.toContain("ChatGPT");
    expect(usernames).not.toContain("pipes");
    expect(usernames).not.toContain("chatgpt");
    expect(RETIRED_AI_USERNAMES.has("pipes")).toBe(true);
    expect(RETIRED_AI_USERNAMES.has("chatgpt")).toBe(true);
  });

  it("has unique usernames and display names", () => {
    const usernames = OFFICIAL_AI_COMPETITORS.map((bot) => bot.username);
    const names = OFFICIAL_AI_COMPETITORS.map((bot) => bot.displayName);
    expect(new Set(usernames).size).toBe(usernames.length);
    expect(new Set(names).size).toBe(names.length);
    expect(isOfficialAiUsername("GPT")).toBe(true);
    expect(isOfficialAiUsername("pipes")).toBe(false);
  });
});
