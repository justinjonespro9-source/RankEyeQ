import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import {
  CompetitorAuthorizeForm,
  CompetitorLiveEditForm,
  CompetitorLiveFilters,
  CompetitorLiveList,
  CompetitorLiveSummaryCards,
  CompetitorOutreachCard,
} from "@/components/admin/CompetitorLiveRoom";
import {
  MyRanksDashboard,
  MyRanksPositionTabs,
} from "@/components/my-ranks/MyRanksDashboard";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getCompetitorOutreachSummary } from "@/lib/admin/competitor-authorization";
import {
  competitorLiveBoardHref,
  competitorLiveClassLabel,
  getCompetitorLiveDetail,
  listCompetitorLiveRoom,
  resolveCompetitorLiveWeekId,
  type CompetitorLiveFilter,
  type CompetitorVisibilityFilter,
} from "@/lib/admin/competitor-live-room";
import { isPosition } from "@/lib/contest";
import { toDbPosition } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export const metadata: Metadata = {
  title: "Competitor Live Room · Admin",
  description:
    "Admin-only live inspection of Expert, Creator, AI, and Publisher Consensus boards.",
};

export const dynamic = "force-dynamic";

const FILTERS = new Set<CompetitorLiveFilter>([
  "ALL",
  "EXPERT",
  "CREATOR",
  "AI",
  "PUBLISHER_CONSENSUS",
]);

const VISIBILITY_FILTERS = new Set<CompetitorVisibilityFilter>([
  "ALL",
  "PUBLIC",
  "PRIVATE_TRACKED",
]);

export default async function AdminCompetitorLivePage({
  searchParams,
}: {
  searchParams: Promise<{
    weekId?: string;
    filter?: string;
    visibility?: string;
    profileId?: string;
    position?: string;
    edit?: string;
    updated?: string;
    authorized?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const filter = (
    FILTERS.has(params.filter as CompetitorLiveFilter)
      ? params.filter
      : "ALL"
  ) as CompetitorLiveFilter;
  const visibility = (
    VISIBILITY_FILTERS.has(params.visibility as CompetitorVisibilityFilter)
      ? params.visibility
      : "ALL"
  ) as CompetitorVisibilityFilter;

  const weeks = await prisma.week.findMany({
    where: { season: { active: true, sport: "NFL" }, isTest: false },
    orderBy: [{ season: { year: "desc" } }, { weekNumber: "asc" }],
    select: {
      id: true,
      label: true,
      weekNumber: true,
      status: true,
      season: { select: { year: true } },
    },
  });

  const week =
    (await resolveCompetitorLiveWeekId(params.weekId)) ??
    weeks.find((item) => item.status === "OPEN" || item.status === "LOCKED") ??
    weeks[0] ??
    null;

  const room = week
    ? await listCompetitorLiveRoom({
        weekId: week.id,
        filter,
        visibilityFilter: visibility,
      })
    : null;

  const selectedProfileId = params.profileId ?? null;
  const selectedRow =
    room?.rows.find((row) => row.profileId === selectedProfileId) ?? null;

  const positionParam = params.position?.toLowerCase() ?? "qb";
  const position: ContestPosition = isPosition(positionParam)
    ? toDbPosition(positionParam)
    : "QB";

  const detail =
    week && selectedRow
      ? await getCompetitorLiveDetail({
          weekId: week.id,
          profileId: selectedRow.profileId,
          position,
        })
      : null;

  const outreach =
    selectedRow &&
    (selectedRow.editType === "expert" || selectedRow.editType === "creator") &&
    selectedRow.visibilityState === "PRIVATE_TRACKED"
      ? await getCompetitorOutreachSummary({
          universalProfileId: selectedRow.profileId,
        })
      : null;

  const showEdit = params.edit === "1" && selectedRow;

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/competitors/live" />
      <SectionHeading
        eyebrow="Admin QA"
        title="Competitor live control room"
        description="Inspect every active Expert, Creator, AI, and Publisher Consensus board during the week. Private-tracked competitors stay scored here and never appear on public surfaces until authorized."
        action={
          <Link
            href="/admin/competitors/new"
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Add Competitor
          </Link>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {params.error}
        </p>
      ) : null}
      {params.updated === "1" ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          Competitor profile updated.
        </p>
      ) : null}
      {params.authorized === "1" ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          Competitor authorized for public surfaces.
        </p>
      ) : null}

      {!week || !room ? (
        <p className="text-sm text-muted">
          Create an active NFL season week to use the live control room.
        </p>
      ) : (
        <>
          <CompetitorLiveFilters
            weekId={week.id}
            filter={filter}
            visibility={visibility}
            weeks={weeks.map((item) => ({
              id: item.id,
              label: `${item.season?.year ?? ""} ${item.label}`.trim(),
              weekNumber: item.weekNumber,
            }))}
          />

          <CompetitorLiveSummaryCards summary={room.summary} />

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <section>
              <h2 className="mb-3 font-display text-lg font-semibold text-ink">
                Competitors
              </h2>
              <CompetitorLiveList
                rows={room.rows}
                weekId={week.id}
                filter={filter}
                visibility={visibility}
                selectedProfileId={selectedProfileId}
              />
            </section>

            <section>
              <h2 className="mb-3 font-display text-lg font-semibold text-ink">
                Live boards
              </h2>
              {!selectedRow ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted">
                  Select <strong>View Live Boards</strong> on a competitor to
                  inspect their submitted positions.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-surface-elevated px-4 py-3">
                    <p className="font-semibold text-ink">
                      {selectedRow.displayName}
                    </p>
                    <p className="text-sm text-muted">
                      {competitorLiveClassLabel(selectedRow.competitorClass)} ·{" "}
                      {selectedRow.visibilityBadge} · {selectedRow.affiliation} ·
                      @{selectedRow.username}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedRow.manageRankingsHref ? (
                        <Link
                          href={selectedRow.manageRankingsHref}
                          className="text-sm font-medium text-accent-ink hover:underline"
                        >
                          Manage Rankings →
                        </Link>
                      ) : null}
                      <Link
                        href={
                          competitorLiveBoardHref({
                            weekId: week.id,
                            profileId: selectedRow.profileId,
                            filter,
                            visibility,
                            position,
                          }) + "&edit=1"
                        }
                        className="text-sm font-medium text-accent-ink hover:underline"
                      >
                        Edit Profile →
                      </Link>
                      {selectedRow.visibilityState === "AUTHORIZED_PUBLIC" ? (
                        <Link
                          href={`/profile/${selectedRow.username}`}
                          className="text-sm font-medium text-accent-ink hover:underline"
                        >
                          Public profile →
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  {outreach ? <CompetitorOutreachCard summary={outreach} /> : null}

                  <CompetitorAuthorizeForm
                    row={selectedRow}
                    weekId={week.id}
                    filter={filter}
                    visibility={visibility}
                  />

                  <MyRanksPositionTabs
                    active={position}
                    weekId={week.id}
                    hrefForPosition={(next) =>
                      competitorLiveBoardHref({
                        weekId: week.id,
                        profileId: selectedRow.profileId,
                        filter,
                        visibility,
                        position: next,
                      })
                    }
                  />

                  {detail ? (
                    <MyRanksDashboard dashboard={detail} variant="admin" />
                  ) : (
                    <p className="text-sm text-muted">Unable to load board.</p>
                  )}

                  {showEdit ? (
                    <CompetitorLiveEditForm
                      row={selectedRow}
                      weekId={week.id}
                      filter={filter}
                      visibility={visibility}
                    />
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </Container>
  );
}
