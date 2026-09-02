"use client";

import { Button } from "@/components/ui/Button";
import type { ContestMode } from "@/types/contest";

const MODES: ContestMode[] = ["open", "locked", "final"];

export function DevContestControls({
  mode,
  onModeChange,
  onReset,
}: {
  mode: ContestMode;
  onModeChange: (mode: ContestMode) => void;
  onReset: () => void;
}) {
  return (
    <aside className="rounded-lg border border-dashed border-warning/40 bg-warning-soft/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-warning">
        Development only
      </p>
      <p className="mt-1 text-sm text-muted">
        Mock contest lifecycle toggle for testing. Not production contest logic.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {MODES.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={mode === value ? "primary" : "secondary"}
            onClick={() => onModeChange(value)}
          >
            {value.toUpperCase()}
          </Button>
        ))}
      </div>
      <div className="mt-3">
        <Button type="button" size="sm" variant="ghost" onClick={onReset}>
          Reset Mock Contest
        </Button>
      </div>
    </aside>
  );
}
