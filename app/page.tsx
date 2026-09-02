import type { Metadata } from "next";
import { AiVsHuman } from "@/components/home/AiVsHuman";
import { CurrentWeekBanner } from "@/components/home/CurrentWeekBanner";
import { Hero } from "@/components/home/Hero";
import { HowItWorksBrief } from "@/components/home/HowItWorksBrief";
import { ScoringBrief } from "@/components/home/ScoringBrief";
import { PositionChallenges } from "@/components/home/PositionChallenges";
import { RecentResults } from "@/components/home/RecentResults";
import { ThursdayReceiptsPreview } from "@/components/home/ThursdayReceiptsPreview";
import { WeeklyLeaderboardPreview } from "@/components/home/WeeklyLeaderboardPreview";
import { getActiveProfile } from "@/lib/active-profile";
import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_TITLE } from "@/lib/brand";
import { getHomepageData } from "@/lib/homepage";
import { canonicalMetadata, PUBLIC_INDEX } from "@/lib/seo";
import { getThursdayReceipts } from "@/lib/timing/thursday-receipts";

export const metadata: Metadata = {
  title: DEFAULT_SITE_TITLE,
  description: DEFAULT_SITE_DESCRIPTION,
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/"),
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const activeProfile = await getActiveProfile();
  const data = await getHomepageData(activeProfile?.id);
  const receipts = data.week
    ? await getThursdayReceipts(data.week.id)
    : { weekLabel: null, rows: [] };

  return (
    <>
      <Hero />
      <CurrentWeekBanner week={data.week} />
      <ThursdayReceiptsPreview
        weekLabel={receipts.weekLabel}
        rows={receipts.rows}
      />
      <PositionChallenges challenges={data.challenges} />
      <WeeklyLeaderboardPreview
        leaders={data.weeklyLeaders}
        weekLabel={data.aiVsHuman?.weekLabel ?? data.week?.label ?? null}
      />
      <AiVsHuman summary={data.aiVsHuman} />
      <RecentResults results={data.recentResults} />
      <ScoringBrief />
      <HowItWorksBrief />
    </>
  );
}
