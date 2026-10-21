import { describe, expect, it } from "vitest";
import { RQ_SNAPSHOT_ID, RQ_WEEK_ID, rqBuildInput, rqDecision, rqEntry, rqStat } from "@/lib/waivers/__fixtures__/rankeyeq-results";
import type { PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";
import { WAIVER_MAX_CALLS, WAIVER_POSITIONS, WAIVER_RESULT_FIELD_SIZE, type WaiverPosition } from "@/lib/waivers/constants";
import type { WaiverGradingBoardInput } from "@/lib/waivers/grading/board-grade";
import {
  buildWaiverContestResultFromRankEyeQ,
  rankEyeQGradingArtifact,
  type WaiverContestResultRankEyeQInput,
} from "@/lib/waivers/grading/contest-result-rankeyeq";
import type { WaiverContestResultBuild } from "@/lib/waivers/grading/contest-result";
import type { WaiverGradingIssueCode } from "@/lib/waivers/grading/model";
import { assembleWaiverWeekGrading } from "@/lib/waivers/grading/week";
import { assembleRankEyeQFinalWeekStatsContent, type RankEyeQBuildStatRow } from "@/lib/waivers/rankeyeq-results/build";
import { projectRankEyeQResultsSource, type VerifiedRankEyeQResultsSource } from "@/lib/waivers/rankeyeq-results/ledger";
import { applyParticipationDecisions } from "@/lib/waivers/rankeyeq-results/participation";
import type { RankEyeQParticipationDecisionInput } from "@/lib/waivers/rankeyeq-results/types";
import { verifyRankEyeQFinalWeekStatsSnapshot } from "@/lib/waivers/rankeyeq-results/verify";

/**
 * Pure fixtures for the RankEyeQ contest-result builder. The source is built
 * through the real pipeline (assemble → decisions → verify → project), so the
 * participant states are the ones production snapshots carry.
 */

type Ready = Extract<WaiverContestResultBuild, { status: "READY" }>;
const ENTRIES_FINGERPRINT = "f".repeat(64);

type SourceOptions = {
  playerStats?: RankEyeQBuildStatRow[];
  defenseStats?: RankEyeQBuildStatRow[];
  decisions?: RankEyeQParticipationDecisionInput[];
  calledEntries?: ReturnType<typeof rqEntry>[];
  snapshotEntries?: ReturnType<typeof rqEntry>[];
};

/** Resolved by default: q-pos 18.54, q-missing 3.2, q-zero PLAYED_ZERO, r-pos 12.3, d-kc 7.0, d-buf DID_NOT_PLAY. */
function makeSource(options: SourceOptions = {}): VerifiedRankEyeQResultsSource {
  const input = rqBuildInput({
    playerStats: options.playerStats ?? [rqStat("q-pos", 18.54), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("q-missing", 3.2), rqStat("r-pos", 12.3)],
    ...(options.defenseStats ? { defenseStats: options.defenseStats } : {}),
    ...(options.calledEntries ? { calledEntries: options.calledEntries } : {}),
  });
  const snapshot = options.snapshotEntries ? { ...input.snapshot!, entries: options.snapshotEntries } : input.snapshot!;
  const built = assembleRankEyeQFinalWeekStatsContent({ ...input, snapshot });
  if (!built.content) throw new Error(JSON.stringify(built.blockers));
  const decisions = options.decisions ?? [rqDecision("q-zero", "PLAYED_ZERO"), rqDecision("d-buf", "DID_NOT_PLAY")];
  const applied = applyParticipationDecisions(built.content, decisions);
  if (applied.rejected.length) throw new Error(JSON.stringify(applied.rejected));
  const verified = verifyRankEyeQFinalWeekStatsSnapshot(applied.content, { expectedWeekId: RQ_WEEK_ID });
  if (!verified.ok) throw new Error(JSON.stringify(verified.issues));
  return projectRankEyeQResultsSource(verified.verified, { snapshotRowId: "rq-row-1", revision: 1 });
}

/** The frozen entry the contest sees for a fixture entry (adds the live fields the preflight needs). */
function pool(...entries: ReturnType<typeof rqEntry>[]): PreflightSnapshotEntry[] {
  return entries.map((e) => ({
    snapshotEntryId: e.snapshotEntryId,
    rankableEntryId: e.rankableEntryId,
    position: e.position,
    evidenceRole: e.evidenceRole,
    eligibility: e.eligibility,
    displayNameAtFreeze: e.displayNameAtFreeze,
    teamAtFreeze: e.teamAtFreeze,
    isByeAtFreeze: false,
    frozenIdentity: e.frozenIdentity,
    rankable: { ...e.rankable, active: true, adminNotes: null, name: e.displayNameAtFreeze },
  }));
}

const QB_POOL = () => pool(rqEntry("q-pos", "QB"), rqEntry("q-zero", "QB", { nflGameId: "g2" }), rqEntry("q-missing", "QB"));

function contestInput(
  source: VerifiedRankEyeQResultsSource,
  entries: PreflightSnapshotEntry[] = QB_POOL(),
  options: { position?: WaiverPosition; called?: PreflightSnapshotEntry[]; weekId?: string; snapshotId?: string; entriesFingerprint?: string; checksum?: string } = {},
): WaiverContestResultRankEyeQInput {
  const position = options.position ?? "QB";
  return {
    position,
    contest: {
      id: `contest-${position}`,
      weekId: options.weekId ?? RQ_WEEK_ID,
      snapshotId: options.snapshotId ?? RQ_SNAPSHOT_ID,
      maxCalls: WAIVER_MAX_CALLS[position],
      resultFieldSize: WAIVER_RESULT_FIELD_SIZE[position],
    },
    snapshot: { season: 2026, weekNumber: 6, version: 2, entriesFingerprint: options.entriesFingerprint ?? ENTRIES_FINGERPRINT, entries },
    artifact: { ...rankEyeQGradingArtifact(source), ...(options.checksum ? { contentChecksum: options.checksum } : {}) },
    source,
    calledEntries: options.called ?? [],
  };
}

function ready(input: WaiverContestResultRankEyeQInput): Ready {
  const build = buildWaiverContestResultFromRankEyeQ(input);
  if (build.status !== "READY") throw new Error(JSON.stringify(build.issues));
  return build;
}

function blockedCodes(input: WaiverContestResultRankEyeQInput): WaiverGradingIssueCode[] {
  const build = buildWaiverContestResultFromRankEyeQ(input);
  expect(build.status).toBe("BLOCKED");
  return build.status === "BLOCKED" ? [...new Set(build.issues.map((i) => i.code))].sort() : [];
}

const rowOf = (build: Ready, rankableEntryId: string) => build.rows.find((r) => r.rankableEntryId === rankableEntryId)!;

describe("buildWaiverContestResultFromRankEyeQ", () => {
  describe("ranked scores and PARTICIPATED_ZERO", () => {
    const build = ready(contestInput(makeSource()));

    it("ranks participants over integer hundredths, a played zero last as a real 0", () => {
      expect(rowOf(build, "q-pos")).toMatchObject({ treatment: "RANKED", fpHundredths: 1854, waiverPoolRank: 1, canonicalPointsHundredths: 1854, participationState: "PARTICIPATED_WITH_STATS" });
      expect(rowOf(build, "q-missing")).toMatchObject({ treatment: "RANKED", fpHundredths: 320, waiverPoolRank: 2 });
      expect(rowOf(build, "q-zero")).toMatchObject({
        treatment: "RANKED",
        fpHundredths: 0,
        waiverPoolRank: 3,
        canonicalPointsHundredths: 0,
        canonicalPositionRank: 3,
        participationState: "PARTICIPATED_ZERO",
        participantDisposition: "PLAYED",
        canonicalClass: "RANKED",
      });
      expect(build.result).toMatchObject({ eligiblePoolSize: 3, effectivePoolSize: 3, invalidatedCalledCount: 0, effectiveAvailableSlots: 3 });
      expect(build.appliedResolutions).toEqual([]);
      expect(build.honorScoreableSlots).toBe(3);
    });

    it("uses stable RankEyeQ ids, not SNG ones, in the engine's participant columns", () => {
      const row = rowOf(build, "q-pos");
      expect(row.sngParticipantId).toBe("rankeyeq:q-pos");
      expect(row.sngResultFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(row.identityProvider).toBe("nflcom-bootstrap");
      expect(row.identityExternalId).toBe("nfl-q-pos");
      expect(row.meta).toMatchObject({ displayName: "Name q-pos", sngPosition: "QB", resolution: null });
      expect(build.result.sngResultSetChecksum).toMatch(/^[a-f0-9]{64}$/);
      for (const r of build.rows) expect(r.rowFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it("maps the snapshot provenance to the result's artifact identity", () => {
      const source = makeSource();
      expect(rankEyeQGradingArtifact(source)).toEqual({
        rowId: "rq-row-1",
        artifactId: `rankeyeq-final-week-stats:${source.contentChecksum}`,
        seriesKey: source.seriesKey,
        revision: 1,
        contentChecksum: source.contentChecksum,
      });
      expect(build.result).toMatchObject({ artifactRowId: "rq-row-1", artifactContentChecksum: source.contentChecksum, snapshotId: RQ_SNAPSHOT_ID, weekId: RQ_WEEK_ID, position: "QB" });
      expect(build.result.resolutionSetFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("DNP", () => {
    const source = makeSource({ decisions: [rqDecision("q-zero", "DID_NOT_PLAY"), rqDecision("d-buf", "DID_NOT_PLAY")] });
    const build = ready(contestInput(source));

    it("scores a verified non-participant as NON_PARTICIPANT_ZERO outside the ranking", () => {
      expect(rowOf(build, "q-zero")).toMatchObject({
        treatment: "NON_PARTICIPANT_ZERO",
        fpHundredths: 0,
        waiverPoolRank: null,
        canonicalClass: "NON_PARTICIPANT",
        participationState: "VERIFIED_NON_PARTICIPANT",
        participantDisposition: "DNP",
        canonicalPointsHundredths: null,
        canonicalPositionRank: null,
        sngResultFingerprint: null,
      });
      expect(build.result).toMatchObject({ eligiblePoolSize: 3, effectivePoolSize: 2, effectiveFieldSize: 2 });
      expect(rowOf(build, "q-pos").waiverPoolRank).toBe(1);
      expect(rowOf(build, "q-missing").waiverPoolRank).toBe(2);
    });

    it("is not interchangeable with a played zero: the result fingerprints differ", () => {
      const played = ready(contestInput(makeSource()));
      expect(build.result.resultFingerprint).not.toBe(played.result.resultFingerprint);
      expect(build.result.sourceFingerprint).not.toBe(played.result.sourceFingerprint);
    });
  });

  describe("ties", () => {
    it("assigns shared competition ranks (1, 1, 3) with exact integer equality", () => {
      const source = makeSource({ playerStats: [rqStat("q-pos", 10.5), rqStat("q-missing", 10.5), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("r-pos", 12.3)] });
      const build = ready(contestInput(source));
      expect(rowOf(build, "q-pos").waiverPoolRank).toBe(1);
      expect(rowOf(build, "q-missing").waiverPoolRank).toBe(1);
      expect(rowOf(build, "q-zero").waiverPoolRank).toBe(3);
      expect(rowOf(build, "q-pos").canonicalPositionRank).toBe(1);
      expect(rowOf(build, "q-zero").canonicalPositionRank).toBe(3);
    });

    it("ranks negative points below a played zero", () => {
      const source = makeSource({ playerStats: [rqStat("q-pos", 5), rqStat("q-missing", -1.5), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("r-pos", 12.3)] });
      const build = ready(contestInput(source));
      expect([rowOf(build, "q-pos"), rowOf(build, "q-zero"), rowOf(build, "q-missing")].map((r) => r.waiverPoolRank)).toEqual([1, 2, 3]);
      expect(rowOf(build, "q-missing").fpHundredths).toBe(-150);
    });

    it("is independent of pool and source ordering", () => {
      const source = makeSource();
      const a = ready(contestInput(source, QB_POOL()));
      const b = ready(contestInput(source, [...QB_POOL()].reverse()));
      expect(b.result.resultFingerprint).toBe(a.result.resultFingerprint);
      expect(b.result.inputFingerprint).toBe(a.result.inputFingerprint);
      expect(b.result.sourceFingerprint).toBe(a.result.sourceFingerprint);
    });
  });

  describe("blockers", () => {
    it("blocks a pool member missing from the ledger with PARTICIPANT_NOT_IN_LEDGER and builds nothing", () => {
      const entries = [...QB_POOL(), ...pool(rqEntry("q-extra", "QB"))];
      const build = buildWaiverContestResultFromRankEyeQ(contestInput(makeSource(), entries));
      expect(build.status).toBe("BLOCKED");
      if (build.status !== "BLOCKED") return;
      expect(build.issues).toEqual([expect.objectContaining({ code: "PARTICIPANT_NOT_IN_LEDGER", position: "QB", snapshotEntryId: "se-q-extra" })]);
    });

    it("blocks (never guesses) when the identity provider, DEF identity or rankableEntryId disagrees", () => {
      const source = makeSource();
      const provider = pool(rqEntry("q-pos", "QB", { frozenIdentity: { provider: "mock", externalId: "nfl-q-pos" } }));
      provider[0].rankable = { ...provider[0].rankable, provider: "mock" };
      expect(blockedCodes(contestInput(source, provider))).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);

      const def = pool(rqEntry("d-kc", "DEF", { team: "KC", externalId: "def-WAS" }));
      expect(blockedCodes(contestInput(source, def, { position: "DEF" }))).toEqual(["DEF_IDENTITY_MALFORMED"]);

      // Same frozen identity, different RankableEntry: the ledger participant belongs to q-pos.
      const reassigned = pool({ ...rqEntry("q-other", "QB"), frozenIdentity: { provider: "nflcom-bootstrap", externalId: "nfl-q-pos" }, rankable: { provider: "nflcom-bootstrap", externalId: "nfl-q-pos", team: "KC" } });
      expect(blockedCodes(contestInput(source, reassigned))).toEqual(["RANKABLE_ENTRY_MISMATCH"]);
    });

    it("blocks a frozen identity that drifted from the live RankableEntry", () => {
      const drifted = pool(rqEntry("q-pos", "QB"));
      drifted[0].rankable = { ...drifted[0].rankable, externalId: "nfl-reassigned" };
      expect(blockedCodes(contestInput(makeSource(), drifted))).toEqual(["FROZEN_IDENTITY_MISMATCH"]);
    });

    it("blocks a source that is not this contest's week or pinned snapshot", () => {
      const source = makeSource();
      expect(blockedCodes(contestInput(source, QB_POOL(), { weekId: "week-5" }))).toEqual(["SOURCE_WEEK_MISMATCH"]);
      expect(blockedCodes(contestInput(source, QB_POOL(), { snapshotId: "snap-0" }))).toEqual(["SOURCE_SNAPSHOT_MISMATCH"]);
      expect(blockedCodes(contestInput(source, QB_POOL(), { entriesFingerprint: "0".repeat(64) }))).toEqual(["SOURCE_SNAPSHOT_MISMATCH"]);
    });

    it("blocks when the artifact row checksum is not the verified source's", () => {
      expect(blockedCodes(contestInput(makeSource(), QB_POOL(), { checksum: "0".repeat(64) }))).toEqual(["ARTIFACT_CONTENT_INVALID"]);
    });

    it("blocks an incoherent participant instead of ranking it", () => {
      const source = makeSource();
      const broken: VerifiedRankEyeQResultsSource = {
        ...source,
        participants: source.participants.map((p) => (p.rankableEntryId === "q-pos" ? { ...p, disposition: "DNP" as const } : p)),
      };
      const rebuilt: VerifiedRankEyeQResultsSource = { ...broken, ledger: new Map([...source.ledger].map(([k, v]) => [k, v.map((p) => broken.participants.find((b) => b.rankableEntryId === p.rankableEntryId)!)])) };
      expect(blockedCodes(contestInput(rebuilt))).toEqual(["CANONICAL_RESULT_BLOCKED"]);
    });

    it("blocks a duplicate ledger match", () => {
      const source = makeSource();
      const dup = source.participants.find((p) => p.rankableEntryId === "q-pos")!;
      const withDup: VerifiedRankEyeQResultsSource = { ...source, ledger: new Map([...source.ledger, ["nflcom-bootstrap\u0000nfl-q-pos", [dup, dup]]]) };
      expect(blockedCodes(contestInput(withDup, pool(rqEntry("q-pos", "QB"))))).toContain("DUPLICATE_LEDGER_MATCH");
    });
  });

  describe("called players outside the eligible pool", () => {
    const calledGone = pool(rqEntry("q-gone", "QB", { snapshotEntryId: "se-older-q-gone" }))[0];
    const sourceWithGone = () =>
      makeSource({
        calledEntries: [rqEntry("q-gone", "QB", { snapshotEntryId: "se-older-q-gone" })],
        playerStats: [rqStat("q-pos", 18.54), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("q-missing", 3.2), rqStat("r-pos", 12.3), rqStat("q-gone", 20)],
      });

    it("treats a ledger-matched called player absent from the snapshot as INVALIDATED_PRE_LOCK, unranked", () => {
      const build = ready(contestInput(sourceWithGone(), QB_POOL(), { called: [calledGone] }));
      expect(rowOf(build, "q-gone")).toMatchObject({
        category: "INVALIDATED_CALLED_PLAYER",
        treatment: "INVALIDATED_PRE_LOCK",
        snapshotEntryId: null,
        invalidationBasis: "ABSENT_FROM_PINNED_SNAPSHOT",
        invalidatedBySnapshotId: RQ_SNAPSHOT_ID,
        fpHundredths: 0,
        waiverPoolRank: null,
        // Their real score still ranks among all RankEyeQ participants, but never in the waiver pool.
        canonicalPointsHundredths: 2000,
        canonicalPositionRank: 1,
      });
      expect(build.result).toMatchObject({ eligiblePoolSize: 3, effectivePoolSize: 3, invalidatedCalledCount: 1 });
      expect(rowOf(build, "q-pos").waiverPoolRank).toBe(1);
    });

    it("uses the pinned entry for a called player the snapshot kept as ineligible", () => {
      const source = makeSource({
        calledEntries: [rqEntry("q-out", "QB", { snapshotEntryId: "se-older-q-out" })],
        snapshotEntries: [...rqBuildInput().snapshot!.entries, rqEntry("q-out", "QB", { eligibility: "EXCLUDED" })],
        playerStats: [rqStat("q-pos", 18.54), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("q-missing", 3.2), rqStat("r-pos", 12.3), rqStat("q-out", 4)],
      });
      const entries = [...QB_POOL(), ...pool(rqEntry("q-out", "QB", { eligibility: "EXCLUDED" }))];
      const build = ready(contestInput(source, entries, { called: pool(rqEntry("q-out", "QB", { snapshotEntryId: "se-older-q-out" })) }));
      expect(rowOf(build, "q-out")).toMatchObject({ category: "INVALIDATED_CALLED_PLAYER", snapshotEntryId: "se-q-out", invalidationBasis: "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT", treatment: "INVALIDATED_PRE_LOCK" });
    });

    it("blocks a called player the RankEyeQ snapshot does not contain (it predates the locked call)", () => {
      const codes = blockedCodes(contestInput(makeSource(), QB_POOL(), { called: [calledGone] }));
      expect(codes).toEqual(["PARTICIPANT_NOT_IN_LEDGER"]);
    });

    it("blocks a player called under two different frozen identities", () => {
      const a = pool(rqEntry("q-two", "QB", { snapshotEntryId: "se-a", externalId: "nfl-one" }))[0];
      const b = pool(rqEntry("q-two", "QB", { snapshotEntryId: "se-b", externalId: "nfl-two" }))[0];
      expect(blockedCodes(contestInput(makeSource(), QB_POOL(), { called: [a, b] }))).toEqual(["CALLED_IDENTITY_AMBIGUOUS"]);
    });
  });

  it("surfaces a position difference as an advisory, never a blocker", () => {
    const source = makeSource();
    const build = ready(contestInput(source, pool(rqEntry("r-pos", "WR")), { position: "WR" }));
    expect(build.advisories.map((a) => a.code)).toContain("CANONICAL_POSITION_DIFFERS");
  });

  it("flags live-identity rows frozen before the identity key as an advisory only", () => {
    const entries = pool(rqEntry("q-pos", "QB", { frozenIdentity: null }));
    const build = ready(contestInput(makeSource(), entries));
    expect(build.advisories.map((a) => a.code)).toContain("IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT");
  });

  it("changes the input and result fingerprints when points change, and the source fingerprint tracks the source", () => {
    const a = ready(contestInput(makeSource()));
    const b = ready(contestInput(makeSource({ playerStats: [rqStat("q-pos", 18.55), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("q-missing", 3.2), rqStat("r-pos", 12.3)] })));
    expect(b.result.inputFingerprint).not.toBe(a.result.inputFingerprint);
    expect(b.result.resultFingerprint).not.toBe(a.result.resultFingerprint);
    expect(b.result.sourceFingerprint).not.toBe(a.result.sourceFingerprint);
  });

  describe("through the week engine", () => {
    it("grades a locked board from a RankEyeQ contest result (READY) and blocks the week without one", () => {
      const source = makeSource();
      const build = ready(contestInput(source));
      const board: WaiverGradingBoardInput = {
        submissionId: "sub-1",
        revisionId: "rev-1",
        revisionFingerprint: "rev-fp-1",
        revisionKind: "SUBMISSION",
        revisionCallCount: 3,
        competitor: { universalProfileId: "profile-1", profileType: "HUMAN", competitorActive: true, authority: "HUMAN_OWNER", entryBasis: "STANDARD" },
        calls: [
          { callId: "call-1", slot: 1, snapshotEntryId: "se-q-pos", rankableEntryId: "q-pos" },
          { callId: "call-2", slot: 2, snapshotEntryId: "se-q-missing", rankableEntryId: "q-missing" },
          { callId: "call-3", slot: 3, snapshotEntryId: "se-q-zero", rankableEntryId: "q-zero" },
        ],
      };
      const artifact = rankEyeQGradingArtifact(source);
      const positions = WAIVER_POSITIONS.map((position) =>
        position === "QB"
          ? { position, kind: "CONTEST" as const, contestId: "contest-QB", build, boards: [board] }
          : { position, kind: "EMPTY" as const, snapshotId: RQ_SNAPSHOT_ID, snapshotFingerprint: `snapshot-fp-${position}` },
      );
      const preview = assembleWaiverWeekGrading({ week: { id: RQ_WEEK_ID, season: 2026, weekNumber: 6 }, artifact, positions, issues: [], advisories: [] });
      expect(preview.issues).toEqual([]);
      expect(preview.status).toBe("READY");
      expect(preview.run?.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(preview.artifact).toMatchObject({ rowId: "rq-row-1", artifactId: `rankeyeq-final-week-stats:${source.contentChecksum}` });
      // The board called the exact top three (slot = rank) of a three-player pool: all exact.
      expect(preview.boards[0].board).toMatchObject({ resultKind: "SCORED", exactCallCount: 3, submittedCallCount: 3 });
      expect(preview.boards[0].calls.map((c) => c.outcome)).toEqual(["EXACT", "EXACT", "EXACT"]);
      const rerun = assembleWaiverWeekGrading({ week: { id: RQ_WEEK_ID, season: 2026, weekNumber: 6 }, artifact, positions, issues: [], advisories: [] });
      expect(rerun.run).toEqual(preview.run);

      const blocked = buildWaiverContestResultFromRankEyeQ(contestInput(source, [...QB_POOL(), ...pool(rqEntry("q-extra", "QB"))]));
      const blockedWeek = assembleWaiverWeekGrading({
        week: { id: RQ_WEEK_ID, season: 2026, weekNumber: 6 },
        artifact,
        positions: positions.map((p) => (p.position === "QB" ? { ...p, build: blocked } : p)),
        issues: [],
        advisories: [],
      });
      expect(blockedWeek.status).toBe("BLOCKED");
      expect(blockedWeek.run).toBeNull();
      expect(blockedWeek.issues.map((i) => i.code)).toContain("PARTICIPANT_NOT_IN_LEDGER");
    });
  });
});
