import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { ResultsSubnav } from "@/components/layout/ResultsSubnav";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { prisma } from "@/lib/db";
import { trackEvent } from "@/lib/analytics";
import { canonicalMetadata, PUBLIC_INDEX } from "@/lib/seo";
import { getThursdayReceipts } from "@/lib/timing/thursday-receipts";

export const metadata: Metadata = {
  title: "Thursday Receipts",
  description:
    "Thursday receipts for this NFL week: early-game fantasy points, provisional ranks, and pre-kickoff conviction on weekly boards.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/receipts"),
};

export const dynamic = "force-dynamic";

export default async function ThursdayReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string }>;
}) {
  const params = await searchParams;
  const weeks = await prisma.week.findMany({
    where: { season: { active: true, sport: "NFL" }, isTest: false },
    orderBy: { weekNumber: "asc" },
  });
  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN" || week.status === "LOCKED")?.id ??
    weeks[0]?.id ??
    null;
  const selected = weeks.find((week) => week.id === weekId) ?? null;
  const receipts = weekId ? await getThursdayReceipts(weekId) : null;
  if (receipts) trackEvent("thursday_receipt_viewed", { weekNumber: selected?.weekNumber ?? 0 });

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Early slate"
        title="Thursday Receipts"
        description="This week's early-game results plus pre-kickoff conviction on weekly boards. Remaining Sunday rankings stay private until reveal."
      />
      <ResultsSubnav />

      {weeks.length > 1 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {weeks.map((week) => (
            <Link
              key={week.id}
              href={`/receipts?weekId=${week.id}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                week.id === weekId
                  ? "bg-accent text-white"
                  : "border border-border bg-surface-elevated text-ink"
              }`}
            >
              {week.label}
            </Link>
          ))}
        </div>
      ) : null}

      {!selected || !receipts ? (
        <EmptyState
          title="No week available"
          description="Import an NFL week to show Thursday receipts."
        />
      ) : receipts.rows.length === 0 ? (
        <EmptyState
          title="No completed early games yet"
          description={`${selected.label} has no final early-slate performances. Check back after Thursday kickoffs.`}
          actionHref="/rank"
          actionLabel="Build rankings"
        />
      ) : (
        <div className="space-y-6">
          {receipts.rows
            .filter((row) => row.numberOneCallers.length > 0)
            .slice(0, 5)
            .map((row) => (
              <p key={`${row.rankableEntryId}-callout`} className="text-sm text-ink">
                <strong>
                  {row.numberOneCallers.length} user
                  {row.numberOneCallers.length === 1 ? "" : "s"}
                </strong>{" "}
                had {row.name} ranked {row.position}1 before kickoff.
                {row.numberOneCallers[0]
                  ? ` ${row.numberOneCallers[0].displayName} had ${row.name.split(" ").slice(-1)[0]} ${row.position}1.`
                  : ""}
              </p>
            ))}

          <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3">Player</th>
                  <th className="px-3 py-3">Pos</th>
                  <th className="px-3 py-3">Pts</th>
                  <th className="px-3 py-3">Prov. rank</th>
                  <th className="px-3 py-3">Boards</th>
                  <th className="px-3 py-3">% #1</th>
                  <th className="px-3 py-3">% Top 3</th>
                  <th className="px-3 py-3">Avg rank</th>
                  <th className="px-3 py-3">#1 callers</th>
                </tr>
              </thead>
              <tbody>
                {receipts.rows.map((row) => (
                  <tr
                    key={row.rankableEntryId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink">{row.name}</p>
                      <p className="text-xs text-muted">{row.team}</p>
                    </td>
                    <td className="px-3 py-3 text-ink">{row.position}</td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.fantasyPoints?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.provisionalRank ?? "—"}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.boardsIncluding}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {Math.round(row.percentRankedOne * 100)}%
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {Math.round(row.percentTop3 * 100)}%
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.averageCommittedRank?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-ink">
                      <div className="flex flex-wrap gap-1">
                        {row.numberOneCallers.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          row.numberOneCallers.map((caller) => (
                            <ProfileLink
                              key={caller.username}
                              username={caller.username}
                              displayName={caller.displayName}
                            />
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Badge tone="warning">LIVE — Unofficial until the week is final</Badge>
        </div>
      )}
    </Container>
  );
}
