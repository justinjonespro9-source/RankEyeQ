import Link from "next/link";
import { PodiumMedal } from "@/components/live/PodiumMedal";
import {
  formatCompetitiveRank,
  type HotStreakSummary,
  type StreakRange,
  type TopTenFinish,
  type Trophy,
  type TrophyCase as TrophyCaseData,
} from "@/lib/competitive-resume";

const PLACEMENTS_VISIBLE = 9;

const PLACE_SHELL: Record<1 | 2 | 3, string> = {
  1: "border-[#D4A017]/60 bg-[#D4A017]/[0.12]",
  2: "border-[#9AA3AF]/55 bg-[#9AA3AF]/[0.10]",
  3: "border-[#C47A3A]/55 bg-[#C47A3A]/[0.10]",
};

function SeasonTrophyGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9 shrink-0" aria-hidden="true">
      <path
        d="M7 3.5h10v4.2a5 5 0 0 1-10 0V3.5Z"
        fill="#D4A017"
        stroke="#8A6A0A"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M7 5H4.5v1.5A3 3 0 0 0 7.4 9.5M17 5h2.5v1.5a3 3 0 0 1-2.9 3"
        fill="none"
        stroke="#8A6A0A"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M10.5 12.5h3l.6 4h-4.2l.6-4Z" fill="#D4A017" stroke="#8A6A0A" strokeWidth="1.2" />
      <rect x="7.5" y="16.5" width="9" height="3.5" rx="0.8" fill="#8A6A0A" />
      <path d="m12 5.2.8 1.6 1.7.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.2Z" fill="#FFF3C4" />
    </svg>
  );
}

function FlameGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        d="M12 2.5c.6 3-1.8 4.6-3.3 6.7C7.4 11 6.5 12.8 6.5 15a5.5 5.5 0 0 0 11 0c0-2.4-1.1-4.4-2.3-5.6-.2 1.5-1 2.6-2.1 3.1.5-3.3-.3-7.2-1.1-10Z"
        fill="#F08A24"
        stroke="#A4520E"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M12 13.5c-1.2 1.3-2 2.3-2 3.6a2 2 0 0 0 4 0c0-1.2-.7-2.3-2-3.6Z" fill="#FFD27A" />
    </svg>
  );
}

export function TrophyCase({ trophyCase }: { trophyCase: TrophyCaseData }) {
  const { trophies, topTenFinishes, hotStreak } = trophyCase;
  const seasonTitles = trophies.filter((t) => t.tier === "season");
  const placements = trophies.filter((t) => t.tier === "weekly");
  const empty =
    trophies.length === 0 && topTenFinishes.length === 0 && !hotStreak.longest;

  return (
    <section
      aria-labelledby="trophy-case-heading"
      className="mt-8 overflow-hidden rounded-xl border border-navy/80 bg-gradient-to-b from-midnight to-navy text-off-white shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 px-4 py-3 sm:px-5">
        <h2 id="trophy-case-heading" className="font-display text-lg font-semibold tracking-wide">
          Trophy Case
        </h2>
        <p className="text-xs text-off-white/60">
          Earned on final graded boards · never self-reported
        </p>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
        {empty ? (
          <p className="text-sm text-off-white/70">
            No trophies yet. Weekly podium finishes, Top 10% finishes, and Hot
            Streaks are awarded automatically from final graded results.
          </p>
        ) : null}

        {seasonTitles.length > 0 ? (
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {seasonTitles.map((trophy) => (
              <li
                key={trophy.id}
                className="flex items-center gap-3 rounded-lg border border-[#D4A017]/60 bg-[#D4A017]/[0.12] px-3 py-3"
              >
                <SeasonTrophyGlyph />
                <PlaqueText trophy={trophy} eyebrow="Season title" />
              </li>
            ))}
          </ul>
        ) : null}

        {placements.length > 0 ? (
          <PlacementGrid placements={placements} />
        ) : null}

        {topTenFinishes.length > 0 || hotStreak.longest ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {topTenFinishes.length > 0 ? <TopTenTile finishes={topTenFinishes} /> : null}
            {hotStreak.longest ? <HotStreakTile hotStreak={hotStreak} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PlaqueText({ trophy, eyebrow }: { trophy: Trophy; eyebrow: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-off-white/55">
        {eyebrow}
      </p>
      <p className="font-display text-sm font-semibold leading-snug text-off-white sm:text-[15px]">
        {trophy.title}
      </p>
      {trophy.subtitle ? (
        <p className="text-xs text-off-white/65">{trophy.subtitle}</p>
      ) : null}
    </div>
  );
}

function PlacementPlaque({ trophy }: { trophy: Trophy }) {
  const place = trophy.place ?? 1;
  const className = `flex min-h-[4.25rem] items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${PLACE_SHELL[place]}`;
  const body = (
    <>
      <PodiumMedal place={place} className="h-9 w-9" />
      <PlaqueText
        trophy={trophy}
        eyebrow={trophy.position ? "Weekly position" : "Weekly overall"}
      />
    </>
  );
  return (
    <li>
      {trophy.href ? (
        <Link
          href={trophy.href}
          aria-label={`${trophy.title} — view receipt`}
          className={`${className} hover:border-accent-bright/70`}
        >
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

function PlacementGrid({ placements }: { placements: Trophy[] }) {
  const visible = placements.slice(0, PLACEMENTS_VISIBLE);
  const rest = placements.slice(PLACEMENTS_VISIBLE);
  return (
    <div>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((trophy) => (
          <PlacementPlaque key={trophy.id} trophy={trophy} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-xs font-medium text-accent-bright">
            Show {rest.length} more podium {rest.length === 1 ? "finish" : "finishes"}
          </summary>
          <ul className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((trophy) => (
              <PlacementPlaque key={trophy.id} trophy={trophy} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function finishLabel(finish: TopTenFinish, multiSeason: boolean) {
  const scope = finish.scope === "OVERALL" ? "Overall" : finish.scope;
  return `${multiSeason ? `${finish.seasonYear} ` : ""}Wk ${finish.weekNumber} · ${scope} · ${formatCompetitiveRank(finish.placement, finish.tied)} of ${finish.fieldSize}`;
}

function TopTenTile({ finishes }: { finishes: TopTenFinish[] }) {
  const multiSeason = new Set(finishes.map((f) => f.seasonYear)).size > 1;
  return (
    <details className="group rounded-lg border border-accent/30 bg-accent/[0.08] px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-off-white/55">
            Weekly boards
          </span>
          <span className="font-display text-base font-semibold text-off-white">
            Top 10% × {finishes.length}
          </span>
        </span>
        <span className="text-xs font-medium text-accent-bright">
          <span className="group-open:hidden">Show weeks</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {finishes.map((finish) => (
          <li key={`${finish.seasonYear}-${finish.weekNumber}-${finish.scope}`}>
            <Link
              href={finish.href}
              className="inline-flex min-h-8 items-center rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-off-white/90 hover:border-accent-bright/60"
            >
              {finishLabel(finish, multiSeason)}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function streakRangeText(range: StreakRange) {
  return `${range.seasonYear} · Weeks ${range.fromWeek}–${range.toWeek}`;
}

function HotStreakTile({ hotStreak }: { hotStreak: HotStreakSummary }) {
  const primary = hotStreak.current ?? hotStreak.longest!;
  const showLongest =
    hotStreak.current != null &&
    hotStreak.longest != null &&
    hotStreak.longest.length > hotStreak.current.length;
  return (
    <div className="rounded-lg border border-[#F08A24]/40 bg-[#F08A24]/[0.08] px-3 py-2.5">
      <Link href={primary.href} className="flex items-center gap-2.5 hover:opacity-90">
        <FlameGlyph />
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-off-white/55">
            {hotStreak.current ? "Current streak" : "Best streak"}
          </span>
          <span className="font-display text-base font-semibold text-off-white">
            Hot Streak · {primary.length} Weeks
          </span>
          <span className="block text-xs text-off-white/65">
            Top 10% overall · {streakRangeText(primary)}
          </span>
        </span>
      </Link>
      {showLongest ? (
        <Link
          href={hotStreak.longest!.href}
          className="mt-1.5 block text-xs text-off-white/70 hover:text-off-white"
        >
          Best: {hotStreak.longest!.length} Weeks · {streakRangeText(hotStreak.longest!)}
        </Link>
      ) : null}
    </div>
  );
}
