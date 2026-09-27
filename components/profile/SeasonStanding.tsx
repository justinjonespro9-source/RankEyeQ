import { PodiumMedal } from "@/components/live/PodiumMedal";
import { EYEQ_SCORE_LABEL } from "@/lib/brand";
import { formatRankIqScore } from "@/lib/scoring";
import type {
  SeasonStanding as SeasonStandingData,
  SeasonStandingCell,
} from "@/lib/competitive-resume";

function scopeLabel(scope: SeasonStandingCell["scope"]) {
  return scope === "OVERALL" ? "Overall" : scope;
}

function podiumPlace(rank: number | null): 1 | 2 | 3 | null {
  return rank === 1 || rank === 2 || rank === 3 ? rank : null;
}

const PODIUM_RING: Record<1 | 2 | 3, string> = {
  1: "border-[#D4A017]/70 bg-[#D4A017]/10",
  2: "border-[#9AA3AF]/70 bg-[#9AA3AF]/10",
  3: "border-[#C47A3A]/70 bg-[#C47A3A]/10",
};

export function SeasonStanding({
  standing,
}: {
  standing: SeasonStandingData | null;
}) {
  const overall = standing?.cells.find((cell) => cell.scope === "OVERALL") ?? null;
  const positions = standing?.cells.filter((cell) => cell.scope !== "OVERALL") ?? [];
  const hasAnyRank = standing?.cells.some((cell) => cell.rank != null) ?? false;

  return (
    <section aria-labelledby="season-standing-heading" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="season-standing-heading"
          className="font-display text-lg font-semibold text-ink"
        >
          {standing ? `${standing.seasonYear} Season Standing` : "Season Standing"}
        </h2>
        {standing ? (
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {standing.seasonFinalized
              ? "Final standings"
              : standing.seasonActive
                ? "Season in progress"
                : "Season complete · awaiting final grades"}
          </p>
        ) : null}
      </div>

      {!standing || !hasAnyRank ? (
        <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-5 text-sm text-muted">
          Season standing appears after this profile&apos;s first graded contest.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,3fr)]">
            {overall ? <OverallCell cell={overall} classRank={standing.classRank} /> : null}
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {positions.map((cell) => (
                <PositionCell
                  key={cell.scope}
                  cell={cell}
                  strongest={standing.strongestPosition?.scope === cell.scope}
                />
              ))}
            </ul>
          </div>
          <p className="mt-2 text-xs text-muted">
            Full-field ranks from the canonical season leaderboards (average{" "}
            {EYEQ_SCORE_LABEL} across graded contests).
          </p>
        </>
      )}
    </section>
  );
}

function OverallCell({
  cell,
  classRank,
}: {
  cell: SeasonStandingCell;
  classRank: SeasonStandingData["classRank"];
}) {
  const place = podiumPlace(cell.rank);
  return (
    <div
      className={`rounded-lg border px-4 py-4 ${
        place ? PODIUM_RING[place] : "border-accent/30 bg-accent-soft/40"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-ink">
        Overall
      </p>
      {cell.rank == null ? (
        <p className="mt-2 text-sm text-muted">Not ranked yet</p>
      ) : (
        <>
          <div className="mt-1 flex items-center gap-2">
            {place ? <PodiumMedal place={place} className="h-6 w-6" /> : null}
            <p className="font-display text-4xl font-semibold tabular-nums text-ink">
              #{cell.rank}
            </p>
            <p className="self-end pb-1 text-sm text-muted">of {cell.fieldSize}</p>
          </div>
          <p className="mt-1 text-sm text-ink">
            <span className="font-display font-semibold tabular-nums">
              {cell.averageScore == null ? "—" : formatRankIqScore(cell.averageScore)}
            </span>{" "}
            <span className="text-muted">avg {EYEQ_SCORE_LABEL}</span>
            <span className="text-muted">
              {" "}
              · {cell.contestsPlayed} {cell.contestsPlayed === 1 ? "contest" : "contests"}
            </span>
          </p>
          {classRank ? (
            <p className="mt-1 text-xs text-muted">
              #{classRank.rank} {classRank.label} (of {classRank.fieldSize})
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function PositionCell({
  cell,
  strongest,
}: {
  cell: SeasonStandingCell;
  strongest: boolean;
}) {
  const place = podiumPlace(cell.rank);
  const ranked = cell.rank != null;
  return (
    <li
      className={`relative rounded-lg border px-2.5 py-3 sm:px-3 ${
        place
          ? PODIUM_RING[place]
          : ranked
            ? "border-border bg-surface"
            : "border-border/60 bg-surface/50"
      } ${strongest ? "ring-2 ring-accent/60" : ""}`}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {scopeLabel(cell.scope)}
        </p>
        {strongest ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-ink">
            Best
          </span>
        ) : null}
      </div>
      {ranked ? (
        <>
          <div className="mt-1 flex items-center gap-1">
            {place ? <PodiumMedal place={place} /> : null}
            <p className="font-display text-xl font-semibold tabular-nums text-ink sm:text-2xl">
              #{cell.rank}
            </p>
          </div>
          <p className="text-[11px] text-muted sm:text-xs">of {cell.fieldSize}</p>
          <p className="mt-1 font-display text-sm font-semibold tabular-nums text-ink">
            {cell.averageScore == null ? "—" : formatRankIqScore(cell.averageScore)}
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs leading-snug text-muted">No graded boards</p>
      )}
    </li>
  );
}
