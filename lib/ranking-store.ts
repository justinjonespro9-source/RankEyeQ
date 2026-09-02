import {
  clearRankingState as clearStored,
  createEmptyRankingState,
  loadContestMode as readContestMode,
  loadRankingState as readRankingState,
  saveContestMode as writeContestMode,
  saveRankingState as writeRankingState,
} from "@/lib/ranking-storage";
import type {
  ContestMode,
  Position,
  StoredRankingState,
} from "@/types/contest";

type Listener = () => void;

const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeRankingStore(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRankingSnapshot(
  weekKey: string,
  position: Position,
  slotCount: number,
): StoredRankingState {
  return readRankingState(weekKey, position, slotCount);
}

export function getRankingServerSnapshot(slotCount: number): StoredRankingState {
  return createEmptyRankingState(slotCount);
}

export function getContestModeSnapshot(
  weekKey: string,
  position: Position,
): ContestMode {
  return readContestMode(weekKey, position);
}

export function getContestModeServerSnapshot(): ContestMode {
  return "open";
}

export function commitRankingState(
  weekKey: string,
  position: Position,
  state: StoredRankingState,
): StoredRankingState {
  const saved = writeRankingState(weekKey, position, state);
  emit();
  return saved;
}

export function commitContestMode(
  weekKey: string,
  position: Position,
  mode: ContestMode,
) {
  writeContestMode(weekKey, position, mode);
  emit();
}

export function resetMockContest(weekKey: string, position: Position) {
  clearStored(weekKey, position);
  emit();
}
