import Link from "next/link";
import { LiveEyeqScore } from "@/components/live/LiveEyeqScore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { updateCompetitorMetadataAction } from "@/lib/admin-competitor-actions";
import {
  competitorLiveBoardHref,
  competitorLiveClassLabel,
  type CompetitorLiveFilter,
  type CompetitorLiveRow,
  type CompetitorLiveSummary,
} from "@/lib/admin/competitor-live-room";
import { BENCHMARK_SCORING_FORMAT } from "@/lib/expert-identity";
import { formatRankIqScore } from "@/lib/scoring";
import type { ContestPosition } from "@/lib/generated/prisma/client";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
const FILTERS: Array<{ key: CompetitorLiveFilter; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "EXPERT", label: "Experts" },
  { key: "CREATOR", label: "Creators" },
  { key: "AI", label: "AI" },
  { key: "PUBLISHER_CONSENSUS", label: "Publisher Consensus" },
];

export function CompetitorLiveFilters({
  weekId,
  filter,
  weeks,
}: {
  weekId: string;
  filter: CompetitorLiveFilter;
  weeks: Array<{ id: string; label: string; weekNumber: number }>;
}) {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-2">
        {weeks.map((week) => (
          <Link
            key={week.id}
            href={`/admin/competitors/live?weekId=${week.id}&filter=${filter}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              week.id === weekId
                ? "bg-accent text-ink"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {week.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={`/admin/competitors/live?weekId=${weekId}&filter=${item.key}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              filter === item.key
                ? "bg-ink text-off-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function CompetitorLiveSummaryCards({
  summary,
}: {
  summary: CompetitorLiveSummary;
}) {
  const cards = [
    { label: "Active Experts", value: summary.activeExperts },
    { label: "Active Creators", value: summary.activeCreators },
    { label: "AI Competitors", value: summary.activeAi },
    { label: "Publisher Consensus", value: summary.activePublishers },
    { label: "Boards Submitted", value: summary.boardsSubmitted },
    { label: "Boards Missing", value: summary.boardsMissing },
  ];
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-border bg-surface-elevated px-3 py-3"
        >
          <p className="text-xs uppercase tracking-wide text-muted">
            {card.label}
          </p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function CompetitorLiveList({
  rows,
  weekId,
  filter,
  selectedProfileId,
}: {
  rows: CompetitorLiveRow[];
  weekId: string;
  filter: CompetitorLiveFilter;
  selectedProfileId?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted">
        No active competitors for this filter.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const selected = row.profileId === selectedProfileId;
        return (
          <li
            key={row.profileId}
            className={`rounded-lg border bg-surface-elevated p-4 ${
              selected ? "border-accent" : "border-border"
            }`}
          >
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={row.avatarUrl || "/icon.svg"}
                  alt=""
                  className="h-12 w-12 rounded-full border border-border object-cover bg-surface"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{row.displayName}</p>
                  <p className="text-xs text-muted">@{row.username}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="neutral">
                      {competitorLiveClassLabel(row.competitorClass)}
                    </Badge>
                    <Badge tone="neutral">{row.affiliation}</Badge>
                    {!row.publicVisible ? (
                      <Badge tone="warning">Hidden</Badge>
                    ) : null}
                    {!row.sourceUrl && row.competitorClass !== "AI" ? (
                      <Badge tone="warning">No source URL</Badge>
                    ) : null}
                    {!row.avatarUrl ? (
                      <Badge tone="warning">No avatar</Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Submitted {row.submittedCount}/{row.expectedCount}
                    {row.missingCount > 0
                      ? ` · Missing ${row.missingCount}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  href={competitorLiveBoardHref({
                    weekId,
                    profileId: row.profileId,
                    filter,
                    position:
                      row.positions.find((cell) => cell.hasSubmission)
                        ?.position ?? "QB",
                  })}
                  size="sm"
                  variant={selected ? "primary" : "secondary"}
                >
                  View Live Boards
                </Button>
                <Button
                  href={competitorLiveBoardHref({
                    weekId,
                    profileId: row.profileId,
                    filter,
                  }) + "&edit=1"}
                  size="sm"
                  variant="secondary"
                >
                  Edit Profile
                </Button>
                {row.manageRankingsHref ? (
                  <Button
                    href={row.manageRankingsHref}
                    size="sm"
                    variant="secondary"
                  >
                    Manage Rankings
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-5">
              {row.positions.map((cell) => (
                <div
                  key={cell.position}
                  className="rounded-md border border-border bg-surface px-2 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-ink">{cell.position}</span>
                    {cell.locked ? (
                      <Badge tone="warning">LOCKED</Badge>
                    ) : cell.hasSubmission ? (
                      <Badge tone="success">{cell.submissionStatus}</Badge>
                    ) : (
                      <Badge tone="neutral">No submission</Badge>
                    )}
                  </div>
                  {cell.eyeqScore != null ? (
                    cell.eyeqIsLive ? (
                      <div className="mt-1">
                        <LiveEyeqScore
                          score={cell.eyeqScore}
                          resolvedCount={cell.resolvedCount}
                          totalPicks={cell.totalPicks}
                          size="sm"
                        />
                      </div>
                    ) : (
                      <p className="mt-1 tabular-nums text-ink">
                        EYEQ {formatRankIqScore(cell.eyeqScore)}
                      </p>
                    )
                  ) : (
                    <p className="mt-1 text-muted">—</p>
                  )}
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CompetitorLiveEditForm({
  row,
  weekId,
  filter,
}: {
  row: CompetitorLiveRow;
  weekId: string;
  filter: CompetitorLiveFilter;
}) {
  const returnTo = competitorLiveBoardHref({
    weekId,
    profileId: row.profileId,
    filter,
  });

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface-elevated p-4">
      <h3 className="font-display text-lg font-semibold text-ink">
        Edit Profile · {row.displayName}
      </h3>
      <p className="mt-1 text-sm text-muted">
        Uses existing admin metadata update actions. Avatar is URL-based (same as
        other competitor admin forms).
      </p>
      <form action={updateCompetitorMetadataAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="type" value={row.editType} />
        <input type="hidden" name="universalProfileId" value={row.profileId} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Avatar URL</span>
          <input
            name="avatarUrl"
            defaultValue={row.avatarUrl ?? ""}
            placeholder="https://…"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>

        <label className="block text-sm">
          <span className="text-muted">Display name</span>
          <input
            name="displayName"
            defaultValue={row.displayName}
            required
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>

        {(row.editType === "expert" || row.editType === "publisher") && (
          <label className="block text-sm">
            <span className="text-muted">
              {row.editType === "publisher" ? "Publisher" : "Publication"}
            </span>
            <input
              name={
                row.editType === "publisher"
                  ? "publisherName"
                  : "publicationName"
              }
              defaultValue={row.affiliation}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>
        )}

        {row.editType === "creator" ? (
          <label className="block text-sm">
            <span className="text-muted">Brand</span>
            <input
              name="brandName"
              defaultValue={row.affiliation === "Creator" ? "" : row.affiliation}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>
        ) : null}

        {row.editType !== "ai" ? (
          <label className="block text-sm">
            <span className="text-muted">Source URL</span>
            <input
              name="sourceUrl"
              defaultValue={row.sourceUrl ?? ""}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>
        ) : null}

        {row.editType === "creator" ? (
          <>
            <label className="block text-sm">
              <span className="text-muted">Creator site URL</span>
              <input
                name="creatorSiteUrl"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Social URL</span>
              <input
                name="socialUrl"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Social handle</span>
              <input
                name="socialHandle"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>
          </>
        ) : null}

        {row.editType === "publisher" ? (
          <label className="block text-sm">
            <span className="text-muted">Scoring format</span>
            <select
              name="scoringFormat"
              defaultValue={BENCHMARK_SCORING_FORMAT.UNSPECIFIED}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            >
              {Object.values(BENCHMARK_SCORING_FORMAT).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Bio / notes</span>
          <textarea
            name="bio"
            defaultValue={row.bio ?? ""}
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>

        {(row.editType === "creator" ||
          row.editType === "expert" ||
          row.editType === "publisher") && (
          <fieldset className="sm:col-span-2">
            <legend className="text-sm text-muted">Positions</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {POSITIONS.map((position) => (
                <label key={position} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="positions" value={position} />
                  {position}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="hidden" name="publicVisible" value="false" />
          <input
            type="checkbox"
            name="publicVisible"
            value="true"
            defaultChecked={row.publicVisible}
          />
          Public visible
        </label>

        {row.editType === "publisher" ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="hidden" name="competitorActive" value="false" />
            <input
              type="checkbox"
              name="competitorActive"
              value="true"
              defaultChecked={row.competitorActive}
            />
            Competitor active
          </label>
        ) : null}

        <div className="sm:col-span-2">
          <Button type="submit">Save profile</Button>
        </div>
      </form>
    </section>
  );
}
