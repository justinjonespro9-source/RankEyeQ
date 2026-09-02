import type { ProductKey } from "@/types/user";

export type ProductModuleState = {
  key: ProductKey;
  label: string;
  participated: boolean;
  summary: string | null;
  href: string | null;
};

const PRODUCT_LABELS: Record<ProductKey, string> = {
  overview: "Overview",
  "handicap-hero": "Handicap Hero",
  rankiq: "RankEyeQ",
  fantasytrack: "FantasyTrack",
};

export function productLabel(key: ProductKey) {
  return PRODUCT_LABELS[key];
}

export type ProfileOverviewData = {
  products: ProductModuleState[];
  recentRankEyeQ: {
    weekLabel: string;
    position: string;
    normalizedScore: number | null;
    href: string;
  }[];
};

export async function buildProfileOverview(input: {
  profileId: string;
  username: string;
  rankiqContestsPlayed: number;
  recentHistory: ProfileOverviewData["recentRankEyeQ"];
}): Promise<ProfileOverviewData> {
  const rankiqParticipated = input.rankiqContestsPlayed > 0;

  return {
    products: [
      {
        key: "rankiq",
        label: PRODUCT_LABELS.rankiq,
        participated: rankiqParticipated,
        summary: rankiqParticipated
          ? `${input.rankiqContestsPlayed} graded weekly contest${input.rankiqContestsPlayed === 1 ? "" : "s"}`
          : null,
        href: null,
      },
      {
        key: "handicap-hero",
        label: PRODUCT_LABELS["handicap-hero"],
        participated: false,
        summary: null,
        href: null,
      },
      {
        key: "fantasytrack",
        label: PRODUCT_LABELS.fantasytrack,
        participated: false,
        summary: null,
        href: null,
      },
    ],
    recentRankEyeQ: input.recentHistory,
  };
}
