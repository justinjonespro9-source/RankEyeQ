import type { ProfileType } from "@/lib/generated/prisma/client";

export type CompetitorIdentityTone =
  | "neutral"
  | "success"
  | "warning"
  | "accent"
  | "danger";

export type CompetitorIdentityChip = {
  /** Compact mobile/desktop chip copy, e.g. PUBLIC or EXPERT · Yahoo Fantasy */
  label: string;
  tone: CompetitorIdentityTone;
};

/** User-facing competitor class. DB enum BENCHMARK is shown as Expert. */
export function competitorClassLabel(
  profileType: ProfileType | null | undefined,
): "Human" | "AI" | "Expert" | "Creator" {
  if (profileType === "AI") return "AI";
  if (profileType === "BENCHMARK") return "Expert";
  if (profileType === "CREATOR") return "Creator";
  return "Human";
}

/**
 * Compact identity chip for leaderboards / links / profiles.
 * PUBLIC | EXPERT · {publisher} | CREATOR · {brand} | AI · {model}
 *
 * Verified Creator is a subtle profile-page indicator only — do not bloat
 * leaderboard chips with internal claim status.
 */
export function competitorIdentityChip(input: {
  profileType: ProfileType | null | undefined;
  expertPublisher?: string | null;
  creatorBrand?: string | null;
  aiModel?: string | null;
}): CompetitorIdentityChip {
  const { profileType } = input;
  if (profileType === "AI") {
    const model = input.aiModel?.trim();
    return {
      label: model ? `AI · ${model}` : "AI",
      tone: "neutral",
    };
  }
  if (profileType === "BENCHMARK") {
    const publisher = input.expertPublisher?.trim();
    return {
      label: publisher ? `EXPERT · ${publisher}` : "EXPERT",
      tone: "warning",
    };
  }
  if (profileType === "CREATOR") {
    const brand = input.creatorBrand?.trim();
    return {
      label: brand ? `CREATOR · ${brand}` : "CREATOR",
      tone: "warning",
    };
  }
  return { label: "PUBLIC", tone: "success" };
}

export function isAuthFreeCompetitor(
  profileType: ProfileType | null | undefined,
) {
  return (
    profileType === "AI" ||
    profileType === "BENCHMARK" ||
    profileType === "CREATOR"
  );
}
