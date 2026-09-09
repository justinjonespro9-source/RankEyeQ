import type { ProfileType } from "@/lib/generated/prisma/client";
import {
  isPublisherConsensusSource,
} from "@/lib/expert-identity";

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

/** User-facing competitor class. DB enum BENCHMARK is Expert or Publisher Consensus. */
export function competitorClassLabel(
  profileType: ProfileType | null | undefined,
  sourceKind?: string | null,
): "Human" | "AI" | "Expert" | "Creator" | "Publisher Consensus" {
  if (profileType === "AI") return "AI";
  if (profileType === "CREATOR") return "Creator";
  if (profileType === "BENCHMARK") {
    return isPublisherConsensusSource(sourceKind)
      ? "Publisher Consensus"
      : "Expert";
  }
  return "Human";
}

/**
 * Compact identity chip for leaderboards / links / profiles.
 * PUBLIC | EXPERT · {publisher} | CONSENSUS · {publisher} | CREATOR · {brand} | AI · {model}
 */
export function competitorIdentityChip(input: {
  profileType: ProfileType | null | undefined;
  expertPublisher?: string | null;
  expertSourceKind?: string | null;
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
    if (isPublisherConsensusSource(input.expertSourceKind)) {
      return {
        label: publisher ? `CONSENSUS · ${publisher}` : "CONSENSUS",
        tone: "accent",
      };
    }
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
