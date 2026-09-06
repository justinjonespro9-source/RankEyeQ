"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FantasyTrackScoringRules } from "@/components/fantasy/FantasyTrackScoringRules";
import { RankEyeQResumeSummary } from "@/components/profile/RankEyeQResumeSummary";
import { WeeklyReceiptsSection } from "@/components/profile/WeeklyReceiptsSection";
import { ProfileOverview } from "./ProfileOverview";
import { buildRankEyeQResume } from "@/lib/profile-resume";
import type { ProfileOverviewData } from "@/lib/profile-modules";
import type { ProfileContestHistoryItem } from "@/types/profile";
import type { ProfileBoardAccessSummary } from "@/lib/public-board";
import type { ProductKey, UniversalProfile } from "@/types/user";

const TABS: { key: ProductKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "rankiq", label: "RankEyeQ" },
  { key: "handicap-hero", label: "Handicap Hero" },
  { key: "fantasytrack", label: "FantasyTrack" },
];

export function ProfileProductSections({
  profile,
  overview,
  history = [],
  contestsPlayed = 0,
  weekBoards = [],
  initialTab = "overview",
}: {
  profile: UniversalProfile;
  overview: ProfileOverviewData;
  history?: ProfileContestHistoryItem[];
  contestsPlayed?: number;
  weekBoards?: ProfileBoardAccessSummary[];
  initialTab?: ProductKey;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as ProductKey | null;
  const active = TABS.some((tab) => tab.key === tabParam)
    ? (tabParam as ProductKey)
    : initialTab;

  function selectTab(key: ProductKey) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <section className="mt-8">
      <div
        role="tablist"
        aria-label="Profile sections"
        className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface-elevated p-1"
      >
        {TABS.map((tab) => {
          const selected = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              id={`tab-${tab.key}`}
              onClick={() => selectTab(tab.key)}
              className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                selected
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-surface hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        className="mt-6 rounded-lg border border-border bg-surface-elevated p-5 sm:p-6"
      >
        {active === "overview" ? (
          <ProfileOverview
            overview={overview}
            stats={profile.rankiq}
            contestsPlayed={contestsPlayed}
            isBot={profile.isBot}
            isBenchmark={Boolean(profile.isBenchmark)}
            currentWeekSubmitted={weekBoards.length > 0}
          />
        ) : active === "rankiq" ? (
          profile.rankiq ? (
            <RankEyeQTab
              profile={profile}
              history={history}
              contestsPlayed={contestsPlayed}
              weekBoards={weekBoards}
            />
          ) : (
            <EmptyProduct label="RankEyeQ" />
          )
        ) : active === "fantasytrack" ? (
          <FantasyTrackTab />
        ) : (
          <EmptyProduct
            label={TABS.find((tab) => tab.key === active)?.label ?? "Product"}
          />
        )}
      </div>
    </section>
  );
}

function RankEyeQTab({
  profile,
  history,
  contestsPlayed,
  weekBoards,
}: {
  profile: UniversalProfile;
  history: ProfileContestHistoryItem[];
  contestsPlayed: number;
  weekBoards: ProfileBoardAccessSummary[];
}) {
  const resume = buildRankEyeQResume({
    stats: profile.rankiq!,
    history,
    contestsPlayed,
  });
  const stats = profile.rankiq!;

  return (
    <>
      <h2 className="font-display text-xl font-semibold text-ink">
        RankEyeQ performance
      </h2>
      <p className="mt-1 mb-6 text-sm text-muted">
        Fantasy ranking résumé from graded weekly contests — not season-long
        projections.
      </p>

      <RankEyeQResumeSummary
        resume={resume}
        currentWeekSubmitted={weekBoards.length > 0}
        rankScopeLabel={
          profile.isBenchmark
            ? "Overall rank among Experts"
            : profile.isCreator
              ? "Overall rank among Creators"
              : profile.isBot
                ? "AI season rank"
                : "Season leaderboard rank"
        }
      />

      {resume.hasGradedHistory ? (
        <div className="mt-8">
          <h3 className="font-display text-lg font-semibold text-ink">
            Hit metrics
          </h3>
          <p className="mt-1 text-sm text-muted">
            From the production EYEQ engine. Podium Hits are Top 3 picks that
            finished actual Top 3.
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <HitCard
              label="Top-N Hit Rate"
              value={
                stats.topHitRate == null
                  ? "—"
                  : `${Math.round(stats.topHitRate * 100)}%`
              }
            />
            <HitCard
              label="Exact Hits"
              value={String(stats.exactRankingHits ?? "—")}
            />
            <HitCard label="#1 Hits" value={String(stats.numberOneHits ?? "—")} />
            <HitCard
              label="Podium Hits"
              value={String(stats.podiumHits ?? "—")}
            />
          </dl>
        </div>
      ) : null}

      <WeeklyReceiptsSection username={profile.username} history={history} />
    </>
  );
}

function HitCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}

function FantasyTrackTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          FantasyTrack scoring
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          FantasyTrack and RankEyeQ share this NFL scoring engine for weekly
          player and D/ST fantasy points. Contest history for FantasyTrack will
          appear here when that product module connects to your profile.
        </p>
      </div>
      <FantasyTrackScoringRules />
      <p className="text-sm">
        <Link
          href="/how-it-works#fantasy-scoring"
          className="font-medium text-accent hover:underline"
        >
          Full scoring rules on How It Works
        </Link>
      </p>
    </div>
  );
}

function EmptyProduct({ label }: { label: string }) {
  return (
    <div className="py-10 text-center">
      <h2 className="font-display text-xl font-semibold text-ink">{label}</h2>
      <p className="mt-2 text-sm text-muted">
        No recorded activity yet. This module will connect when {label} launches
        on your universal profile.
      </p>
    </div>
  );
}
