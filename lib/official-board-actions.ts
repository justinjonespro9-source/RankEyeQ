"use server";

import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics";
import { getAuthContext } from "@/lib/auth/session";
import { assertClientProfileMatchesSession } from "@/lib/auth/participation";
import {
  OfficialBoardError,
  publishOfficialBoard,
} from "@/lib/boards/official-board";
import { logServerEvent } from "@/lib/log";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import {
  WeeklyContentError,
  createWeeklyContent,
  deleteWeeklyContent,
  updateWeeklyContent,
  type WeeklyContentInput,
} from "@/lib/weekly-content";

type ActionFailure = { ok: false; error: string };

async function sessionOwner(
  scope: string,
  limit: { limit: number; windowMs: number },
  clientProfileId?: string,
) {
  const ctx = await getAuthContext();
  if (!ctx?.universalProfile) {
    return { ok: false as const, error: "Sign in to manage your Official Board." };
  }
  const spoof = assertClientProfileMatchesSession(
    ctx.universalProfile.id,
    clientProfileId,
  );
  if (!spoof.ok) {
    logServerEvent("auth.profile_spoof", { action: scope }, "warn");
    return { ok: false as const, error: spoof.error };
  }
  const limited = rateLimit({
    key: await rateLimitKey(scope, ctx.universalProfile.id),
    ...limit,
  });
  if (!limited.ok) {
    return { ok: false as const, error: rateLimitErrorMessage(limited) };
  }
  return {
    ok: true as const,
    userId: ctx.user.id,
    username: ctx.universalProfile.username,
  };
}

export async function publishOfficialBoardAction(input: {
  contestId: string;
  position: string;
  /** Ignored except for spoof detection — the profile comes from the session. */
  universalProfileId?: string;
}): Promise<
  | { ok: true; outcome: "published" | "updated" | "unchanged"; versionNumber: number }
  | ActionFailure
> {
  const owner = await sessionOwner(
    "board-publish",
    RATE_LIMITS.boardPublish,
    input.universalProfileId,
  );
  if (!owner.ok) return owner;
  try {
    const result = await publishOfficialBoard({
      userId: owner.userId,
      contestId: input.contestId,
    });
    revalidatePath(`/rank/${input.position.toLowerCase()}`);
    revalidatePath(`/profile/${owner.username}`);
    if (result.outcome !== "unchanged") {
      trackEvent("official_board_published", {
        position: input.position,
        outcome: result.outcome,
      });
    }
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof OfficialBoardError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

function revalidateWeeklyContent(username: string, position?: string | null) {
  if (position) revalidatePath(`/rank/${position.toLowerCase()}`);
  revalidatePath(`/profile/${username}`);
}

export async function createWeeklyContentAction(input: {
  weekId: string;
  content: WeeklyContentInput;
  pagePosition?: string;
  universalProfileId?: string;
}): Promise<{ ok: true } | ActionFailure> {
  const owner = await sessionOwner(
    "weekly-content",
    RATE_LIMITS.weeklyContent,
    input.universalProfileId,
  );
  if (!owner.ok) return owner;
  try {
    await createWeeklyContent({
      userId: owner.userId,
      weekId: input.weekId,
      content: input.content,
    });
    revalidateWeeklyContent(owner.username, input.pagePosition);
    return { ok: true };
  } catch (error) {
    if (error instanceof WeeklyContentError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function updateWeeklyContentAction(input: {
  id: string;
  content: WeeklyContentInput;
  pagePosition?: string;
  universalProfileId?: string;
}): Promise<{ ok: true } | ActionFailure> {
  const owner = await sessionOwner(
    "weekly-content",
    RATE_LIMITS.weeklyContent,
    input.universalProfileId,
  );
  if (!owner.ok) return owner;
  try {
    await updateWeeklyContent({
      userId: owner.userId,
      id: input.id,
      content: input.content,
    });
    revalidateWeeklyContent(owner.username, input.pagePosition);
    return { ok: true };
  } catch (error) {
    if (error instanceof WeeklyContentError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function deleteWeeklyContentAction(input: {
  id: string;
  pagePosition?: string;
  universalProfileId?: string;
}): Promise<{ ok: true } | ActionFailure> {
  const owner = await sessionOwner(
    "weekly-content",
    RATE_LIMITS.weeklyContent,
    input.universalProfileId,
  );
  if (!owner.ok) return owner;
  try {
    await deleteWeeklyContent({ userId: owner.userId, id: input.id });
    revalidateWeeklyContent(owner.username, input.pagePosition);
    return { ok: true };
  } catch (error) {
    if (error instanceof WeeklyContentError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
