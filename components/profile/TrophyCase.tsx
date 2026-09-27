import Link from "next/link";
import type {
  StreakRange,
  TopTenFinish,
  Trophy,
  TrophyCase as TrophyCaseData,
} from "@/lib/competitive-resume";

const TOP_TEN_VISIBLE = 8;

function TrophyGlyph({ trophy }: { trophy: Trophy }) {
  if (trophy.kind === "HOT_STREAK") {
    return (
      <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0" aria-hidden="true">
        <path
          d="M12 2.5c.6 3-1.8 4.6-3.3 6.7C7.4 11 6.5 12.8 6.5 15a5.5 5.5 0 0 0 11 0c0-2.4-1.1-4.4-2.3-5.6-.2 1.5-1 2.6-2.1 3.1.5-3.3-.3-7.2-1.1-10Z"
          fill="#F08A24"
          stroke="#A4520E"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M12 13.5c-1.2 1.3-2 2.3-2 3.6a2 2 0 0 0 4 0c0-1.2-.7-2.3-2-3.6Z"
          fill="#FFD27A"
        />
      </svg>
    );
  }
  const season = trophy.tier === "season";
  const fill = season || trophy.kind === "WEEKLY_OVERALL_CHAMPION" ? "#D4A017" : "#C9CED6";
  const stroke = season || trophy.kind === "WEEKLY_OVERALL_CHAMPION" ? "#8A6A0A" : "#5B6572";
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0" aria-hidden="true">
      <path
        d="M7 3.5h10v4.2a5 5 0 0 1-10 0V3.5Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M7 5H4.5v1.5A3 3 0 0 0 7.4 9.5M17 5h2.5v1.5a3 3 0 0 1-2.9 3"
        fill="none"
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M10.5 12.5h3l.6 4h-4.2l.6-4Z" fill={fill} stroke={stroke} strokeWidth="1.2" />
      <rect x="7.5" y="16.5" width="9" height="3.5" rx="0.8" fill={stroke} />
      {season ? (
        <path d="m12 5.2.8 1.6 1.7.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.2Z" fill="#FFF3C4" />
      ) : null}
    </svg>
  );
}

function tierLabel(trophy: Trophy) {
  switch (trophy.kind) {
    case "SEASON_OVERALL_CHAMPION":
    case "SEASON_POSITION_CHAMPION":
      return "Season title";
    case "WEEKLY_OVERALL_CHAMPION":
      return "Weekly overall";
    case "WEEKLY_POSITION_CHAMPION":
      return "Weekly position";
    case "HOT_STREAK":
      return "Streak";
    default:
      return "Honor";
  }
}

function streakText(range: StreakRange, multiSeason: boolean) {
  return `${range.length} weeks · Weeks ${range.fromWeek}–${range.toWeek}${
    multiSeason ? ` (${range.seasonYear})` : ""
  }`;
}

export function TrophyCase({
  trophyCase,
}: {
  trophyCase: TrophyCaseData;
}) {
  const { trophies, topTenFinishes, hotStreak } = trophyCase;
  const multiSeason =
    new Set(topTenFinishes.map((finish) => finish.seasonYear)).size > 1;
  const empty =
    trophies.length === 0 && topTenFinishes.length === 0 && !hotStreak.longest;

  return (
    <section
      aria-labelledby="trophy-case-heading"
      className="mt-8 overflow-hidden rounded-xl border border-navy/80 bg-gradient-to-b from-midnight to-navy text-off-white shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 px-4 py-3 sm:px-5">
        <h2
          id="trophy-case-heading"
          className="font-display text-lg font-semibold tracking-wide"
        >
          Trophy Case
        </h2>
        <p className="text-xs text-off-white/60">
          Earned on graded boards · never self-reported
        </p>
      </div>

      <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5">
        {empty ? (
          <p className="text-sm text-off-white/70">
            No trophies yet. Weekly championships, Top 10% finishes, and Hot
            Streaks are awarded automatically from final graded results.
          </p>
        ) : null}

        {trophies.length > 0 ? (
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {trophies.map((trophy) => (
              <TrophyPlaque key={trophy.id} trophy={trophy} />
            ))}
          </ul>
        ) : null}

        {hotStreak.current || hotStreak.longest ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {hotStreak.current ? (
              <p>
                <span className="font-semibold text-[#FFB866]">Current Hot Streak:</span>{" "}
                <span className="text-off-white/85">
                  {streakText(hotStreak.current, multiSeason)}
                </span>
              </p>
            ) : null}
            {hotStreak.longest &&
            (!hotStreak.current ||
              hotStreak.longest.length > hotStreak.current.length) ? (
              <p>
                <span className="font-semibold text-off-white/85">Longest:</span>{" "}
                <span className="text-off-white/70">
                  {streakText(hotStreak.longest, multiSeason)}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        {topTenFinishes.length > 0 ? (
          <TopTenList finishes={topTenFinishes} multiSeason={multiSeason} />
        ) : null}
      </div>
    </section>
  );
}

function TrophyPlaque({ trophy }: { trophy: Trophy }) {
  const body = (
    <>
      <TrophyGlyph trophy={trophy} />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-off-white/55">
          {tierLabel(trophy)}
        </p>
        <p className="font-display text-sm font-semibold leading-snug text-off-white">
          {trophy.title}
        </p>
        {trophy.subtitle ? (
          <p className="text-xs text-off-white/65">{trophy.subtitle}</p>
        ) : null}
        {trophy.href ? (
          <p className="mt-0.5 text-xs font-medium text-accent-bright">View receipt</p>
        ) : null}
      </div>
    </>
  );
  const className = `flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2.5 ${
    trophy.tier === "season"
      ? "border-[#D4A017]/60 bg-[#D4A017]/10"
      : "border-white/15 bg-white/[0.04]"
  }`;
  return (
    <li>
      {trophy.href ? (
        <Link
          href={trophy.href}
          className={`${className} transition-colors hover:border-accent-bright/60 hover:bg-white/[0.08]`}
        >
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

function finishLabel(finish: TopTenFinish, multiSeason: boolean) {
  const scope = finish.scope === "OVERALL" ? "Overall" : finish.scope;
  return `${multiSeason ? `${finish.seasonYear} ` : ""}Wk ${finish.weekNumber} · ${scope} · #${finish.rank} of ${finish.fieldSize}`;
}

function TopTenList({
  finishes,
  multiSeason,
}: {
  finishes: TopTenFinish[];
  multiSeason: boolean;
}) {
  const visible = finishes.slice(0, TOP_TEN_VISIBLE);
  const rest = finishes.slice(TOP_TEN_VISIBLE);
  const chip = (finish: TopTenFinish) => (
    <li key={`${finish.seasonYear}-${finish.weekNumber}-${finish.scope}`}>
      <Link
        href={finish.href}
        className="inline-flex min-h-8 items-center rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-off-white/90 hover:border-accent-bright/60"
      >
        {finishLabel(finish, multiSeason)}
      </Link>
    </li>
  );
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-off-white/60">
        Top 10% finishes · {finishes.length}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">{visible.map(chip)}</ul>
      {rest.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-accent-bright">
            Show {rest.length} more
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">{rest.map(chip)}</ul>
        </details>
      ) : null}
    </div>
  );
}
