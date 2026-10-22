import { RANKEYEQ_IDENTITY_PROVIDER } from "@/lib/waivers/rankeyeq-results/contract";

/**
 * Audited RankEyeQ-results identity aliases.
 *
 * Historical WaiverSnapshotEntry / RankableEntry identity stamps stay unchanged.
 * Results snapshot participants and ledger matching may resolve a frozen
 * non-contract identity onto the contract namespace (`nflcom-bootstrap`) when an
 * ACTIVE registry entry matches exactly (rankableEntryId + from provider/externalId).
 *
 * WeekStat matching remains by `rankableEntryId` only. WAIVER_EYEQ_V1 scoring is
 * untouched. Superseded or invalid entries reject resolution (never silent).
 */

export const RANKEYEQ_IDENTITY_ALIAS_REGISTRY_VERSION = "rankeyeq-identity-alias/1";

export type RankEyeQIdentityAliasStatus = "ACTIVE" | "SUPERSEDED" | "INVALID";

export type RankEyeQIdentityAliasEntry = {
  /** Stable audit id; cited in participant evidence and sourceReference. */
  id: string;
  status: RankEyeQIdentityAliasStatus;
  /** Exact RankableEntry primary key this alias may rewrite. */
  rankableEntryId: string;
  from: { provider: string; externalId: string };
  to: { provider: typeof RANKEYEQ_IDENTITY_PROVIDER; externalId: string };
  reason: string;
  /**
   * When non-null, the alias applies only for these Week ids. `null` means every
   * week that freezes the same rankableEntryId + from identity.
   */
  weekIds: readonly string[] | null;
  approvedAt: string;
};

/**
 * Narrow Production-facing registry. Add entries only with owner review.
 * Do not invent mappings from abbreviated names.
 */
export const RANKEYEQ_IDENTITY_ALIAS_REGISTRY: readonly RankEyeQIdentityAliasEntry[] = [
  {
    id: "ekeler-manual-to-austin-ekeler",
    status: "ACTIVE",
    rankableEntryId: "cmv7hvah3000006jsasy6xvkc",
    from: { provider: "manual", externalId: "manual-austin-ekeler-was-rb-mv7hvagx" },
    to: { provider: RANKEYEQ_IDENTITY_PROVIDER, externalId: "austin-ekeler" },
    reason:
      "Week 6 WaiverEyeQ freeze used a manual RankableEntry created for waivers identity; " +
      "NFL.com verified slug is austin-ekeler. Results snapshot requires nflcom-bootstrap without " +
      "mutating RankableEntry, frozen stamps, Yahoo ownership fingerprint, or WeekStat components.",
    // Scoped to the single known historical row; null weekIds so any week that
    // freezes this exact entry+identity remounts the same audited mapping.
    weekIds: null,
    approvedAt: "2026-10-22T00:00:00.000Z",
  },
];

export type RankEyeQHistoricalIdentity = { provider: string; externalId: string };

export type RankEyeQIdentityAliasResolution =
  | { kind: "none"; identity: RankEyeQHistoricalIdentity }
  | {
      kind: "applied";
      identity: RankEyeQHistoricalIdentity;
      historical: RankEyeQHistoricalIdentity;
      alias: RankEyeQIdentityAliasEntry;
    }
  | {
      kind: "rejected";
      identity: RankEyeQHistoricalIdentity;
      code: "ALIAS_SUPERSEDED" | "ALIAS_INVALID" | "ALIAS_AMBIGUOUS" | "ALIAS_TARGET_NOT_CONTRACT";
      detail: string;
      aliasIds: readonly string[];
    };

function matchesScope(entry: RankEyeQIdentityAliasEntry, weekId: string | null): boolean {
  if (entry.weekIds === null) return true;
  if (weekId === null) return false;
  return entry.weekIds.includes(weekId);
}

function matchesFrom(entry: RankEyeQIdentityAliasEntry, historical: RankEyeQHistoricalIdentity, rankableEntryId: string): boolean {
  return (
    entry.rankableEntryId === rankableEntryId &&
    entry.from.provider === historical.provider &&
    entry.from.externalId === historical.externalId
  );
}

/**
 * Resolves a historical (usually frozen) identity for RankEyeQ results build and
 * ledger matching. Never invents a match from display names.
 */
export function resolveRankEyeQResultsIdentityAlias(input: {
  rankableEntryId: string;
  historical: RankEyeQHistoricalIdentity;
  weekId?: string | null;
  registry?: readonly RankEyeQIdentityAliasEntry[];
}): RankEyeQIdentityAliasResolution {
  const registry = input.registry ?? RANKEYEQ_IDENTITY_ALIAS_REGISTRY;
  const weekId = input.weekId ?? null;
  const candidates = registry.filter((entry) => matchesFrom(entry, input.historical, input.rankableEntryId) && matchesScope(entry, weekId));

  if (candidates.length === 0) {
    return { kind: "none", identity: input.historical };
  }

  if (candidates.length > 1) {
    const ids = candidates.map((entry) => entry.id).sort();
    return {
      kind: "rejected",
      identity: input.historical,
      code: "ALIAS_AMBIGUOUS",
      detail: `${input.rankableEntryId}: ${candidates.length} identity aliases match (${ids.join(", ")})`,
      aliasIds: ids,
    };
  }

  const [alias] = candidates;
  if (alias.status === "SUPERSEDED") {
    return {
      kind: "rejected",
      identity: input.historical,
      code: "ALIAS_SUPERSEDED",
      detail: `${input.rankableEntryId}: identity alias ${alias.id} is SUPERSEDED and cannot be applied`,
      aliasIds: [alias.id],
    };
  }
  if (alias.status === "INVALID") {
    return {
      kind: "rejected",
      identity: input.historical,
      code: "ALIAS_INVALID",
      detail: `${input.rankableEntryId}: identity alias ${alias.id} is INVALID and cannot be applied`,
      aliasIds: [alias.id],
    };
  }
  if (alias.to.provider !== RANKEYEQ_IDENTITY_PROVIDER) {
    return {
      kind: "rejected",
      identity: input.historical,
      code: "ALIAS_TARGET_NOT_CONTRACT",
      detail: `${input.rankableEntryId}: identity alias ${alias.id} target provider ${alias.to.provider} is not ${RANKEYEQ_IDENTITY_PROVIDER}`,
      aliasIds: [alias.id],
    };
  }

  return {
    kind: "applied",
    historical: input.historical,
    identity: { provider: alias.to.provider, externalId: alias.to.externalId },
    alias,
  };
}

export type RankEyeQIdentityAliasAppliedFact = {
  aliasId: string;
  rankableEntryId: string;
  from: RankEyeQHistoricalIdentity;
  to: RankEyeQHistoricalIdentity;
};

/** Builds the advisory detail recorded on participant evidence (and parseable later). */
export function formatRankEyeQIdentityAliasAppliedDetail(input: {
  label: string;
  alias: RankEyeQIdentityAliasEntry;
  historical: RankEyeQHistoricalIdentity;
  canonical: RankEyeQHistoricalIdentity;
}): string {
  return (
    `${input.label}: alias ${input.alias.id} remapped ` +
    `${input.historical.provider}:${input.historical.externalId} → ` +
    `${input.canonical.provider}:${input.canonical.externalId} ` +
    `(${input.alias.reason})`
  );
}

const APPLIED_DETAIL_RE =
  /: alias ([^ ]+) remapped ([^:]+):([^\s]+) → ([^:]+):([^\s]+) /;

/** Recovers structured alias facts from participant evidence issues. */
export function collectRankEyeQIdentityAliasesApplied(
  participants: readonly {
    rankableEntryId: string;
    evidence: { issues: readonly { code: string; detail: string }[] };
  }[],
): RankEyeQIdentityAliasAppliedFact[] {
  const out: RankEyeQIdentityAliasAppliedFact[] = [];
  for (const participant of participants) {
    for (const issue of participant.evidence.issues) {
      if (issue.code !== "IDENTITY_ALIAS_APPLIED") continue;
      const match = APPLIED_DETAIL_RE.exec(issue.detail);
      if (!match) continue;
      out.push({
        aliasId: match[1],
        rankableEntryId: participant.rankableEntryId,
        from: { provider: match[2], externalId: match[3] },
        to: { provider: match[4], externalId: match[5] },
      });
    }
  }
  return out.sort((a, b) => (a.aliasId < b.aliasId ? -1 : a.aliasId > b.aliasId ? 1 : a.rankableEntryId < b.rankableEntryId ? -1 : 1));
}

/** Compact citation for commit sourceReference / audit metadata. */
export function formatRankEyeQIdentityAliasCitation(applied: readonly RankEyeQIdentityAliasAppliedFact[]): string {
  if (applied.length === 0) return `${RANKEYEQ_IDENTITY_ALIAS_REGISTRY_VERSION}:none`;
  const parts = applied.map((row) => `${row.aliasId}:${row.from.provider}/${row.from.externalId}->${row.to.provider}/${row.to.externalId}`);
  return `${RANKEYEQ_IDENTITY_ALIAS_REGISTRY_VERSION}:${parts.join(";")}`;
}
