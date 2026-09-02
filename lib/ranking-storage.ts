import {
  contestModeStorageKey,
  rankingStorageKey,
} from "@/lib/contest";
import type {
  ContestMode,
  Position,
  StoredRankingState,
} from "@/types/contest";

function emptySlots(slotCount: number): (string | null)[] {
  return Array.from({ length: slotCount }, () => null);
}

export function createEmptyRankingState(slotCount: number): StoredRankingState {
  return {
    rankedPlayerIds: emptySlots(slotCount),
    submissionStatus: "draft",
    savedAt: new Date().toISOString(),
  };
}

export function loadRankingState(
  weekKey: string,
  position: Position,
  slotCount: number,
): StoredRankingState {
  if (typeof window === "undefined") {
    return createEmptyRankingState(slotCount);
  }

  try {
    const raw = window.localStorage.getItem(
      rankingStorageKey(weekKey, position),
    );
    if (!raw) return createEmptyRankingState(slotCount);

    const parsed = JSON.parse(raw) as StoredRankingState;
    const ids = Array.isArray(parsed.rankedPlayerIds)
      ? parsed.rankedPlayerIds.slice(0, slotCount)
      : emptySlots(slotCount);

    while (ids.length < slotCount) ids.push(null);

    return {
      rankedPlayerIds: ids.map((id) => (typeof id === "string" ? id : null)),
      submissionStatus:
        parsed.submissionStatus === "submitted" ? "submitted" : "draft",
      savedAt:
        typeof parsed.savedAt === "string"
          ? parsed.savedAt
          : new Date().toISOString(),
    };
  } catch {
    return createEmptyRankingState(slotCount);
  }
}

export function saveRankingState(
  weekKey: string,
  position: Position,
  state: StoredRankingState,
): StoredRankingState {
  const next: StoredRankingState = {
    ...state,
    savedAt: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      rankingStorageKey(weekKey, position),
      JSON.stringify(next),
    );
  }

  return next;
}

export function clearRankingState(weekKey: string, position: Position) {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(rankingStorageKey(weekKey, position));
    window.localStorage.removeItem(contestModeStorageKey(weekKey, position));
  }
}

export function loadContestMode(
  weekKey: string,
  position: Position,
): ContestMode {
  if (typeof window === "undefined") return "open";

  try {
    const raw = window.localStorage.getItem(
      contestModeStorageKey(weekKey, position),
    );
    if (raw === "open" || raw === "locked" || raw === "final") return raw;
  } catch {
    // ignore
  }
  return "open";
}

export function saveContestMode(
  weekKey: string,
  position: Position,
  mode: ContestMode,
) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(contestModeStorageKey(weekKey, position), mode);
  }
}
