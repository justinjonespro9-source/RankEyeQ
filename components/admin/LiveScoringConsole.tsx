"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearLiveStatsAction,
  finalizeLiveGameAction,
  reopenLiveGameAction,
  saveAllLiveStatsAction,
  saveLiveDefenseStatsAction,
  saveLivePlayerStatsAction,
} from "@/lib/admin-live-scoring-actions";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  EMPTY_DEFENSE,
  EMPTY_PLAYER,
  type LiveScoringAdminGameStatus,
  type LiveScoringEntryRow,
  type LiveScoringGameSummary,
} from "@/lib/admin/live-scoring-shared";
import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type SeasonOption = {
  id: string;
  year: number;
  weeks: Array<{ id: string; weekNumber: number; label: string | null }>;
};

type Props = {
  seasons: SeasonOption[];
  seasonId: string;
  weekId: string;
  gameId: string | null;
  games: LiveScoringGameSummary[];
  entries: LiveScoringEntryRow[];
  scoringVersion: string;
};

type DraftState = {
  players: Record<string, Required<PlayerStatLine>>;
  defenses: Record<string, Required<DefenseStatLine>>;
};

const PLAYER_FIELDS: Array<{
  key: keyof PlayerStatLine;
  label: string;
  step?: string;
}> = [
  { key: "passingYards", label: "Pass Yds" },
  { key: "passingTds", label: "Pass TD" },
  { key: "interceptions", label: "INT" },
  { key: "rushingYards", label: "Rush Yds" },
  { key: "rushingTds", label: "Rush TD" },
  { key: "receptions", label: "Rec" },
  { key: "receivingYards", label: "Rec Yds" },
  { key: "receivingTds", label: "Rec TD" },
  { key: "fumblesLost", label: "Fum Lost" },
  { key: "twoPointConversions", label: "2PT" },
  { key: "returnTds", label: "Ret TD" },
];

const DEFENSE_FIELDS: Array<{
  key: keyof DefenseStatLine;
  label: string;
}> = [
  { key: "pointsAllowed", label: "Pts Allowed" },
  { key: "sacks", label: "Sacks" },
  { key: "interceptions", label: "INT" },
  { key: "fumbleRecoveries", label: "FR" },
  { key: "defensiveTds", label: "Def TD" },
  { key: "specialTeamsTds", label: "ST TD" },
  { key: "safeties", label: "Safety" },
  { key: "blockedKicks", label: "Blk" },
];

function emphasizeKeys(position: ContestPosition): Set<string> {
  if (position === "QB") {
    return new Set([
      "passingYards",
      "passingTds",
      "interceptions",
      "rushingYards",
      "rushingTds",
    ]);
  }
  if (position === "RB") {
    return new Set([
      "rushingYards",
      "rushingTds",
      "receptions",
      "receivingYards",
      "receivingTds",
      "fumblesLost",
    ]);
  }
  if (position === "WR" || position === "TE") {
    return new Set([
      "receptions",
      "receivingYards",
      "receivingTds",
      "rushingYards",
      "rushingTds",
      "fumblesLost",
    ]);
  }
  return new Set();
}

function initialDraft(entries: LiveScoringEntryRow[]): DraftState {
  const players: DraftState["players"] = {};
  const defenses: DraftState["defenses"] = {};
  for (const entry of entries) {
    if (entry.position === "DEF") {
      defenses[entry.contestEntryId] = {
        ...EMPTY_DEFENSE,
        ...(entry.defenseStats ?? {}),
      };
    } else {
      players[entry.contestEntryId] = {
        ...EMPTY_PLAYER,
        ...(entry.playerStats ?? {}),
      };
    }
  }
  return { players, defenses };
}

function formatFp(value: number) {
  return value.toFixed(1);
}

function formatSavedAt(value: Date | string) {
  return new Date(value).toLocaleString();
}

function adminStatusTone(
  status: LiveScoringAdminGameStatus,
): "neutral" | "warning" | "success" {
  if (status === "FINALIZED") return "success";
  if (status === "LIVE") return "warning";
  return "neutral";
}

function adminStatusLabel(status: LiveScoringAdminGameStatus) {
  if (status === "FINALIZED") return "FINALIZED / VERIFIED";
  if (status === "LIVE") return "LIVE";
  return "NOT STARTED";
}

export function LiveScoringConsole(props: Props) {
  const revision = props.entries
    .map(
      (entry) =>
        `${entry.contestEntryId}:${entry.hasLiveStatRecord}:${String(entry.updatedAt)}:${entry.fantasyPoints ?? "n"}`,
    )
    .join("|");
  return (
    <LiveScoringConsoleInner
      key={`${props.gameId ?? "none"}:${revision}`}
      {...props}
    />
  );
}

function LiveScoringConsoleInner({
  seasons,
  seasonId,
  weekId,
  gameId,
  games,
  entries,
  scoringVersion,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => initialDraft(entries));
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === gameId) ?? null,
    [games, gameId],
  );
  const gameFinalized = Boolean(selectedGame?.statsFinalizedAt);
  const anyLocked = entries.some((entry) => entry.lockedByFinal);

  const weeks = useMemo(
    () => seasons.find((season) => season.id === seasonId)?.weeks ?? [],
    [seasons, seasonId],
  );

  function navigate(next: {
    seasonId?: string;
    weekId?: string;
    gameId?: string | null;
  }) {
    const params = new URLSearchParams();
    params.set("seasonId", next.seasonId ?? seasonId);
    params.set("weekId", next.weekId ?? weekId);
    const nextGame = next.gameId === undefined ? gameId : next.gameId;
    if (nextGame) params.set("gameId", nextGame);
    router.push(`/admin/live-scoring?${params.toString()}`);
  }

  function setPlayerField(
    contestEntryId: string,
    key: keyof PlayerStatLine,
    raw: string,
  ) {
    const value = raw === "" ? 0 : Number(raw);
    setDraft((current) => ({
      ...current,
      players: {
        ...current.players,
        [contestEntryId]: {
          ...current.players[contestEntryId],
          [key]: Number.isFinite(value) ? value : 0,
        },
      },
    }));
  }

  function setDefenseField(
    contestEntryId: string,
    key: keyof DefenseStatLine,
    raw: string,
  ) {
    const value = raw === "" ? 0 : Number(raw);
    setDraft((current) => ({
      ...current,
      defenses: {
        ...current.defenses,
        [contestEntryId]: {
          ...current.defenses[contestEntryId],
          [key]: Number.isFinite(value) ? value : 0,
        },
      },
    }));
  }

  function savePlayer(entry: LiveScoringEntryRow) {
    const stats = draft.players[entry.contestEntryId];
    if (!stats) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveLivePlayerStatsAction({
        contestEntryId: entry.contestEntryId,
        weekId,
        stats,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.result.skipped) {
        setError(result.result.reason ?? "Save skipped");
        return;
      }
      setMessage(
        `Saved ${entry.name}: ${formatFp(result.result.fantasyPoints)} FP (live/unofficial)`,
      );
      router.refresh();
    });
  }

  function saveDefense(entry: LiveScoringEntryRow) {
    const stats = draft.defenses[entry.contestEntryId];
    if (!stats) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveLiveDefenseStatsAction({
        contestEntryId: entry.contestEntryId,
        weekId,
        stats,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.result.skipped) {
        setError(result.result.reason ?? "Save skipped");
        return;
      }
      setMessage(
        `Saved ${entry.name}: ${formatFp(result.result.fantasyPoints)} FP (live/unofficial)`,
      );
      router.refresh();
    });
  }

  function saveAll() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveAllLiveStatsAction({
        weekId,
        players: Object.entries(draft.players).map(([contestEntryId, stats]) => ({
          contestEntryId,
          stats,
        })),
        defenses: Object.entries(draft.defenses).map(
          ([contestEntryId, stats]) => ({
            contestEntryId,
            stats,
          }),
        ),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(
        `Saved ${result.results.saved} entries (${result.results.skipped} skipped)`,
      );
      router.refresh();
    });
  }

  function clearEntry(entry: LiveScoringEntryRow) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await clearLiveStatsAction({
        contestEntryId: entry.contestEntryId,
        weekId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.result.skipped) {
        setError(result.result.reason ?? "Clear skipped");
        return;
      }
      setDraft((current) => {
        if (entry.position === "DEF") {
          return {
            ...current,
            defenses: {
              ...current.defenses,
              [entry.contestEntryId]: { ...EMPTY_DEFENSE },
            },
          };
        }
        return {
          ...current,
          players: {
            ...current.players,
            [entry.contestEntryId]: { ...EMPTY_PLAYER },
          },
        };
      });
      setMessage(`Cleared live stats for ${entry.name}`);
      router.refresh();
    });
  }

  function finalizeGame() {
    if (!gameId) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await finalizeLiveGameAction({ weekId, gameId });
      setConfirmFinalize(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(
        `Verified & finalized ${result.result.matchup}. Weekly ranks/EYEQ remain provisional.`,
      );
      router.refresh();
    });
  }

  function reopenGame() {
    if (!gameId) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await reopenLiveGameAction({ weekId, gameId });
      setConfirmReopen(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(
        `Reopened ${result.result.matchup} for correction. Save updated stats, then finalize again.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-surface-elevated p-4">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Season</span>
          <select
            className="rounded border border-border bg-surface px-3 py-2"
            value={seasonId}
            onChange={(event) => {
              const nextSeason = event.target.value;
              const nextWeeks =
                seasons.find((season) => season.id === nextSeason)?.weeks ?? [];
              navigate({
                seasonId: nextSeason,
                weekId: nextWeeks[0]?.id ?? "",
                gameId: null,
              });
            }}
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.year}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Week</span>
          <select
            className="rounded border border-border bg-surface px-3 py-2"
            value={weekId}
            onChange={(event) =>
              navigate({ weekId: event.target.value, gameId: null })
            }
          >
            {weeks.map((week) => (
              <option key={week.id} value={week.id}>
                Week {week.weekNumber}
                {week.label ? ` — ${week.label}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Game</span>
          <select
            className="min-w-[16rem] rounded border border-border bg-surface px-3 py-2"
            value={gameId ?? ""}
            onChange={(event) =>
              navigate({ gameId: event.target.value || null })
            }
          >
            <option value="">Select a game</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.awayTeam} @ {game.homeTeam} · {game.adminStatus} ·{" "}
                {game.scoredEntries}/{game.totalEntries} scored
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-end gap-2">
          {selectedGame ? (
            <Badge tone={adminStatusTone(selectedGame.adminStatus)}>
              {adminStatusLabel(selectedGame.adminStatus)}
            </Badge>
          ) : (
            <Badge tone="warning">Live / unofficial</Badge>
          )}
          <Badge tone="neutral">{scoringVersion}</Badge>
        </div>
      </div>

      {games.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-elevated text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Matchup</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Scored</th>
                <th className="px-3 py-2 font-medium">Last update</th>
                <th className="px-3 py-2 font-medium">Finalized</th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <tr
                  key={game.id}
                  className={`border-t border-border ${
                    game.id === gameId ? "bg-accent-soft/40" : "bg-surface"
                  }`}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="font-medium text-accent-ink hover:underline"
                      onClick={() => navigate({ gameId: game.id })}
                    >
                      {game.awayTeam} @ {game.homeTeam}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={adminStatusTone(game.adminStatus)}>
                      {adminStatusLabel(game.adminStatus)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {game.scoredEntries}/{game.totalEntries}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {game.lastStatUpdateAt
                      ? formatSavedAt(game.lastStatUpdateAt)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {game.statsFinalizedAt
                      ? formatSavedAt(game.statsFinalizedAt)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-sm text-muted">
        Enter underlying football stats. Fantasy points are calculated by the
        canonical Half-PPR engine — not typed in. Verify &amp; Finalize Game locks
        that game&apos;s manual WeekStat lines as verified. It does not finalize
        weekly positional contests or grade EYEQ.
      </p>

      {message ? (
        <p className="rounded border border-border bg-surface-elevated px-3 py-2 text-sm text-ink">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded border border-danger/40 bg-danger-soft/30 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {!gameId ? (
        <p className="text-sm text-muted">Select a game to open the scoring console.</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">
          No contest entries for this game. Ensure weekly pools include these
          teams.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={saveAll}
              disabled={pending || anyLocked || gameFinalized}
            >
              {pending ? "Saving…" : "Save all game changes"}
            </Button>
            {!gameFinalized ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !selectedGame}
                onClick={() => setConfirmFinalize(true)}
              >
                Verify &amp; Finalize Game
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirmReopen(true)}
              >
                Reopen / Correct Final Stats
              </Button>
            )}
          </div>

          {confirmFinalize && selectedGame ? (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
              <h3 className="font-semibold text-ink">
                Verify &amp; Finalize Game?
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-ink">
                <li>
                  Matchup: {selectedGame.awayTeam} @ {selectedGame.homeTeam}
                </li>
                <li>Player stat lines: {selectedGame.playerStatLines}</li>
                <li>DEF stat lines: {selectedGame.defenseStatLines}</li>
              </ul>
              <p className="mt-3 text-sm text-warning">
                This locks the game&apos;s current manual stats as
                verified/final. Weekly positional ranks and EYEQ are NOT final
                yet — other games may still be live.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={finalizeGame}>
                  Confirm finalize
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setConfirmFinalize(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {confirmReopen && selectedGame ? (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
              <h3 className="font-semibold text-ink">
                Reopen game for correction?
              </h3>
              <p className="mt-2 text-sm text-ink">
                {selectedGame.awayTeam} @ {selectedGame.homeTeam} — existing
                WeekStat rows are kept and marked provisional again so you can
                edit. History is not deleted.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={reopenGame}>
                  Confirm reopen
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setConfirmReopen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {entries.map((entry) => {
              if (entry.position === "DEF") {
                const stats =
                  draft.defenses[entry.contestEntryId] ?? EMPTY_DEFENSE;
                const liveFp = calculateDefenseLiveFantasyPoints(
                  stats,
                  entry.scoringVersion,
                );
                return (
                  <article
                    key={entry.contestEntryId}
                    className="rounded-lg border border-border bg-surface-elevated p-4"
                  >
                    <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-ink">
                          {entry.name}{" "}
                          <span className="text-muted">
                            ({entry.team} · DEF)
                          </span>
                        </h3>
                        <p className="text-xs text-muted">
                          vs {entry.opponent}
                          {entry.hasLiveStatRecord
                            ? ` · last saved ${formatSavedAt(entry.updatedAt)}`
                            : " · no live line yet"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-semibold tabular-nums text-ink">
                          {formatFp(liveFp)}
                        </p>
                        <p className="text-xs text-muted">calculated FP</p>
                        {entry.statsVerified ? (
                          <Badge tone="success">FINALIZED / VERIFIED</Badge>
                        ) : entry.hasLiveStatRecord ? (
                          <Badge tone="warning">LIVE</Badge>
                        ) : null}
                        {entry.lockedByFinal ? (
                          <Badge tone="neutral">
                            {entry.lockedByGameFinalize
                              ? "Locked (game finalized)"
                              : "Locked (final)"}
                          </Badge>
                        ) : null}
                      </div>
                    </header>
                    <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
                      {DEFENSE_FIELDS.map((field) => (
                        <label key={field.key} className="text-xs">
                          <span className="mb-1 block text-muted">
                            {field.label}
                          </span>
                          <input
                            type="number"
                            className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
                            value={stats[field.key] ?? 0}
                            disabled={entry.lockedByFinal || pending}
                            onChange={(event) =>
                              setDefenseField(
                                entry.contestEntryId,
                                field.key,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={entry.lockedByFinal || pending}
                        onClick={() => saveDefense(entry)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={
                          entry.lockedByFinal ||
                          pending ||
                          !entry.hasLiveStatRecord
                        }
                        onClick={() => clearEntry(entry)}
                      >
                        Clear live line
                      </Button>
                    </div>
                  </article>
                );
              }

              const stats = draft.players[entry.contestEntryId] ?? EMPTY_PLAYER;
              const liveFp = calculatePlayerLiveFantasyPoints(
                stats,
                entry.scoringVersion,
              );
              const emphasis = emphasizeKeys(entry.position);

              return (
                <article
                  key={entry.contestEntryId}
                  className="rounded-lg border border-border bg-surface-elevated p-4"
                >
                  <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-ink">
                        {entry.name}{" "}
                        <span className="text-muted">
                          ({entry.team} · {entry.position})
                        </span>
                      </h3>
                      <p className="text-xs text-muted">
                        vs {entry.opponent}
                        {entry.hasLiveStatRecord
                          ? ` · last saved ${formatSavedAt(entry.updatedAt)}`
                          : " · no live line yet"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-semibold tabular-nums text-ink">
                        {formatFp(liveFp)}
                      </p>
                      <p className="text-xs text-muted">calculated FP</p>
                      {entry.statsVerified ? (
                        <Badge tone="success">FINALIZED / VERIFIED</Badge>
                      ) : entry.hasLiveStatRecord ? (
                        <Badge tone="warning">LIVE</Badge>
                      ) : null}
                      {entry.lockedByFinal ? (
                        <Badge tone="neutral">
                          {entry.lockedByGameFinalize
                            ? "Locked (game finalized)"
                            : "Locked (final)"}
                        </Badge>
                      ) : null}
                    </div>
                  </header>
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-11">
                    {PLAYER_FIELDS.map((field) => {
                      const hot = emphasis.has(field.key);
                      return (
                        <label
                          key={field.key}
                          className={`text-xs ${hot ? "" : "opacity-80"}`}
                        >
                          <span
                            className={`mb-1 block ${
                              hot ? "font-medium text-ink" : "text-muted"
                            }`}
                          >
                            {field.label}
                          </span>
                          <input
                            type="number"
                            className={`w-full rounded border bg-surface px-2 py-1.5 text-sm ${
                              hot ? "border-ink/40" : "border-border"
                            }`}
                            value={stats[field.key] ?? 0}
                            disabled={entry.lockedByFinal || pending}
                            onChange={(event) =>
                              setPlayerField(
                                entry.contestEntryId,
                                field.key,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={entry.lockedByFinal || pending}
                      onClick={() => savePlayer(entry)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={
                        entry.lockedByFinal ||
                        pending ||
                        !entry.hasLiveStatRecord
                      }
                      onClick={() => clearEntry(entry)}
                    >
                      Clear live line
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
