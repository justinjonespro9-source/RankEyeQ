"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FantasyTrackScoringRules } from "@/components/fantasy/FantasyTrackScoringRules";
import { RankIQStatsGrid } from "./RankIQStatsGrid";
import { ProfileOverview } from "./ProfileOverview";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatRankIqScore } from "@/lib/scoring";
import type { ProfileOverviewData } from "@/lib/profile-modules";
import type { ProfileContestHistoryItem } from "@/types/profile";
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
  initialTab = "overview",
}: {
  profile: UniversalProfile;
  overview: ProfileOverviewData;
  history?: ProfileContestHistoryItem[];
  contestsPlayed?: number;
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
          />
        ) : active === "rankiq" ? (
          profile.rankiq ? (
            <RankEyeQTab
              profile={profile}
              history={history}
              contestsPlayed={contestsPlayed}
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
}: {
  profile: UniversalProfile;
  history: ProfileContestHistoryItem[];
  contestsPlayed: number;
}) {
  return (
    <>
      <h2 className="font-display text-xl font-semibold text-ink">
        RankEyeQ performance
      </h2>
      <p className="mt-1 mb-6 text-sm text-muted">
        Graded weekly contest results on this universal profile. Season standings
        are built from weekly scores — not season-long projections.
      </p>
      <RankIQStatsGrid
        stats={profile.rankiq!}
        contestsPlayed={contestsPlayed}
        rankScopeLabel={
          profile.isBenchmark
            ? "Overall rank among Experts"
            : profile.isBot
              ? "AI season rank"
              : "Season leaderboard rank"
        }
      />

      {history.length > 0 ? (
        <>
          <h3 className="mt-10 font-display text-lg font-semibold text-ink">
            Best performances
          </h3>
          <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
            {[...history]
              .filter((item) => item.normalizedScore != null)
              .sort(
                (a, b) => (b.normalizedScore ?? 0) - (a.normalizedScore ?? 0),
              )
              .slice(0, 3)
              .map((item, index) => (
                <li
                  key={item.submissionId}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="text-muted">#{index + 1}</span>
                  <span className="min-w-0 flex-1 text-ink">
                    {item.weekLabel} · {item.position}
                  </span>
                  <span className="font-display font-semibold tabular-nums text-ink">
                    {formatRankIqScore(item.normalizedScore ?? 0)}
                  </span>
                </li>
              ))}
          </ol>
        </>
      ) : null}

      <h3 className="mt-10 font-display text-lg font-semibold text-ink">
        Weekly contest history
      </h3>
      <p className="mt-1 text-sm text-muted">
        Finalized weekly boards remain permanently viewable from the archive.
      </p>
      {history.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No profile history yet"
            description="Graded RankEyeQ contests for this universal profile will show here."
            actionHref="/rank"
            actionLabel="Enter a challenge"
          />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Week</th>
                <th className="px-3 py-2">Pos</th>
                <th className="px-3 py-2">EYEQ</th>
                <th className="px-3 py-2">Raw</th>
                <th className="px-3 py-2">Top-N</th>
                <th className="px-3 py-2">Exact</th>
                <th className="px-3 py-2">#1</th>
                <th className="px-3 py-2">Week rank</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr
                  key={item.submissionId}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2 text-ink">
                    <Link
                      href={`/profile/${profile.username}/rankings/${item.weekNumber}/${item.position.toLowerCase()}`}
                      className="text-accent hover:underline"
                    >
                      {item.weekLabel}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink">{item.position}</td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {item.normalizedScore == null
                      ? "—"
                      : formatRankIqScore(item.normalizedScore)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {item.rawScore ?? "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {item.topNHits}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {item.exactHits}
                  </td>
                  <td className="px-3 py-2 text-ink">
                    {item.numberOneHit ? "Yes" : "No"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {item.weeklyRank ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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
