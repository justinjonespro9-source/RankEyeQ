import { detectSnapshotCanonicalConflicts, type SnapshotCanonicalConflict } from "@/lib/waivers/canonical/policy";
import type { PreflightRow, PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";

/**
 * The players one contest must account for against a canonical artifact: every
 * eligible member of its pinned snapshot, then every player called on its
 * locked boards outside that pool. Shared by results intake and the grading
 * engine so both see the same members and the same D3 conflicts. Pure.
 */

export type WaiverContestMember = {
  category: "ELIGIBLE_POOL_MEMBER" | "INVALIDATED_CALLED_PLAYER";
  /** The entry whose frozen identity and freeze facts the row uses. */
  entry: PreflightSnapshotEntry;
  /** The stored snapshotEntryId: the eligible entry, or the pinned entry of an invalidated player (null when absent). */
  snapshotEntryId: string | null;
  invalidationBasis: "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" | "ABSENT_FROM_PINNED_SNAPSHOT" | null;
  /** The distinct frozen entries the locked boards originally called (invalidated players only). */
  called: readonly PreflightSnapshotEntry[];
};

export type WaiverAmbiguousCalledPlayer = { rankableEntryId: string; identityCount: number; snapshotEntryId: string };

const isEligibleAt = (position: string) => (entry: PreflightSnapshotEntry) =>
  entry.position === position && entry.evidenceRole === "CANDIDATE" && entry.eligibility === "ELIGIBLE";
export const waiverMemberIdentity = (entry: PreflightSnapshotEntry) =>
  entry.frozenIdentity ?? { provider: entry.rankable.provider, externalId: entry.rankable.externalId };
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function collectWaiverContestMembers(input: {
  position: string;
  /** The contest's pinned snapshot, every entry (all positions and eligibilities). */
  snapshotEntries: readonly PreflightSnapshotEntry[];
  /** The snapshot entry of every call on the contest's locked revisions. */
  calledEntries: readonly PreflightSnapshotEntry[];
}): { eligible: PreflightSnapshotEntry[]; members: WaiverContestMember[]; ambiguous: WaiverAmbiguousCalledPlayer[] } {
  const eligible = input.snapshotEntries.filter(isEligibleAt(input.position)).sort((a, b) => byCodeUnit(a.snapshotEntryId, b.snapshotEntryId));
  const eligiblePlayers = new Set(eligible.map((entry) => entry.rankableEntryId));
  const pinnedByPlayer = new Map(input.snapshotEntries.map((entry) => [entry.rankableEntryId, entry]));
  const calledOutside = new Map<string, PreflightSnapshotEntry[]>();
  for (const entry of input.calledEntries) {
    if (eligiblePlayers.has(entry.rankableEntryId)) continue;
    const list = calledOutside.get(entry.rankableEntryId) ?? [];
    if (!list.some((e) => e.snapshotEntryId === entry.snapshotEntryId)) list.push(entry);
    calledOutside.set(entry.rankableEntryId, list);
  }
  const members: WaiverContestMember[] = eligible.map((entry) => ({
    category: "ELIGIBLE_POOL_MEMBER",
    entry,
    snapshotEntryId: entry.snapshotEntryId,
    invalidationBasis: null,
    called: [],
  }));
  const ambiguous: WaiverAmbiguousCalledPlayer[] = [];
  for (const [player, called] of [...calledOutside].sort(([a], [b]) => byCodeUnit(a, b))) {
    const pinned = pinnedByPlayer.get(player) ?? null;
    if (!pinned) {
      const identities = new Set(called.map((entry) => `${waiverMemberIdentity(entry).provider}\u0000${waiverMemberIdentity(entry).externalId}`));
      if (identities.size > 1) {
        ambiguous.push({ rankableEntryId: player, identityCount: identities.size, snapshotEntryId: called[0].snapshotEntryId });
        continue;
      }
    }
    const entry = pinned ?? [...called].sort((a, b) => byCodeUnit(a.snapshotEntryId, b.snapshotEntryId))[0];
    members.push({
      category: "INVALIDATED_CALLED_PLAYER",
      entry,
      snapshotEntryId: pinned?.snapshotEntryId ?? null,
      invalidationBasis: pinned ? "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" : "ABSENT_FROM_PINNED_SNAPSHOT",
      called: [...called].sort((a, b) => byCodeUnit(a.snapshotEntryId, b.snapshotEntryId)),
    });
  }
  return { eligible, members, ambiguous };
}

/**
 * D3 conflicts of a matched member. An invalidated player whose corrected pinned
 * entry is frozen on bye shows no conflict there, so a canonical BYE is looked up
 * on the scheduled entries the locked boards originally called; more than one
 * such entry is ambiguous. Every other row keeps its own entry's conflicts.
 */
export function waiverContestMemberConflicts(
  member: WaiverContestMember,
  row: PreflightRow,
  artifactContentChecksum: string,
): SnapshotCanonicalConflict[] | "AMBIGUOUS" {
  const canonical = row.canonical!;
  if (member.invalidationBasis !== "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" || canonical.cls !== "SNAPSHOT_CONFLICT" || row.conflicts.length > 0 || !member.entry.isByeAtFreeze) {
    return row.conflicts;
  }
  const original = member.called.flatMap((entry) =>
    detectSnapshotCanonicalConflicts({
      artifactContentChecksum,
      snapshotEntryId: entry.snapshotEntryId,
      snapshot: { isByeAtFreeze: entry.isByeAtFreeze, teamAtFreeze: entry.teamAtFreeze },
      canonical: { participantId: canonical.participantId, cls: canonical.cls, disposition: canonical.disposition, teamKey: canonical.teamKey },
    }).filter((conflict) => conflict.kind === "BYE_VS_SCHEDULED"),
  );
  return original.length > 1 ? "AMBIGUOUS" : original;
}
