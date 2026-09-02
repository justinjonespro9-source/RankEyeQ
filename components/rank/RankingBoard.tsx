"use client";

import { useState } from "react";
import { RankingSlot } from "@/components/rank/RankingSlot";
import { SCORING_PODIUM_HELPER } from "@/lib/scoring-messaging";
import type { RankingPlayer } from "@/types/contest";

const PODIUM_SLOTS = 3;

export function RankingBoard({
  slots,
  slotCount,
  title,
  editable,
  lockedIndexes,
  onReorder,
  onRemove,
}: {
  slots: (RankingPlayer | null)[];
  slotCount: number;
  title: string;
  editable: boolean;
  lockedIndexes: Set<number>;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function nextUnlocked(index: number, direction: -1 | 1) {
    let target = index + direction;
    while (target >= 0 && target < slotCount) {
      if (!lockedIndexes.has(target)) return target;
      target += direction;
    }
    return null;
  }

  function move(index: number, direction: -1 | 1) {
    if (lockedIndexes.has(index)) return;
    const target = nextUnlocked(index, direction);
    if (target == null) return;
    onReorder(index, target);
  }

  return (
    <section
      aria-labelledby="my-rankings-heading"
      className="rounded-lg border border-accent/20 bg-surface-elevated shadow-sm"
    >
      <div className="border-b border-border bg-accent-soft/20 px-4 py-3 sm:px-5">
        <h2
          id="my-rankings-heading"
          className="font-display text-lg font-semibold text-ink sm:text-xl"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Drag or use move buttons to reorder. Locked players stay fixed after
          kickoff.
        </p>
      </div>

      <div className="space-y-2 p-3 sm:p-4" data-dnd-region="ranking-slots">
        <div className="rounded-md border border-accent/25 bg-accent-soft/30 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">
            Podium picks · slots 1–3
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {SCORING_PODIUM_HELPER} Order within your Top 3 does not affect the
            Podium Call bonus.
          </p>
        </div>

        <ol className="space-y-2">
          {slots.flatMap((player, index) => {
            const locked = lockedIndexes.has(index);
            const isPodiumSlot = index < PODIUM_SLOTS;
            const slot = (
              <RankingSlot
                key={`slot-${index + 1}`}
                rank={index + 1}
                player={player}
                editable={editable}
                locked={locked}
                isDragging={dragIndex === index}
                podiumPick={isPodiumSlot}
                canMoveUp={!locked && nextUnlocked(index, -1) != null}
                canMoveDown={
                  !locked && player !== null && nextUnlocked(index, 1) != null
                }
                onRemove={() => onRemove(index)}
                onMoveUp={() => move(index, -1)}
                onMoveDown={() => move(index, 1)}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => {
                  if (!editable || lockedIndexes.has(index)) return;
                  event.preventDefault();
                }}
                onDrop={() => {
                  if (dragIndex === null || dragIndex === index) {
                    setDragIndex(null);
                    return;
                  }
                  onReorder(dragIndex, index);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
              />
            );

            if (index === PODIUM_SLOTS) {
              return [
                <li key="field-divider" className="list-none">
                  <p className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    Field picks · slots 4–{slotCount}
                  </p>
                </li>,
                slot,
              ];
            }

            return [slot];
          })}
        </ol>
      </div>
    </section>
  );
}
