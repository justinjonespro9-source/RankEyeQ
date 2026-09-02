import type { ProfileType } from "@/lib/generated/prisma/client";

/** User-facing competitor class. DB enum BENCHMARK is shown as Expert. */
export function competitorClassLabel(
  profileType: ProfileType | null | undefined,
): "Human" | "AI" | "Expert" {
  if (profileType === "AI") return "AI";
  if (profileType === "BENCHMARK") return "Expert";
  return "Human";
}

export function isAuthFreeCompetitor(
  profileType: ProfileType | null | undefined,
) {
  return profileType === "AI" || profileType === "BENCHMARK";
}
