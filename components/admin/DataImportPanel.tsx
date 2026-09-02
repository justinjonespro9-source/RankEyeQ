"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addOmittedPlayerAction,
  buildPositionPoolsAction,
  commitNflImportAction,
  excludeContestEntryAction,
  previewNflImportAction,
  restoreContestEntryAction,
  syncWeekFromProviderAction,
} from "@/lib/nfl/actions";
import type { PositionAudit } from "@/lib/nfl/audit";
import type { ImportCounts, ImportPreview } from "@/lib/nfl/import";
import { Button } from "@/components/ui/Button";

type WeekOption = {
  id: string;
  label: string;
  weekNumber: number;
  status: string;
};

type ContestRow = {
  id: string;
  position: string;
  status: string;
  entries: Array<{
    id: string;
    excluded: boolean;
    manuallyAdded: boolean;
    name: string;
    team: string;
    opponent: string;
  }>;
};

export function DataImportPanel({
  seasons,
  activeSeasonId,
  weeks,
  selectedWeekId,
  selectedWeekLabel,
  audit,
  contests,
  omittedByContest,
}: {
  seasons: Array<{ id: string; year: number; active: boolean }>;
  activeSeasonId: string;
  weeks: WeekOption[];
  selectedWeekId: string | null;
  selectedWeekLabel: string | null;
  audit: { provider: string; positions: PositionAudit[] } | null;
  contests: ContestRow[];
  omittedByContest: Array<{
    contestId: string;
    candidates: Array<{ id: string; name: string; team: string }>;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const [syncWeekNumber, setSyncWeekNumber] = useState("1");

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Action failed");
      }
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Week selection
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {weeks.map((week) => (
            <Link
              key={week.id}
              href={`/admin/data?weekId=${week.id}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                selectedWeekId === week.id
                  ? "bg-accent text-white"
                  : "border border-border bg-surface text-ink"
              }`}
            >
              {week.label} · {week.status}
            </Link>
          ))}
        </div>

        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          action={(formData) => {
            run(async () => {
              const result = await syncWeekFromProviderAction(formData);
              setMessage(`Synced week → ${result.weekId}`);
              router.push(`/admin/data?weekId=${result.weekId}`);
            });
          }}
        >
          <input type="hidden" name="seasonId" value={activeSeasonId} />
          <label className="text-sm">
            <span className="block text-muted">Create/update week from schedule</span>
            <input
              name="weekNumber"
              type="number"
              min={1}
              max={22}
              value={syncWeekNumber}
              onChange={(event) => setSyncWeekNumber(event.target.value)}
              className="mt-1 w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-ink"
            />
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>
            Sync week dates
          </Button>
          <p className="basis-full text-xs text-muted">
            Season {seasons.find((s) => s.id === activeSeasonId)?.year}. Does not
            duplicate existing week numbers.
          </p>
        </form>
      </section>

      {selectedWeekId ? (
        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Import {selectedWeekLabel}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Preview fetches provider data without writing. Commit upserts games,
            players, and defenses idempotently.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const formData = new FormData();
                  formData.set("weekId", selectedWeekId);
                  const result = await previewNflImportAction(formData);
                  setPreview(result.preview);
                  setCounts(null);
                  setMessage(
                    `Preview ready · ${result.preview.bundle.games.length} games · ${result.preview.bundle.players.length} players · ${result.preview.bundle.defenses.length} defenses`,
                  );
                })
              }
            >
              Fetch & preview
            </Button>
            <Button
              type="button"
              disabled={pending || !preview}
              onClick={() =>
                run(async () => {
                  const formData = new FormData();
                  formData.set("weekId", selectedWeekId);
                  const result = await commitNflImportAction(formData);
                  if (!result.ok) {
                    setMessage(result.error);
                    return;
                  }
                  setCounts(result.counts);
                  setMessage("Import committed");
                })
              }
            >
              Commit import
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const formData = new FormData();
                  formData.set("weekId", selectedWeekId);
                  const result = await buildPositionPoolsAction(formData);
                  setMessage(
                    `Pools built · ${result.result.entriesCreated} new entries · ${result.result.entriesSkippedExcluded} exclusions preserved`,
                  );
                })
              }
            >
              Build RankEyeQ Position Pools
            </Button>
          </div>

          {message ? (
            <p className="mt-3 text-sm text-accent" role="status">
              {message}
            </p>
          ) : null}

          {preview ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <Stat
                label="Games"
                value={`${preview.estimated.gamesCreated}c / ${preview.estimated.gamesUpdated}u / ${preview.estimated.gamesUnchanged}=`}
              />
              <Stat
                label="Players"
                value={`${preview.estimated.playersCreated}c / ${preview.estimated.playersUpdated}u / ${preview.estimated.playersUnchanged}=`}
              />
              <Stat
                label="Defenses"
                value={`${preview.estimated.defensesCreated}c / ${preview.estimated.defensesUpdated}u / ${preview.estimated.defensesUnchanged}=`}
              />
              <Stat label="Invalid / skipped" value={String(preview.bundle.invalid.length)} />
              <Stat
                label="Duplicate external IDs"
                value={String(preview.duplicateExternalIds.length)}
              />
              <Stat label="Provider" value={preview.provider} />
            </div>
          ) : null}

          {preview?.validation.issues.length ? (
            <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              preview.validation.ok
                ? "border-border bg-surface text-muted"
                : "border-warning/40 bg-warning-soft text-warning"
            }`}>
              {preview.validation.ok
                ? "Import validation warnings:"
                : "Import will be blocked until these issues are fixed:"}
              <ul className="mt-1 list-disc pl-5">
                {preview.validation.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.message}`}>
                    {issue.message}
                    {issue.blocking ? "" : " (warning)"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {counts ? (
            <p className="mt-3 text-xs text-muted">
              Committed — games {counts.gamesCreated}/{counts.gamesUpdated}/
              {counts.gamesUnchanged}, players {counts.playersCreated}/
              {counts.playersUpdated}/{counts.playersUnchanged}, defenses{" "}
              {counts.defensesCreated}/{counts.defensesUpdated}/
              {counts.defensesUnchanged}
            </p>
          ) : null}

          {preview && preview.bundle.invalid.length > 0 ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted">
                Unmapped / invalid rows ({preview.bundle.invalid.length})
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted">
                {preview.bundle.invalid.slice(0, 80).map((row, index) => (
                  <li key={`${row.externalId}-${index}`}>
                    {row.reason}
                    {row.externalId ? ` · ${row.externalId}` : ""}
                    {row.detail ? ` · ${row.detail}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {audit ? (
        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Data audit
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-2 py-2">Pos</th>
                  <th className="px-2 py-2">Imported</th>
                  <th className="px-2 py-2">Eligible</th>
                  <th className="px-2 py-2">In pool</th>
                  <th className="px-2 py-2">Excluded</th>
                  <th className="px-2 py-2">No team</th>
                  <th className="px-2 py-2">No opp</th>
                  <th className="px-2 py-2">No kickoff</th>
                  <th className="px-2 py-2">Dup IDs</th>
                </tr>
              </thead>
              <tbody>
                {audit.positions.map((row) => (
                  <tr key={row.position} className="border-b border-border last:border-0">
                    <td className="px-2 py-2 font-medium text-ink">{row.position}</td>
                    <td className="px-2 py-2 tabular-nums">{row.importedPlayers}</td>
                    <td className="px-2 py-2 tabular-nums">{row.contestEligible}</td>
                    <td className="px-2 py-2 tabular-nums">{row.inPool}</td>
                    <td className="px-2 py-2 tabular-nums">{row.excluded}</td>
                    <td className="px-2 py-2 tabular-nums">{row.missingTeam}</td>
                    <td className="px-2 py-2 tabular-nums">{row.missingOpponent}</td>
                    <td className="px-2 py-2 tabular-nums">{row.missingKickoff}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {row.duplicateExternalIds.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {contests.map((contest) => {
        const omitted =
          omittedByContest.find((row) => row.contestId === contest.id)
            ?.candidates ?? [];
        return (
          <section
            key={contest.id}
            className="rounded-lg border border-border bg-surface-elevated p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-ink">
                {contest.position} pool
              </h2>
              <Link
                href={`/admin/contests/${contest.id}`}
                className="text-sm text-accent hover:underline"
              >
                Contest admin
              </Link>
            </div>
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-sm">
              {contest.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 py-1.5 last:border-0"
                >
                  <span className={entry.excluded ? "text-muted line-through" : "text-ink"}>
                    {entry.name}{" "}
                    <span className="text-muted">
                      {entry.team} · {entry.opponent}
                      {entry.manuallyAdded ? " · manual" : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-accent hover:underline"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const formData = new FormData();
                        formData.set("contestEntryId", entry.id);
                        if (entry.excluded) {
                          await restoreContestEntryAction(formData);
                          setMessage(`Restored ${entry.name}`);
                        } else {
                          formData.set("excluded", "1");
                          await excludeContestEntryAction(formData);
                          setMessage(`Excluded ${entry.name}`);
                        }
                      })
                    }
                  >
                    {entry.excluded ? "Restore" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>

            {omitted.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Add omitted player
                </p>
                <form
                  className="mt-2 flex flex-wrap gap-2"
                  action={(formData) => {
                    formData.set("contestId", contest.id);
                    run(async () => {
                      await addOmittedPlayerAction(formData);
                      setMessage("Player added to pool");
                    });
                  }}
                >
                  <select
                    name="rankableEntryId"
                    className="min-w-[16rem] rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink"
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>
                      Select player
                    </option>
                    {omitted.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} ({candidate.team})
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="secondary" size="sm" disabled={pending}>
                    Add
                  </Button>
                </form>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-medium tabular-nums text-ink">{value}</p>
    </div>
  );
}
