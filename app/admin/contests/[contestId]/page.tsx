import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  adminSaveBotSubmissionAction,
  associateExistingEntryAction,
  autoRankByFantasyPointsAction,
  createRankableEntryAction,
  gradeContestAction,
  removeContestEntryAction,
  transitionContestStatusAction,
  updateContestAction,
  updateContestResultsAction,
} from "@/lib/admin-actions";
import {
  canTransitionContest,
  CONTEST_STATUS_ACTIONS,
} from "@/lib/contest-lifecycle";
import { prisma } from "@/lib/db";
import { toUiPosition } from "@/lib/contest-defaults";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/admin/contests/[contestId]">,
): Promise<Metadata> {
  const { contestId } = await props.params;
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
  });
  return {
    title: contest
      ? `${contest.position} Contest · Admin`
      : "Contest · Admin",
  };
}

function toDateTimeLocal(value: Date | null) {
  if (!value) return "";
  const offset = value.getTimezoneOffset();
  const local = new Date(value.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export default async function AdminContestDetailPage(
  props: PageProps<"/admin/contests/[contestId]">,
) {
  const { contestId } = await props.params;

  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      week: true,
      season: true,
      entries: {
        include: { rankableEntry: true },
        orderBy: [{ actualRank: "asc" }, { rankableEntry: { name: "asc" } }],
      },
      submissions: {
        include: { universalProfile: true },
      },
    },
  });

  if (!contest) notFound();

  const associatedIds = contest.entries.map((entry) => entry.rankableEntryId);
  const [availableEntries, aiProfiles] = await Promise.all([
    prisma.rankableEntry.findMany({
      where: {
        position: contest.position,
        active: true,
        ...(associatedIds.length > 0 ? { id: { notIn: associatedIds } } : {}),
      },
      orderBy: { name: "asc" },
      take: 100,
    }),
    prisma.universalProfile.findMany({
      where: { profileType: "AI" },
      orderBy: { displayName: "asc" },
    }),
  ]);

  const draftCount = contest.submissions.filter((s) => s.status === "DRAFT").length;
  const submittedCount = contest.submissions.filter(
    (s) => s.status === "SUBMITTED",
  ).length;
  const lockedCount = contest.submissions.filter((s) => s.status === "LOCKED").length;
  const gradedCount = contest.submissions.filter((s) => s.status === "GRADED").length;
  const resultsReady =
    contest.entries.filter((entry) => entry.actualRank != null).length >=
    contest.rankingDepth;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/contests" />
      <SectionHeading
        eyebrow={`${contest.season.sport} ${contest.season.year} · ${contest.week.label}`}
        title={`${contest.position} contest`}
        description={contest.title}
        action={
          <Badge tone={contest.status === "OPEN" ? "success" : "neutral"}>
            {contest.status}
          </Badge>
        }
      />

      <p className="mb-4 text-sm text-muted">
        Ranking depth:{" "}
        <span className="font-semibold text-ink">{contest.rankingDepth}</span>
        {" · "}
        Eligible entries:{" "}
        <span className="font-semibold text-ink">{contest.entries.length}</span>
        {" · "}
        Drafts: <span className="font-semibold text-ink">{draftCount}</span>
        {" · "}
        Submitted:{" "}
        <span className="font-semibold text-ink">{submittedCount}</span>
        {" · "}
        Locked: <span className="font-semibold text-ink">{lockedCount}</span>
        {" · "}
        Graded: <span className="font-semibold text-ink">{gradedCount}</span>
      </p>

      <div className="mb-8 flex flex-wrap gap-3 text-sm">
        <Link
          href={`/rank/${toUiPosition(contest.position)}`}
          className="text-accent hover:underline"
        >
          Public ranking board →
        </Link>
        <Link href="/leaderboards" className="text-accent hover:underline">
          Leaderboards →
        </Link>
        <Link href="/results" className="text-accent hover:underline">
          Results →
        </Link>
      </div>

      <section className="mb-10 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Contest lifecycle
        </h2>
        <p className="mt-1 text-sm text-muted">
          V1 lock rule: only explicitly SUBMITTED rankings become LOCKED
          competitors. Complete but unsubmitted drafts do not count.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {CONTEST_STATUS_ACTIONS.filter((action) =>
            canTransitionContest(contest.status, action.status),
          ).map((action) =>
            action.status === "LOCKED" ? (
              <ConfirmSubmit
                key={action.status}
                action={transitionContestStatusAction}
                submitLabel={action.label}
                impact={`Lock ${contest.title}. Explicit SUBMITTED rankings become LOCKED competitors. Unsubmitted drafts do not count.`}
                confirmPhrase="LOCK"
              >
                <input type="hidden" name="contestId" value={contest.id} />
                <input type="hidden" name="status" value={action.status} />
              </ConfirmSubmit>
            ) : (
              <form key={action.status} action={transitionContestStatusAction}>
                <input type="hidden" name="contestId" value={contest.id} />
                <input type="hidden" name="status" value={action.status} />
                <Button type="submit" size="sm" variant="secondary">
                  {action.label}
                </Button>
              </form>
            ),
          )}
          <ConfirmSubmit
            action={gradeContestAction}
            submitLabel={gradedCount > 0 ? "Regrade Contest" : "Grade Contest"}
            impact={`Grade ${contest.title}. Recalculates EYEQ accuracy scores from actual finishes. Formulas do not change.`}
            blockers={
              resultsReady
                ? []
                : [
                    `Need actualRank for at least Top ${contest.rankingDepth} entries before grading.`,
                  ]
            }
            confirmPhrase="GRADE"
          >
            <input type="hidden" name="contestId" value={contest.id} />
          </ConfirmSubmit>
        </div>
        {!resultsReady ? (
          <p className="mt-3 text-xs text-warning">
            Grade requires actualRank values for at least Top{" "}
            {contest.rankingDepth} entries.
          </p>
        ) : null}
      </section>

      <section className="mb-10 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          AI / bot submission
        </h2>
        <p className="mt-1 text-sm text-muted">
          Enter rankings for an AI UniversalProfile. Same submit/grade path as
          humans.
        </p>
        <form action={adminSaveBotSubmissionAction} className="mt-4 space-y-3">
          <input type="hidden" name="contestId" value={contest.id} />
          <label className="block text-sm">
            <span className="text-muted">AI profile</span>
            <select
              name="profileId"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            >
              {aiProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.displayName} (@{profile.username})
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: contest.rankingDepth }, (_, index) => (
              <label key={index} className="block text-sm">
                <span className="text-muted">Rank {index + 1}</span>
                <select
                  name="rankedEntryId"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
                  defaultValue=""
                >
                  <option value="">—</option>
                  {contest.entries.map((entry) => (
                    <option
                      key={`${index}-${entry.rankableEntryId}`}
                      value={entry.rankableEntryId}
                    >
                      {entry.rankableEntry.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="submit" value="0" variant="secondary">
              Save draft
            </Button>
            <Button type="submit" name="submit" value="1">
              Submit rankings
            </Button>
          </div>
        </form>
      </section>

      <form
        action={updateContestAction}
        className="mb-10 grid gap-3 rounded-lg border border-border bg-surface-elevated p-5 sm:grid-cols-2"
      >
        <h2 className="font-display text-lg font-semibold text-ink sm:col-span-2">
          Contest settings
        </h2>
        <input type="hidden" name="contestId" value={contest.id} />
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Title</span>
          <input
            name="title"
            defaultValue={contest.title}
            required
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Status</span>
          <select
            name="status"
            defaultValue={contest.status}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            {[
              "DRAFT",
              "OPEN",
              "LOCKED",
              "LIVE",
              "GRADING",
              "FINAL",
              "ARCHIVED",
            ].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm text-muted">
          Depth is fixed at create time from position rules (Top{" "}
          {contest.rankingDepth}).
        </div>
        <label className="block text-sm">
          <span className="text-muted">Opens at</span>
          <input
            name="opensAt"
            type="datetime-local"
            defaultValue={toDateTimeLocal(contest.opensAt)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Locks at</span>
          <input
            name="locksAt"
            type="datetime-local"
            defaultValue={toDateTimeLocal(contest.locksAt)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit">Save contest</Button>
        </div>
      </form>

      <section className="mb-10 grid gap-6 lg:grid-cols-2">
        <form
          action={createRankableEntryAction}
          className="space-y-3 rounded-lg border border-border bg-surface-elevated p-5"
        >
          <h2 className="font-display text-lg font-semibold text-ink">
            Add new rankable entry
          </h2>
          <input type="hidden" name="contestId" value={contest.id} />
          <label className="block text-sm">
            <span className="text-muted">Name</span>
            <input
              name="name"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Short name</span>
            <input
              name="shortName"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Team</span>
            <input
              name="team"
              required
              placeholder="BUF"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Opponent</span>
            <input
              name="opponent"
              placeholder="@ MIA"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Game starts at</span>
            <input
              name="gameStartsAt"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Availability</span>
            <select
              name="availability"
              defaultValue="ACTIVE"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            >
              {["ACTIVE", "QUESTIONABLE", "DOUBTFUL", "OUT", "INACTIVE"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </label>
          <Button type="submit">Create & associate</Button>
        </form>

        <form
          action={associateExistingEntryAction}
          className="space-y-3 rounded-lg border border-border bg-surface-elevated p-5"
        >
          <h2 className="font-display text-lg font-semibold text-ink">
            Associate existing entry
          </h2>
          <input type="hidden" name="contestId" value={contest.id} />
          <label className="block text-sm">
            <span className="text-muted">Available {contest.position} entries</span>
            <select
              name="rankableEntryId"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            >
              {availableEntries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.team})
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={availableEntries.length === 0}>
            Add to contest
          </Button>
          {availableEntries.length === 0 ? (
            <p className="text-xs text-muted">
              No unassociated active entries for this position.
            </p>
          ) : null}
        </form>
      </section>

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">
              Eligible entries & results
            </h2>
            <p className="mt-1 text-sm text-muted">
              Enter fantasy points and actual ranks manually. Optional helper
              sorts ranks by fantasy points descending.
            </p>
          </div>
          <form action={autoRankByFantasyPointsAction}>
            <input type="hidden" name="contestId" value={contest.id} />
            <Button type="submit" variant="secondary" size="sm">
              Auto-rank by fantasy points
            </Button>
          </form>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
          <form action={updateContestResultsAction}>
            <input type="hidden" name="contestId" value={contest.id} />
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3">Player / DEF</th>
                  <th className="px-3 py-3">Team</th>
                  <th className="px-3 py-3">Fantasy pts</th>
                  <th className="px-3 py-3">Actual rank</th>
                </tr>
              </thead>
              <tbody>
                {contest.entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2">
                      <input type="hidden" name="entryId" value={entry.id} />
                      <p className="font-medium text-ink">
                        {entry.rankableEntry.name}
                      </p>
                      <p className="text-xs text-muted">
                        {entry.rankableEntry.opponent}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {entry.rankableEntry.team}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        name={`fantasyPoints_${entry.id}`}
                        type="number"
                        step="0.1"
                        defaultValue={entry.fantasyPoints ?? ""}
                        className="w-24 rounded-md border border-border bg-surface px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        name={`actualRank_${entry.id}`}
                        type="number"
                        min={1}
                        defaultValue={entry.actualRank ?? ""}
                        className="w-20 rounded-md border border-border bg-surface px-2 py-1"
                      />
                    </td>
                  </tr>
                ))}
                {contest.entries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-muted">
                      No eligible entries yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <div className="border-t border-border px-3 py-3">
              <Button type="submit">Save results</Button>
              <p className="mt-2 text-xs text-muted">
                Automatic submission grading is intentionally left for the next
                pass. Results storage is ready for the scoring engine.
              </p>
            </div>
          </form>
        </div>

        {contest.entries.length > 0 ? (
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h3 className="text-sm font-semibold text-ink">Remove from contest</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {contest.entries.map((entry) => (
                <li key={`remove-${entry.id}`}>
                  <form action={removeContestEntryAction}>
                    <input type="hidden" name="contestId" value={contest.id} />
                    <input
                      type="hidden"
                      name="contestEntryId"
                      value={entry.id}
                    />
                    <button
                      type="submit"
                      className="rounded border border-border bg-surface-elevated px-2 py-1 text-xs text-muted hover:text-ink"
                    >
                      Remove {entry.rankableEntry.shortName}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </Container>
  );
}
