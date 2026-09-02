import { getViewerProfile } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * @deprecated Prefer getViewerProfile() — kept as a thin alias during migration.
 * Resolves the signed-in user's UniversalProfile only (no cookie fallback).
 */
export async function getActiveProfile() {
  return getViewerProfile();
}

/** Development-only profile listing for optional local debug tooling. */
export async function listSelectableProfiles() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.RANKIQ_DEV_PROFILE_SWITCHER !== "1"
  ) {
    return [];
  }

  return prisma.universalProfile.findMany({
    where: { profileType: { in: ["HUMAN", "AI"] } },
    orderBy: [{ profileType: "asc" }, { displayName: "asc" }],
  });
}
