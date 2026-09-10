import Link from "next/link";
import { LiveEyeqScore } from "@/components/live/LiveEyeqScore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  authorizeCompetitorPublicAction,
  setCompetitorVisibilityAction,
  updateCompetitorMetadataAction,
} from "@/lib/admin-competitor-actions";
import type { CompetitorOutreachSummary } from "@/lib/admin/competitor-authorization";
import {
  competitorLiveBoardHref,
  competitorLiveClassLabel,
  type CompetitorLiveFilter,
  type CompetitorLiveRow,
  type CompetitorLiveSummary,
  type CompetitorVisibilityFilter,
} from "@/lib/admin/competitor-live-room";
import { competitorVisibilityBadgeLabel } from "@/lib/competitor-visibility";
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
const VISIBILITY_FILTERS: Array<{
  key: CompetitorVisibilityFilter;
  label: string;
}> = [
  { key: "ALL", label: "All" },
  { key: "PUBLIC", label: "Public" },
  { key: "PRIVATE_TRACKED", label: "Private Tracked" },
];

function visibilityHref(input: {
  weekId: string;
  filter: CompetitorLiveFilter;
  visibility: CompetitorVisibilityFilter;
}) {
  const params = new URLSearchParams({
    weekId: input.weekId,
    filter: input.filter,
  });
  if (input.visibility !== "ALL") {
    params.set("visibility", input.visibility);
  }
  return `/admin/competitors/live?${params.toString()}`;
}

function visibilityBadgeTone(
  state: CompetitorLiveRow["visibilityState"],
): "warning" | "success" | "neutral" {
  if (state === "PRIVATE_TRACKED") return "warning";
  if (state === "AUTHORIZED_PUBLIC") return "success";
  return "neutral";
}

export function CompetitorLiveFilters({
  weekId,
  filter,
  visibility,
  weeks,
}: {
  weekId: string;
  filter: CompetitorLiveFilter;
  visibility: CompetitorVisibilityFilter;
  weeks: Array<{ id: string; label: string; weekNumber: number }>;
}) {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-2">
        {weeks.map((week) => (
          <Link
            key={week.id}
            href={visibilityHref({
              weekId: week.id,
              filter,
              visibility,
            })}
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
            href={visibilityHref({
              weekId,
              filter: item.key,
              visibility,
            })}
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted">
          Visibility
        </span>
        {VISIBILITY_FILTERS.map((item) => (
          <Link
            key={item.key}
            href={visibilityHref({
              weekId,
              filter,
              visibility: item.key,
            })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              visibility === item.key
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

export function CompetitorOutreachCard({
  summary,
}: {
  summary: CompetitorOutreachSummary;
}) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-warning">
        Internal outreach · admin only
      </p>
      <p className="mt-1 font-semibold text-ink">{summary.displayName}</p>
      <p className="text-xs text-muted">
        {competitorVisibilityBadgeLabel(summary.visibilityState)}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-ink">
        <li>{summary.weeksTracked} weeks tracked</li>
        <li>
          Avg EYEQ:{" "}
          {summary.avgEyeq != null ? formatRankIqScore(summary.avgEyeq) : "—"}
        </li>
        <li>
          Best finish:{" "}
          {summary.bestWeeklyFinishLabel ??
            (summary.bestWeeklyFinish != null
              ? `#${summary.bestWeeklyFinish}`
              : "—")}
        </li>
        <li>Best position: {summary.bestPosition ?? "—"}</li>
        <li>
          Overall internal rank:{" "}
          {summary.overallInternalRank != null
            ? `#${summary.overallInternalRank}`
            : "—"}
          {summary.topPercent != null ? ` · Top ${summary.topPercent}%` : ""}
        </li>
      </ul>
    </div>
  );
}

export function CompetitorAuthorizeForm({
  row,
  weekId,
  filter,
  visibility,
}: {
  row: CompetitorLiveRow;
  weekId: string;
  filter: CompetitorLiveFilter;
  visibility: CompetitorVisibilityFilter;
}) {
  if (
    row.visibilityState !== "PRIVATE_TRACKED" ||
    (row.editType !== "expert" && row.editType !== "creator")
  ) {
    return null;
  }

  const returnTo = competitorLiveBoardHref({
    weekId,
    profileId: row.profileId,
    filter,
    visibility,
  });

  return (
    <form
      action={authorizeCompetitorPublicAction}
      className="rounded-lg border border-border bg-surface-elevated p-4"
    >
      <input type="hidden" name="universalProfileId" value={row.profileId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="weekId" value={weekId} />
      <h3 className="font-display text-lg font-semibold text-ink">
        Make Public / Authorize
      </h3>
      <p className="mt-1 text-sm text-muted">
        Explicit confirmation required. Default keeps prior weeks private
        (public from current week forward).
      </p>
      <fieldset className="mt-3 space-y-2 text-sm">
        <legend className="text-muted">Historical visibility</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="historyMode"
            value="from_now"
            defaultChecked
          />
          <span>
            Public from current week forward only (recommended / default)
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="historyMode" value="expose_history" />
          <span>Expose full historical boards and scores publicly</span>
        </label>
      </fieldset>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirmAuthorize" value="true" required />
        I confirm authorizing this competitor for public surfaces
      </label>
      <div className="mt-3">
        <Button type="submit">Authorize &amp; Make Public</Button>
      </div>
    </form>
  );
}

export function CompetitorLiveList({
  rows,
  weekId,
  filter,
  visibility,
  selectedProfileId,
}: {
  rows: CompetitorLiveRow[];
  weekId: string;
  filter: CompetitorLiveFilter;
  visibility: CompetitorVisibilityFilter;
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
                    <Badge tone={visibilityBadgeTone(row.visibilityState)}>
                      {row.visibilityBadge}
                    </Badge>
                    <Badge tone="neutral">{row.affiliation}</Badge>
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
                    visibility,
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
                  href={
                    competitorLiveBoardHref({
                      weekId,
                      profileId: row.profileId,
                      filter,
                      visibility,
                    }) + "&edit=1"
                  }
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
  visibility,
}: {
  row: CompetitorLiveRow;
  weekId: string;
  filter: CompetitorLiveFilter;
  visibility: CompetitorVisibilityFilter;
}) {
  const returnTo = competitorLiveBoardHref({
    weekId,
    profileId: row.profileId,
    filter,
    visibility,
  });

  const supportsAuth =
    row.editType === "expert" || row.editType === "creator";

  return (
    <section className="mt-6 space-y-4">
      {supportsAuth ? (
        <form
          action={setCompetitorVisibilityAction}
          className="rounded-lg border border-border bg-surface-elevated p-4"
        >
          <input type="hidden" name="universalProfileId" value={row.profileId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="weekId" value={weekId} />
          <h3 className="font-display text-lg font-semibold text-ink">
            Visibility / authorization
          </h3>
          <p className="mt-1 text-sm text-muted">
            PRIVATE TRACKED stays off every public surface. Making public
            requires confirmation below.
          </p>
          <label className="mt-3 block text-sm">
            <span className="text-muted">Status</span>
            <select
              name="visibilityState"
              defaultValue={row.visibilityState}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            >
              <option value="PRIVATE_TRACKED">PRIVATE TRACKED</option>
              <option value="AUTHORIZED_PUBLIC">AUTHORIZED PUBLIC</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </label>
          <fieldset className="mt-3 space-y-2 text-sm">
            <legend className="text-muted">
              If authorizing public — history mode
            </legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="historyMode"
                value="from_now"
                defaultChecked
              />
              <span>Public from current week forward only</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="historyMode" value="expose_history" />
              <span>Expose full history</span>
            </label>
          </fieldset>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirmAuthorize" value="true" />
            Confirm if changing to AUTHORIZED PUBLIC
          </label>
          <div className="mt-3">
            <Button type="submit">Save visibility</Button>
          </div>
        </form>
      ) : null}

      <form
        action={updateCompetitorMetadataAction}
        className="rounded-lg border border-border bg-surface-elevated p-4 grid gap-3 sm:grid-cols-2"
      >
        <h3 className="font-display text-lg font-semibold text-ink sm:col-span-2">
          Edit Profile · {row.displayName}
        </h3>
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

        {!supportsAuth ? (
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
        ) : (
          <input
            type="hidden"
            name="publicVisible"
            value={row.publicVisible ? "true" : "false"}
          />
        )}

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
