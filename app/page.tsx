import { Suspense } from "react";
import type { Metadata } from "next";
import { AiVsHuman } from "@/components/home/AiVsHuman";
import { CurrentWeekBanner } from "@/components/home/CurrentWeekBanner";
import { Hero } from "@/components/home/Hero";
import { HomeEntityIntro } from "@/components/home/HomeEntityIntro";
import { HowItWorksBrief } from "@/components/home/HowItWorksBrief";
import { ScoringBrief } from "@/components/home/ScoringBrief";
import { PositionChallenges } from "@/components/home/PositionChallenges";
import { RecentResults } from "@/components/home/RecentResults";
import { ThursdayReceiptsPreview } from "@/components/home/ThursdayReceiptsPreview";
import { WeeklyLeaderboardPreview } from "@/components/home/WeeklyLeaderboardPreview";
import { AdPlacement } from "@/components/sponsors/AdPlacement";
import { Container } from "@/components/layout/Container";
import { getActiveProfile } from "@/lib/active-profile";
import {
  BRAND_LOGO_PATH,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_TITLE,
} from "@/lib/brand";
import { getHomepageData } from "@/lib/homepage";
import { absoluteUrl, publicPageMetadata } from "@/lib/seo";
import { getThursdayReceipts } from "@/lib/timing/thursday-receipts";

const baseMeta = publicPageMetadata({
  title: DEFAULT_SITE_TITLE,
  description: DEFAULT_SITE_DESCRIPTION,
  path: "/",
});

export const metadata: Metadata = {
  ...baseMeta,
  title: {
    absolute: DEFAULT_SITE_TITLE,
  },
  openGraph: {
    ...baseMeta.openGraph,
    images: [{ url: absoluteUrl(BRAND_LOGO_PATH) }],
  },
  twitter: {
    ...baseMeta.twitter,
    images: [absoluteUrl(BRAND_LOGO_PATH)],
  },
};

/**
 * Database-backed homepage modules. Suspend independently so the entity intro
 * and hero stay in the initial HTML without waiting on contest data.
 */
async function HomeDynamicSections() {
  const activeProfile = await getActiveProfile();
  const data = await getHomepageData(activeProfile?.id);
  const receipts = data.week
    ? await getThursdayReceipts(data.week.id)
    : { weekLabel: null, rows: [] };

  return (
    <>
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
    </>
  );
}

function HomeDynamicFallback() {
  return (
    <section className="border-b border-border py-10" aria-hidden>
      <Container>
        <div className="h-16 animate-pulse rounded-md bg-surface" />
      </Container>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      <HomeEntityIntro />
      <Hero />
      <Suspense fallback={<HomeDynamicFallback />}>
        <HomeDynamicSections />
      </Suspense>
      <ScoringBrief />
      <HowItWorksBrief />
      <section className="pb-16 sm:pb-20">
        <Container>
          <AdPlacement placementKey="home_primary" />
        </Container>
      </section>
    </>
  );
}
