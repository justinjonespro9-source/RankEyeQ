"use client";

import { useState } from "react";
import { RankingSlot } from "@/components/rank/RankingSlot";
import { SCORING_PODIUM_HELPER } from "@/lib/scoring-messaging";
import type { RankingPlayer } from "@/types/contest";

const PODIUM_SLOTS = 3;

const RESERVE_COPY =
  "Reserves automatically move into your scoring board if a ranked player is officially ruled out before kickoff.";

export function RankingBoard({
  slots,
  slotCount,
  scoringDepth,
  title,
  editable,
  lockedIndexes,
  onReorder,
  onRemove,
}: {
  slots: (RankingPlayer | null)[];
  slotCount: number;
  scoringDepth: number;
  title: string;
  editable: boolean;
  lockedIndexes: Set<number>;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const reserveStart = scoringDepth;

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

  function renderSlot(player: RankingPlayer | null, index: number) {
    const locked = lockedIndexes.has(index);
    const isReserve = index >= reserveStart;
    const isPodiumSlot = !isReserve && index < PODIUM_SLOTS;
    const displayRank = isReserve ? index - reserveStart + 1 : index + 1;

    return (
      <RankingSlot
        key={`slot-${index + 1}`}
        rank={isReserve ? displayRank : index + 1}
        rankLabel={isReserve ? `R${displayRank}` : undefined}
        player={player}
        editable={editable}
        locked={locked}
        isDragging={dragIndex === index}
        podiumPick={isPodiumSlot}
        reserve={isReserve}
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
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-ink">
            Ranked · 1–{scoringDepth}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Scoring board. {SCORING_PODIUM_HELPER} Order within your Top 3 does
            not affect the Podium Call bonus.
          </p>
        </div>

        <ol className="space-y-2">
          {slots.slice(0, scoringDepth).flatMap((player, index) => {
            const slot = renderSlot(player, index);
            if (index === PODIUM_SLOTS) {
              return [
                <li key="field-divider" className="list-none">
                  <p className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    Field picks · slots 4–{scoringDepth}
                  </p>
                </li>,
                slot,
              ];
            }
            return [slot];
          })}
        </ol>

        {slotCount > scoringDepth ? (
          <div className="mt-4 space-y-2 border-t border-dashed border-border pt-4">
            <div className="rounded-md border border-border bg-surface px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Reserves · R1–R{slotCount - scoringDepth}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {RESERVE_COPY}
              </p>
            </div>
            <ol className="space-y-2">
              {slots.slice(scoringDepth).map((player, offset) =>
                renderSlot(player, scoringDepth + offset),
              )}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}
