import { prisma } from "@/lib/db";
import {
  EXPECTED_ACTIVE_AI_COMPETITOR_COUNT,
  OFFICIAL_AI_COMPETITORS,
  OFFICIAL_AI_USERNAMES,
} from "@/lib/ai-competitors";

type AiDb = {
  universalProfile: typeof prisma.universalProfile;
  rankingSubmission: typeof prisma.rankingSubmission;
};

/**
 * Active AI competitors for coverage, seeding bots into contests, smoke checks.
 * Excludes retired bots (competitorActive=false) and suspended profiles.
 */
export async function listActiveAiCompetitors(db: AiDb = prisma) {
  return db.universalProfile.findMany({
    where: {
      profileType: "AI",
      competitorActive: true,
      status: "ACTIVE",
    },
    orderBy: { displayName: "asc" },
  });
}

export async function countActiveAiCompetitors(db: AiDb = prisma) {
  return db.universalProfile.count({
    where: {
      profileType: "AI",
      competitorActive: true,
      status: "ACTIVE",
    },
  });
}

/**
 * Idempotent upsert of the official 8-bot roster + ChatGPT→GPT rename + Pipes retire.
 * Safe for seed and one-off migrate scripts. Does not delete graded history.
 */
export async function ensureOfficialAiCompetitors(db: AiDb = prisma) {
  // 1) Normalize OpenAI identity: ChatGPT → GPT (username gpt)
  const chatgpt = await db.universalProfile.findUnique({
    where: { username: "chatgpt" },
  });
  const gptExisting = await db.universalProfile.findUnique({
    where: { username: "gpt" },
  });

  if (chatgpt && !gptExisting) {
    await db.universalProfile.update({
      where: { id: chatgpt.id },
      data: {
        username: "gpt",
        displayName: "GPT",
        universalUserId: "uu_bot_gpt",
        profileType: "AI",
        competitorActive: true,
        status: "ACTIVE",
      },
    });
  } else if (chatgpt && gptExisting && chatgpt.id !== gptExisting.id) {
    const chatgptSubs = await db.rankingSubmission.count({
      where: { universalProfileId: chatgpt.id },
    });
    if (chatgptSubs === 0) {
      await db.universalProfile.delete({ where: { id: chatgpt.id } });
    } else {
      const gptContests = new Set(
        (
          await db.rankingSubmission.findMany({
            where: { universalProfileId: gptExisting.id },
            select: { contestId: true },
          })
        ).map((row) => row.contestId),
      );
      const movable = await db.rankingSubmission.findMany({
        where: { universalProfileId: chatgpt.id },
      });
      for (const row of movable) {
        if (gptContests.has(row.contestId)) continue;
        await db.rankingSubmission.update({
          where: { id: row.id },
          data: { universalProfileId: gptExisting.id },
        });
      }
      await db.universalProfile.update({
        where: { id: chatgpt.id },
        data: {
          competitorActive: false,
          displayName: "ChatGPT (merged)",
        },
      });
    }
    await db.universalProfile.update({
      where: { id: gptExisting.id },
      data: {
        displayName: "GPT",
        universalUserId: "uu_bot_gpt",
        competitorActive: true,
        status: "ACTIVE",
        profileType: "AI",
      },
    });
  } else if (gptExisting) {
    await db.universalProfile.update({
      where: { id: gptExisting.id },
      data: {
        displayName: "GPT",
        universalUserId: "uu_bot_gpt",
        competitorActive: true,
        status: "ACTIVE",
        profileType: "AI",
      },
    });
  }

  // 2) Upsert official roster
  for (const bot of OFFICIAL_AI_COMPETITORS) {
    const byUsername = await db.universalProfile.findUnique({
      where: { username: bot.username },
    });
    if (byUsername) {
      await db.universalProfile.update({
        where: { id: byUsername.id },
        data: {
          displayName: bot.displayName,
          universalUserId: bot.universalUserId,
          profileType: "AI",
          competitorActive: true,
          status: "ACTIVE",
        },
      });
      continue;
    }

    const byUid = await db.universalProfile.findUnique({
      where: { universalUserId: bot.universalUserId },
    });
    if (byUid) {
      await db.universalProfile.update({
        where: { id: byUid.id },
        data: {
          username: bot.username,
          displayName: bot.displayName,
          profileType: "AI",
          competitorActive: true,
          status: "ACTIVE",
        },
      });
      continue;
    }

    await db.universalProfile.create({
      data: {
        username: bot.username,
        displayName: bot.displayName,
        universalUserId: bot.universalUserId,
        profileType: "AI",
        competitorActive: true,
        status: "ACTIVE",
      },
    });
  }

  // 3) Retire non-official AI from future participation.
  const allAi = await db.universalProfile.findMany({
    where: { profileType: "AI" },
    select: {
      id: true,
      username: true,
      _count: { select: { submissions: true } },
    },
  });

  for (const profile of allAi) {
    if (OFFICIAL_AI_USERNAMES.has(profile.username)) continue;

    if (profile.username === "pipes" && profile._count.submissions === 0) {
      await db.universalProfile.delete({ where: { id: profile.id } });
      continue;
    }

    await db.universalProfile.update({
      where: { id: profile.id },
      data: { competitorActive: false },
    });
  }

  const active = await countActiveAiCompetitors(db);
  return {
    activeCount: active,
    expected: EXPECTED_ACTIVE_AI_COMPETITOR_COUNT,
    ok: active === EXPECTED_ACTIVE_AI_COMPETITOR_COUNT,
  };
}
