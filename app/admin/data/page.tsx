import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DataImportPanel } from "@/components/admin/DataImportPanel";
import { ManualOpsPanel } from "@/components/admin/ManualOpsPanel";
import { ResultsWorkflowPanel } from "@/components/admin/ResultsWorkflowPanel";
import { RosterBootstrapPanel } from "@/components/admin/RosterBootstrapPanel";
import { getWeekDataAudit } from "@/lib/nfl/audit";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { getWeekResultsAudit } from "@/lib/nfl/results-audit";
import { prisma } from "@/lib/db";
import {
  isManualNflMode,
  resolveNflProviderName,
} from "@/lib/providers/nfl";

export const metadata: Metadata = {
  title: "NFL Data",
  description: "Import NFL schedule and player pools for RankEyeQ contests.",
};

export const dynamic = "force-dynamic";

export default async function AdminDataPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string }>;
}) {
  const params = await searchParams;
  const provider = resolveNflProviderName();
  const manualMode = isManualNflMode();

  const seasons = await prisma.season.findMany({
    where: { sport: "NFL" },
    select: {
      id: true,
      year: true,
      active: true,
      rosterSyncSource: true,
      rosterSyncedAt: true,
      weeks: { orderBy: { weekNumber: "asc" } },
    },
    orderBy: { year: "desc" },
  });

  const activeSeason =
    seasons.find((season) => season.active) ?? seasons[0] ?? null;
  const weeks = activeSeason?.weeks ?? [];
  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN")?.id ??
    weeks[0]?.id ??
    null;

  const selectedWeek = weeks.find((week) => week.id === weekId) ?? null;
  const audit = weekId ? await getWeekDataAudit(weekId) : null;
  const resultsAudit = weekId ? await getWeekResultsAudit(weekId) : null;
  const finalizeReadiness = weekId
    ? await getFinalizeWeekReadiness(weekId)
    : null;

  const contests = weekId
    ? await prisma.rankIQContest.findMany({
        where: { weekId },
        include: {
          entries: {
            include: { rankableEntry: true },
            orderBy: { rankableEntry: { name: "asc" } },
          },
        },
        orderBy: { position: "asc" },
      })
    : [];

  const omittedByContest = await Promise.all(
    contests.map(async (contest) => {
      const inPool = new Set(
        contest.entries.map((entry) => entry.rankableEntryId),
      );
      const candidates = await prisma.rankableEntry.findMany({
        where: {
          provider,
          position: contest.position,
          active: true,
          NOT: { id: { in: [...inPool] } },
        },
        orderBy: { name: "asc" },
        take: 40,
      });
      return { contestId: contest.id, candidates };
    }),
  );

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/data" />
      <SectionHeading
        eyebrow="Ingestion"
        title="NFL data"
        description={
          manualMode
            ? "Operator-entered schedule, pools, and fantasy points. Provider APIs are not required."
            : "Import schedule/player pools, then ingest weekly fantasy stats, calculate finishes, and grade contests."
        }
        action={<Badge tone="neutral">Provider: {provider}</Badge>}
      />

      {!activeSeason || weeks.length === 0 ? (
        <p className="text-sm text-muted">
          Create an NFL season and week first
          {manualMode
            ? ", then paste the weekly schedule in Manual weekly ops."
            : ", or sync a week from the provider schedule."}{" "}
          <Link href="/admin/seasons" className="text-accent hover:underline">
            Seasons & Weeks
          </Link>
        </p>
      ) : (
        <div className="space-y-8">
          {activeSeason ? (
            <RosterBootstrapPanel
              seasonId={activeSeason.id}
              seasonYear={activeSeason.year}
              lastSyncSource={activeSeason.rosterSyncSource}
              lastSyncedAt={
                activeSeason.rosterSyncedAt?.toISOString() ?? null
              }
            />
          ) : null}
          {weekId && selectedWeek ? (
            <ManualOpsPanel
              weekId={weekId}
              weekLabel={selectedWeek.label}
              previousWeekId={
                weeks
                  .filter((week) => week.weekNumber < selectedWeek.weekNumber)
                  .sort((a, b) => b.weekNumber - a.weekNumber)[0]?.id ?? null
              }
            />
          ) : null}
          {!manualMode ? (
            <DataImportPanel
              seasons={seasons.map((season) => ({
                id: season.id,
                year: season.year,
                active: season.active,
              }))}
              activeSeasonId={activeSeason.id}
              weeks={weeks.map((week) => ({
                id: week.id,
                label: week.label,
                weekNumber: week.weekNumber,
                status: week.status,
              }))}
              selectedWeekId={weekId}
              selectedWeekLabel={selectedWeek?.label ?? null}
              audit={audit}
              contests={contests.map((contest) => ({
                id: contest.id,
                position: contest.position,
                status: contest.status,
                entries: contest.entries.map((entry) => ({
                  id: entry.id,
                  excluded: entry.excluded,
                  manuallyAdded: entry.manuallyAdded,
                  name: entry.rankableEntry.name,
                  team: entry.rankableEntry.team,
                  opponent: entry.rankableEntry.opponent,
                })),
              }))}
              omittedByContest={omittedByContest.map((row) => ({
                contestId: row.contestId,
                candidates: row.candidates.map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                  team: candidate.team,
                })),
              }))}
            />
          ) : (
            <p className="text-sm text-muted">
              Provider fetch panels are hidden in manual mode. Use Manual weekly
              ops above, or open the{" "}
              <Link href="/admin/players" className="text-accent hover:underline">
                master player directory
              </Link>
              .
            </p>
          )}
          {weekId && selectedWeek && resultsAudit && finalizeReadiness ? (
            <ResultsWorkflowPanel
              weekId={weekId}
              weekLabel={selectedWeek.label}
              resultsAudit={resultsAudit}
              finalizeReadiness={finalizeReadiness}
            />
          ) : null}
        </div>
      )}
    </Container>
  );
}
