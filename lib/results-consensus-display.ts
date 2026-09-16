/**
 * Shared Results ↔ Consensus display helpers.
 * Keep routes separate; share formatting / delta / sort only.
 */

/** actual − consensus: + = finished worse than consensus; − = better. */
export function consensusDelta(actualRank: number, consensusRank: number): number {
  return actualRank - consensusRank;
}

export type ConsensusDeltaDirection = "better" | "worse" | "even" | "none";

export type ConsensusDeltaDisplayModel = {
  /** Underlying signed delta (actual − consensus). Used for sorting. */
  delta: number | null;
  direction: ConsensusDeltaDirection;
  /** Absolute spots moved vs consensus (null when unknown/even). */
  spots: number | null;
  /** Visible magnitude text, e.g. "9" or "EVEN". */
  visibleValue: string;
  /** Accessible / title description. */
  title: string;
  toneClass: string;
};

/**
 * Semantic tone for consensus miss/overperformance.
 * Negative delta = overperformed consensus (good).
 * Positive delta = underperformed consensus (bad).
 */
export function consensusDeltaToneClass(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return "text-muted";
  }
  if (value < 0) return "text-success";
  return "text-danger";
}

/**
 * Display model for Vs Consensus movement.
 * Does not change the underlying numeric delta — only presentation.
 */
export function describeConsensusDelta(
  value: number | null | undefined,
): ConsensusDeltaDisplayModel {
  if (value == null || !Number.isFinite(value)) {
    return {
      delta: null,
      direction: "none",
      spots: null,
      visibleValue: "—",
      title: "No consensus comparison available",
      toneClass: "text-muted",
    };
  }

  if (value === 0) {
    return {
      delta: 0,
      direction: "even",
      spots: 0,
      visibleValue: "EVEN",
      title: "Finished even with consensus",
      toneClass: "text-muted",
    };
  }

  const spots = Math.abs(value);
  if (value < 0) {
    return {
      delta: value,
      direction: "better",
      spots,
      visibleValue: String(spots),
      title: `Finished ${spots} spot${spots === 1 ? "" : "s"} better than consensus`,
      toneClass: consensusDeltaToneClass(value),
    };
  }

  return {
    delta: value,
    direction: "worse",
    spots,
    visibleValue: String(spots),
    title: `Finished ${spots} spot${spots === 1 ? "" : "s"} worse than consensus`,
    toneClass: consensusDeltaToneClass(value),
  };
}

/** @deprecated Prefer ConsensusDeltaMove / describeConsensusDelta for UI. */
export function formatConsensusDelta(value: number | null | undefined): string {
  const model = describeConsensusDelta(value);
  if (model.direction === "better") return `↑ ${model.visibleValue}`;
  if (model.direction === "worse") return `↓ ${model.visibleValue}`;
  return model.visibleValue;
}

export type ResultsSortKey =
  | "actual"
  | "player"
  | "pts"
  | "consensus"
  | "delta"
  | "selected"
  | "avgSelected"
  | "ballots";

export type ResultsSortDir = "asc" | "desc";

export type ResultsTableRow = {
  rankableEntryId: string;
  name: string;
  team: string;
  opponent: string;
  actualRank: number;
  fantasyPoints: number;
  selectionRate: number | null;
  averageSelectedRank: number | null;
  consensusRank: number | null;
  consensusVsActual: number | null;
  ballots: number | null;
};

function cmpNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: ResultsSortDir,
): number {
  const aMissing = a == null || !Number.isFinite(a);
  const bMissing = b == null || !Number.isFinite(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const diff = (a as number) - (b as number);
  return dir === "asc" ? diff : -diff;
}

export function sortResultsTableRows(
  rows: readonly ResultsTableRow[],
  key: ResultsSortKey,
  dir: ResultsSortDir,
): ResultsTableRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    let primary = 0;
    switch (key) {
      case "actual":
        primary = cmpNullableNumber(a.actualRank, b.actualRank, dir);
        break;
      case "player":
        primary = a.name.localeCompare(b.name);
        if (dir === "desc") primary = -primary;
        break;
      case "pts":
        primary = cmpNullableNumber(a.fantasyPoints, b.fantasyPoints, dir);
        break;
      case "consensus":
        primary = cmpNullableNumber(a.consensusRank, b.consensusRank, dir);
        break;
      case "delta":
        primary = cmpNullableNumber(
          a.consensusVsActual,
          b.consensusVsActual,
          dir,
        );
        break;
      case "selected":
        primary = cmpNullableNumber(a.selectionRate, b.selectionRate, dir);
        break;
      case "avgSelected":
        primary = cmpNullableNumber(
          a.averageSelectedRank,
          b.averageSelectedRank,
          dir,
        );
        break;
      case "ballots":
        primary = cmpNullableNumber(a.ballots, b.ballots, dir);
        break;
      default:
        primary = 0;
    }
    if (primary !== 0) return primary;
    return a.actualRank - b.actualRank;
  });
  return copy;
}

export function nextResultsSort(
  currentKey: ResultsSortKey,
  currentDir: ResultsSortDir,
  nextKey: ResultsSortKey,
): { key: ResultsSortKey; dir: ResultsSortDir } {
  if (currentKey === nextKey) {
    return { key: nextKey, dir: currentDir === "asc" ? "desc" : "asc" };
  }
  // Sensible first-click defaults: ranks/delta/avg ascending; pts/selected/ballots descending; player A→Z
  if (
    nextKey === "pts" ||
    nextKey === "selected" ||
    nextKey === "ballots"
  ) {
    return { key: nextKey, dir: "desc" };
  }
  return { key: nextKey, dir: "asc" };
}
