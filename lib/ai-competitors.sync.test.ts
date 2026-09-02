import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  EXPECTED_ACTIVE_AI_COMPETITOR_COUNT,
  OFFICIAL_AI_USERNAMES,
} from "@/lib/ai-competitors";
import {
  countActiveAiCompetitors,
  ensureOfficialAiCompetitors,
  listActiveAiCompetitors,
} from "@/lib/ai-competitors-sync";
import { prisma } from "@/lib/db";

describe("AI competitor sync + DB roster", () => {
  afterAll(async () => {
    // leave shared client for other suites
  });

  it("ensures exactly 8 active AI competitors with no GPT/ChatGPT duplicate", async () => {
    const result = await ensureOfficialAiCompetitors();
    expect(result.ok).toBe(true);
    expect(result.activeCount).toBe(EXPECTED_ACTIVE_AI_COMPETITOR_COUNT);

    const active = await listActiveAiCompetitors();
    expect(active).toHaveLength(8);
    expect(active.every((bot) => bot.profileType === "AI")).toBe(true);
    expect(active.every((bot) => bot.competitorActive)).toBe(true);
    expect(active.map((bot) => bot.username).sort()).toEqual(
      [...OFFICIAL_AI_USERNAMES].sort(),
    );

    const gpt = active.find((bot) => bot.username === "gpt");
    expect(gpt?.displayName).toBe("GPT");
    expect(active.some((bot) => bot.username === "chatgpt")).toBe(false);
    expect(active.some((bot) => bot.username === "pipes")).toBe(false);

    const chatgpt = await prisma.universalProfile.findUnique({
      where: { username: "chatgpt" },
    });
    expect(chatgpt).toBeNull();

    const pipes = await prisma.universalProfile.findUnique({
      where: { username: "pipes" },
    });
    if (pipes) {
      expect(pipes.competitorActive).toBe(false);
    }

    expect(await countActiveAiCompetitors()).toBe(8);
  });

  it("keeps historical AI submissions intact for official bots", async () => {
    const claude = await prisma.universalProfile.findUnique({
      where: { username: "claude" },
    });
    expect(claude).toBeTruthy();
    if (!claude) return;
    const before = await prisma.rankingSubmission.count({
      where: { universalProfileId: claude.id },
    });
    await ensureOfficialAiCompetitors();
    const after = await prisma.rankingSubmission.count({
      where: { universalProfileId: claude.id },
    });
    expect(after).toBe(before);
  });
});
