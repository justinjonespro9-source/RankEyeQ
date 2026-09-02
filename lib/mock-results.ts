import type { RankingPlayer } from "@/types/contest";

/** Deterministic mock actual finishes for prototype results view. */
function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Assigns a stable mock finishing order for the full player pool.
 * Lower finish number = better fantasy finish.
 */
export function getMockActualFinishes(
  players: RankingPlayer[],
): Map<string, number> {
  const ranked = [...players].sort((a, b) => {
    const scoreA = hashId(a.id) % 10_000;
    const scoreB = hashId(b.id) % 10_000;
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.name.localeCompare(b.name);
  });

  const finishes = new Map<string, number>();
  ranked.forEach((player, index) => {
    finishes.set(player.id, index + 1);
  });
  return finishes;
}
