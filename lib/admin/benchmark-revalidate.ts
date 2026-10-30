import { revalidatePath } from "next/cache";

/**
 * Cache invalidation after benchmark/creator capture.
 *
 * Admin grid + board paths always refresh so Snapshot History is trustworthy.
 * Public leaderboards/consensus invalidate only when an official board locks —
 * required for public cache correctness without paying that cost on every soft
 * capture (reduces post-commit Server Action response risk / E394).
 */
export function revalidateBenchmarkCapture(input: {
  weekId?: string;
  profileId?: string;
  contestId?: string;
  /** Remount board page (official lock or late capture). */
  includeBoard?: boolean;
  /** Invalidate public scoring surfaces (official lock only). */
  invalidatePublic?: boolean;
}) {
  revalidatePath("/admin/benchmarks");
  revalidatePath("/admin/creators");
  if (input.weekId) {
    revalidatePath(`/admin/benchmarks?weekId=${input.weekId}`);
    revalidatePath(`/admin/creators?weekId=${input.weekId}`);
  }
  if (input.includeBoard && input.profileId && input.contestId) {
    revalidatePath(
      `/admin/benchmarks/${input.profileId}/${input.contestId}`,
    );
    revalidatePath(
      `/admin/creators/board/${input.profileId}/${input.contestId}`,
    );
  }
  if (input.invalidatePublic) {
    revalidatePath("/leaderboards");
    revalidatePath("/consensus");
  }
}
