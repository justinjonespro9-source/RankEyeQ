import {
  assembleRankEyeQFinalWeekStatsContent,
  type RankEyeQBuildSnapshotEntry,
  type RankEyeQBuildStatRow,
  type RankEyeQFinalWeekStatsBuildInput,
} from "@/lib/waivers/rankeyeq-results/build";
import { applyParticipationDecisions } from "@/lib/waivers/rankeyeq-results/participation";
import type { RankEyeQFinalWeekStatsContent, RankEyeQParticipationDecisionInput } from "@/lib/waivers/rankeyeq-results/types";

/**
 * Pure synthetic fixtures for the RankEyeQ final-week-stats source (no DB).
 * Mock WeekStat rows only; never historical evidence.
 */

export const RQ_WEEK_ID = "week-6";
export const RQ_SNAPSHOT_ID = "snap-1";

export function rqEntry(
  rankableEntryId: string,
  position: string,
  overrides: Partial<RankEyeQBuildSnapshotEntry> & { team?: string; externalId?: string } = {},
): RankEyeQBuildSnapshotEntry {
  const team = overrides.team ?? "KC";
  const externalId = overrides.externalId ?? (position === "DEF" ? `def-${team}` : `nfl-${rankableEntryId}`);
  return {
    snapshotEntryId: `se-${rankableEntryId}`,
    rankableEntryId,
    position,
    evidenceRole: "CANDIDATE",
    eligibility: "ELIGIBLE",
    displayNameAtFreeze: `Name ${rankableEntryId}`,
    teamAtFreeze: team,
    nflGameId: "g1",
    frozenIdentity: { provider: "nflcom-bootstrap", externalId },
    rankable: { provider: "nflcom-bootstrap", externalId, team },
    ...overrides,
  };
}

export function rqStat(rankableEntryId: string | null, fantasyPoints: number, overrides: Partial<RankEyeQBuildStatRow> = {}): RankEyeQBuildStatRow {
  return {
    id: `stat-${rankableEntryId ?? "none"}-${fantasyPoints}`,
    provider: "manual",
    weekId: RQ_WEEK_ID,
    rankableEntryId,
    gameId: "g1",
    scoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
    fantasyPoints,
    isProvisional: false,
    ...overrides,
  };
}

/**
 * Pool: QB q-pos (18.54), q-zero (0), q-missing (no stat); RB r-pos (12.3);
 * DEF d-kc (7), d-buf (0, def-BUF). One locked QB contest on the snapshot.
 */
export function rqBuildInput(overrides: Partial<RankEyeQFinalWeekStatsBuildInput> = {}): RankEyeQFinalWeekStatsBuildInput {
  return {
    week: { id: RQ_WEEK_ID, seasonYear: 2026, weekNumber: 6, status: "COMPLETE", fantasyScoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2" },
    games: [
      { id: "g1", status: "FINAL" },
      { id: "g2", status: "FINAL" },
      { id: "g3", status: "CANCELED" },
    ],
    snapshot: {
      id: RQ_SNAPSHOT_ID,
      version: 2,
      status: "FROZEN",
      currentForWeekId: RQ_WEEK_ID,
      entriesFingerprint: "f".repeat(64),
      entries: [
        rqEntry("q-pos", "QB"),
        rqEntry("q-zero", "QB", { nflGameId: "g2" }),
        rqEntry("q-missing", "QB"),
        rqEntry("r-pos", "RB"),
        rqEntry("d-kc", "DEF", { team: "KC" }),
        rqEntry("d-buf", "DEF", { team: "BUF", nflGameId: "g2" }),
      ],
    },
    contests: [{ id: "c-qb", position: "QB", status: "LOCKED", snapshotId: RQ_SNAPSHOT_ID }],
    playerStats: [rqStat("q-pos", 18.54), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("r-pos", 12.3)],
    defenseStats: [rqStat("d-kc", 7), rqStat("d-buf", 0, { gameId: "g2" })],
    ...overrides,
  };
}

export function rqBuiltContent(overrides: Partial<RankEyeQFinalWeekStatsBuildInput> = {}): RankEyeQFinalWeekStatsContent {
  const build = assembleRankEyeQFinalWeekStatsContent(rqBuildInput(overrides));
  if (!build.content) throw new Error(`fixture build blocked: ${JSON.stringify(build.blockers)}`);
  return build.content;
}

export function rqDecision(
  rankableEntryId: string,
  decision: RankEyeQParticipationDecisionInput["decision"],
  overrides: Partial<RankEyeQParticipationDecisionInput> = {},
): RankEyeQParticipationDecisionInput {
  return {
    rankableEntryId,
    decision,
    evidenceReference: "https://example.test/boxscore/week6",
    reason: "Reviewed official box score and game book",
    decidedByUserId: "admin-1",
    decidedAt: "2026-10-20T15:00:00.000Z",
    ...overrides,
  };
}

/** The fixture content with every pending zero resolved: q-zero played zero, d-buf DNP; q-missing replaced by a real stat. */
export function rqResolvedContent(): RankEyeQFinalWeekStatsContent {
  const content = rqBuiltContent({ playerStats: [rqStat("q-pos", 18.54), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("q-missing", 3.2), rqStat("r-pos", 12.3)] });
  const { content: resolved, rejected } = applyParticipationDecisions(content, [rqDecision("q-zero", "PLAYED_ZERO"), rqDecision("d-buf", "DID_NOT_PLAY")]);
  if (rejected.length > 0) throw new Error(`fixture decisions rejected: ${JSON.stringify(rejected)}`);
  return resolved;
}
