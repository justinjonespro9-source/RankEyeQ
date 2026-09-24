"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import {
  applyPostFinalStatCorrection,
  previewPostFinalStatCorrection,
  resolveWeekStatIdForContestEntry,
  type PostFinalStatKind,
} from "@/lib/nfl/post-final-stat-correction";

function revalidateAfterCorrection(weekId: string) {
  revalidatePath("/admin/live-scoring");
  revalidatePath(`/admin/live-scoring?weekId=${weekId}`);
  revalidatePath("/results");
  revalidatePath("/my-ranks");
  revalidatePath("/leaderboards");
  revalidatePath("/leaderboards/live");
  revalidatePath("/receipts");
  revalidatePath("/consensus");
  for (const position of ["qb", "rb", "wr", "te", "def"]) {
    revalidatePath(`/leaderboards/live/${position}`);
  }
}

export async function previewPostFinalStatCorrectionAction(input: {
  weekStatId: string;
  kind: PostFinalStatKind;
  proposedStats: PlayerStatLine | DefenseStatLine;
}) {
  await assertAdmin();
  return previewPostFinalStatCorrection(input);
}

export async function applyPostFinalStatCorrectionAction(input: {
  weekStatId: string;
  kind: PostFinalStatKind;
  proposedStats: PlayerStatLine | DefenseStatLine;
  reason: string;
  sourceReference: string;
  confirmHighImpact: boolean;
}) {
  const admin = await assertAdmin();
  const result = await applyPostFinalStatCorrection({
    ...input,
    adminUserId: admin.user.id,
  });
  if (result.ok) {
    // weekId is not on success payload directly — revalidate broadly via preview fields
    revalidatePath("/admin/live-scoring");
    revalidatePath("/results");
    revalidatePath("/my-ranks");
    revalidatePath("/leaderboards");
    revalidatePath("/leaderboards/live");
    revalidatePath("/receipts");
    revalidatePath("/consensus");
  }
  return result;
}

export async function resolveWeekStatForCorrectionAction(input: {
  contestEntryId: string;
}) {
  await assertAdmin();
  return resolveWeekStatIdForContestEntry(input);
}

/** Apply with weekId for precise revalidation when caller has it. */
export async function applyPostFinalStatCorrectionForWeekAction(input: {
  weekId: string;
  weekStatId: string;
  kind: PostFinalStatKind;
  proposedStats: PlayerStatLine | DefenseStatLine;
  reason: string;
  sourceReference: string;
  confirmHighImpact: boolean;
}) {
  const admin = await assertAdmin();
  const result = await applyPostFinalStatCorrection({
    weekStatId: input.weekStatId,
    kind: input.kind,
    proposedStats: input.proposedStats,
    reason: input.reason,
    sourceReference: input.sourceReference,
    confirmHighImpact: input.confirmHighImpact,
    adminUserId: admin.user.id,
  });
  if (result.ok) {
    revalidateAfterCorrection(input.weekId);
  }
  return result;
}
