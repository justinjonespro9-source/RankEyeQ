/**
 * How the public "All" consensus segment is composed.
 *
 * - ballot_union: every eligible HUMAN + AI ballot counts equally (legacy).
 *   Expert ballots are excluded. Selected % and Avg Selected Rank use raw ballot
 *   counts across Human + AI only.
 *
 * - group_weighted (default): Human, Expert, and AI segment outputs are merged
 *   with equal weight per non-empty group (option B). Empty groups are skipped.
 *
 * Group-weighted All metrics per player:
 *   All Selected % = mean(segment Selected %) across represented groups
 *   All Avg Selected Rank = mean(segment Avg Selected Rank) across groups that
 *     ranked the player (groups with null avg are omitted from that player's mean)
 *
 * Configure with RANKEYEQ_CONSENSUS_ALL_MODE (preferred) or legacy RANKEQ_CONSENSUS_ALL_MODE.
 */
export type ConsensusAllMode = "ballot_union" | "group_weighted";

const DEFAULT_MODE: ConsensusAllMode = "group_weighted";

export function getConsensusAllMode(): ConsensusAllMode {
  const raw =
    process.env.RANKEYEQ_CONSENSUS_ALL_MODE?.trim().toLowerCase() ??
    process.env.RANKEQ_CONSENSUS_ALL_MODE?.trim().toLowerCase();
  if (raw === "ballot_union" || raw === "legacy") return "ballot_union";
  if (raw === "group_weighted" || raw === "group") return "group_weighted";
  return DEFAULT_MODE;
}

export function describeConsensusAllMode(mode: ConsensusAllMode): string {
  if (mode === "ballot_union") {
    return "All = unweighted union of every eligible Human and AI ballot. Expert sources are excluded.";
  }
  return "All = equally weighted blend of Human, Expert, and AI group consensus (empty groups skipped).";
}
