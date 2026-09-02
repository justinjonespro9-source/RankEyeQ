"use client";

import type { DragEvent } from "react";
import { PlayerAvatar } from "@/components/rank/PlayerAvatar";
import type { RankingPlayer } from "@/types/contest";

export function RankingSlot({
  rank,
  player,
  editable,
  locked,
  isDragging,
  podiumPick = false,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  rank: number;
  player: RankingPlayer | null;
  editable: boolean;
  locked: boolean;
  isDragging: boolean;
  podiumPick?: boolean;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDragStart: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const slotEditable = editable && !locked;

  return (
    <li
      data-slot={rank}
      data-locked={locked ? "true" : "false"}
      onDragOver={onDragOver}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={`flex min-h-14 min-w-0 items-center gap-2 rounded-md border bg-surface px-2 py-2 sm:gap-3 sm:px-3 ${
        locked
          ? "border-warning/50 bg-warning-soft/40"
          : podiumPick
            ? "border-accent/35 bg-accent-soft/25"
            : player
              ? "border-border"
              : "border-dashed border-border"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      <span
        className={`font-display w-6 shrink-0 text-center text-sm font-semibold tabular-nums sm:w-7 ${
          podiumPick ? "text-accent" : "text-accent"
        }`}
      >
        {rank}
      </span>

      {player ? (
        <>
          <button
            type="button"
            draggable={slotEditable}
            onDragStart={(event) => {
              if (!slotEditable) return;
              event.dataTransfer.setData("text/rank-index", String(rank - 1));
              event.dataTransfer.effectAllowed = "move";
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            disabled={!slotEditable}
            className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
              slotEditable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
            }`}
            aria-label={
              locked
                ? `${player.name}, locked at rank ${rank}`
                : slotEditable
                  ? `Drag to reorder ${player.name}, currently ranked ${rank}`
                  : `${player.name}, ranked ${rank}`
            }
          >
            <PlayerAvatar player={player} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">
                {player.name}
              </span>
              <span className="block truncate text-xs text-muted">
                {player.team} · {player.opponent}
                {locked ? " · Locked" : ""}
              </span>
            </span>
          </button>

          {locked ? (
            <span className="shrink-0 rounded-md bg-warning-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning">
              Locked
            </span>
          ) : slotEditable ? (
            <div className="flex shrink-0 items-center gap-1">
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={onMoveUp}
                  disabled={!canMoveUp}
                  className="rounded px-1.5 py-0.5 text-xs font-semibold text-ink hover:bg-surface-elevated disabled:opacity-30"
                  aria-label={`Move ${player.name} up`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={onMoveDown}
                  disabled={!canMoveDown}
                  className="rounded px-1.5 py-0.5 text-xs font-semibold text-ink hover:bg-surface-elevated disabled:opacity-30"
                  aria-label={`Move ${player.name} down`}
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                onClick={onRemove}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-elevated hover:text-ink"
              >
                Remove
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <span className="text-sm text-muted">
          {locked ? "Locked empty slot" : "Empty slot"}
        </span>
      )}
    </li>
  );
}
