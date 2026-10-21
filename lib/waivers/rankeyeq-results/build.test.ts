import { describe, expect, it } from "vitest";
import { RQ_WEEK_ID, rqBuildInput, rqEntry, rqStat } from "@/lib/waivers/__fixtures__/rankeyeq-results";
import {
  assembleRankEyeQFinalWeekStatsContent,
  buildRankEyeQFinalWeekStatsSnapshot,
  type RankEyeQFinalWeekStatsBuildInput,
} from "@/lib/waivers/rankeyeq-results/build";
import { rankEyeQContentChecksum } from "@/lib/waivers/rankeyeq-results/checksum";
import { verifyRankEyeQFinalWeekStatsSnapshot } from "@/lib/waivers/rankeyeq-results/verify";
import {
  RANKEYEQ_FANTASY_SCORING_VERSION,
  RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION,
  RANKEYEQ_RESULTS_AUTHORITY_BASIS,
  rankEyeQResultsSeriesKey,
} from "@/lib/waivers/rankeyeq-results/contract";

const build = (overrides: Partial<RankEyeQFinalWeekStatsBuildInput> = {}) => assembleRankEyeQFinalWeekStatsContent(rqBuildInput(overrides));
const participantsOf = (overrides: Partial<RankEyeQFinalWeekStatsBuildInput> = {}) => {
  const result = build(overrides);
  expect(result.blockers).toEqual([]);
  return new Map(result.content!.participants.map((p) => [p.rankableEntryId, p]));
};

describe("contract pins", () => {
  it("pins the schema, authority and scoring versions", () => {
    expect(RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION).toBe("rankeyeq-final-week-stats/1");
    expect(RANKEYEQ_RESULTS_AUTHORITY_BASIS).toBe("RANKEYEQ_OPERATOR_ATTESTED");
    expect(RANKEYEQ_FANTASY_SCORING_VERSION).toBe("FANTASYTRACK_NFL_HALF_PPR_V2");
    expect(rankEyeQResultsSeriesKey(2026, 6)).not.toMatch(/SNG/i);
  });
});

describe("assembleRankEyeQFinalWeekStatsContent", () => {
  it("builds pinned content with a deterministic checksum", () => {
    const result = build();
    expect(result.blockers).toEqual([]);
    const content = result.content!;
    expect(content.schemaVersion).toBe("rankeyeq-final-week-stats/1");
    expect(content.scoringVersion).toBe("FANTASYTRACK_NFL_HALF_PPR_V2");
    expect(content.rankingsWeekStatus).toBe("COMPLETE");
    expect(content.sourceWeekId).toBe(RQ_WEEK_ID);
    expect(content.statProvider).toBe("manual");
    expect(content.waiverSnapshot).toMatchObject({ id: "snap-1", version: 2 });
    expect(content.contests).toEqual([{ contestId: "c-qb", position: "QB", status: "LOCKED", snapshotId: "snap-1" }]);
    expect(result.contentChecksum).toBe(rankEyeQContentChecksum(content));
    expect(build().contentChecksum).toBe(result.contentChecksum);
  });

  it("classifies a positive fantasy-point line as PARTICIPATED_WITH_STATS / PLAYED in integer hundredths", () => {
    const p = participantsOf();
    expect(p.get("q-pos")).toMatchObject({
      participationState: "PARTICIPATED_WITH_STATS",
      disposition: "PLAYED",
      proof: "WEEK_STAT_LINE",
      pointsHundredths: 1854,
      kind: "PLAYER",
      provider: "nflcom-bootstrap",
      externalId: "nfl-q-pos",
      gameIds: ["g1"],
    });
    // 12.3 * 100 is not exactly 1230 in floating point; toFpHundredths absorbs the drift.
    expect(p.get("r-pos")?.pointsHundredths).toBe(1230);
    expect(p.get("q-pos")?.evidence).toMatchObject({ statTable: "PlayerWeekStat", statProvider: "manual", isProvisional: false, decision: null });
  });

  it("holds zero fantasy points as PENDING_ZERO_REVIEW and never infers DNP or a played zero", () => {
    const p = participantsOf();
    expect(p.get("q-zero")).toMatchObject({
      participationState: "PENDING_ZERO_REVIEW",
      disposition: "UNRESOLVED",
      proof: "NONE",
      pointsHundredths: null,
    });
    expect(p.get("d-buf")).toMatchObject({ participationState: "PENDING_ZERO_REVIEW", pointsHundredths: null });
  });

  it("treats a negative line as a played stat line, not a zero", () => {
    const p = participantsOf({ playerStats: [rqStat("q-pos", -1.5), rqStat("q-zero", 0), rqStat("r-pos", 12.3)] });
    expect(p.get("q-pos")).toMatchObject({ participationState: "PARTICIPATED_WITH_STATS", pointsHundredths: -150 });
  });

  it("blocks a missing WeekStat as ABSENT_UNRESOLVED, never zero", () => {
    const missing = participantsOf().get("q-missing")!;
    expect(missing).toMatchObject({ participationState: "ABSENT_UNRESOLVED", disposition: "UNRESOLVED", proof: "NONE", pointsHundredths: null });
    expect(missing.evidence.statRowId).toBeNull();
    expect(missing.evidence.issues.map((i) => i.code)).toEqual(["STAT_ROW_MISSING"]);
  });

  it("only reads provider=manual rows for the same week matched by rankableEntryId", () => {
    const p = participantsOf({
      playerStats: [
        rqStat("q-pos", 18.54),
        rqStat("q-missing", 9, { provider: "mock", id: "other-provider" }),
        rqStat("r-pos", 12.3, { weekId: "week-5", id: "other-week" }),
        // A row carrying the right numbers but no RankableEntry link is never matched (no name/externalPlayerId matching).
        rqStat(null, 20),
      ],
    });
    expect(p.get("q-missing")?.participationState).toBe("ABSENT_UNRESOLVED");
    expect(p.get("r-pos")?.participationState).toBe("ABSENT_UNRESOLVED");
  });

  it("reads DEF participants from DefenseWeekStat only", () => {
    const p = participantsOf({ playerStats: [rqStat("d-kc", 99), rqStat("q-pos", 18.54), rqStat("r-pos", 12.3)] });
    expect(p.get("d-kc")).toMatchObject({
      kind: "TEAM_DEFENSE",
      externalId: "def-KC",
      participationState: "PARTICIPATED_WITH_STATS",
      pointsHundredths: 700,
    });
    expect(p.get("d-kc")?.evidence.statTable).toBe("DefenseWeekStat");
  });

  it("flags provisional, wrong-scoring, duplicate and unrepresentable rows as unresolved", () => {
    const p = participantsOf({
      playerStats: [
        rqStat("q-pos", 18.54, { isProvisional: true }),
        rqStat("q-zero", 5, { scoringVersion: "OTHER_V1" }),
        rqStat("q-missing", 1, { id: "dup-a" }),
        rqStat("q-missing", 2, { id: "dup-b" }),
        rqStat("r-pos", 12.345),
      ],
    });
    expect(p.get("q-pos")?.evidence.issues.map((i) => i.code)).toEqual(["STAT_ROW_PROVISIONAL"]);
    expect(p.get("q-zero")?.evidence.issues.map((i) => i.code)).toEqual(["STAT_SCORING_VERSION_MISMATCH"]);
    expect(p.get("q-missing")?.evidence.issues.map((i) => i.code)).toEqual(["STAT_ROW_DUPLICATE"]);
    expect(p.get("r-pos")?.evidence.issues.map((i) => i.code)).toEqual(["FANTASY_POINTS_NOT_REPRESENTABLE"]);
    for (const id of ["q-pos", "q-zero", "q-missing", "r-pos"]) {
      expect(p.get(id)).toMatchObject({ participationState: "ABSENT_UNRESOLVED", pointsHundredths: null });
    }
  });

  it("requires every backing game to be FINAL (a CANCELED game cannot prove a line)", () => {
    const p = participantsOf({ playerStats: [rqStat("q-pos", 18.54, { gameId: "g3" }), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("r-pos", 12.3)] });
    expect(p.get("q-pos")?.participationState).toBe("ABSENT_UNRESOLVED");
    expect(p.get("q-pos")?.evidence.issues.map((i) => i.code)).toEqual(["GAME_NOT_FINAL"]);
    expect(p.get("q-pos")?.gameIds).toEqual(["g1", "g3"]);
  });

  it("flags a stat row whose game is unknown or absent", () => {
    const p = participantsOf({
      playerStats: [rqStat("q-pos", 18.54, { gameId: "g-unknown" }), rqStat("q-zero", 0, { gameId: "g2" }), rqStat("r-pos", 12.3)],
      snapshot: {
        ...rqBuildInput().snapshot!,
        entries: [rqEntry("q-pos", "QB", { nflGameId: null }), rqEntry("r-pos", "RB", { nflGameId: null }), rqEntry("q-zero", "QB")],
      },
    });
    expect(p.get("q-pos")?.evidence.issues.map((i) => i.code)).toEqual(["GAME_NOT_FINAL"]);
    expect(p.get("r-pos")?.evidence.issues.map((i) => i.code)).toEqual([]);
  });

  it("flags a stat line with no linked game at all", () => {
    const p = participantsOf({
      playerStats: [rqStat("q-pos", 18.54, { gameId: null }), rqStat("q-zero", 0), rqStat("r-pos", 12.3)],
      snapshot: { ...rqBuildInput().snapshot!, entries: [rqEntry("q-pos", "QB", { nflGameId: null })] },
    });
    expect(p.get("q-pos")?.evidence.issues.map((i) => i.code)).toEqual(["NO_GAME_LINKED"]);
    expect(p.get("q-pos")?.participationState).toBe("ABSENT_UNRESOLVED");
  });

  it("includes only eligible CANDIDATE entries", () => {
    const base = rqBuildInput().snapshot!;
    const p = participantsOf({
      snapshot: {
        ...base,
        entries: [
          ...base.entries,
          rqEntry("q-excluded", "QB", { eligibility: "EXCLUDED" }),
          rqEntry("q-follow", "QB", { evidenceRole: "FOLLOW_UP", eligibility: "OBSERVATION_ONLY" }),
        ],
      },
    });
    expect([...p.keys()].sort()).toEqual(["d-buf", "d-kc", "q-missing", "q-pos", "q-zero", "r-pos"]);
  });

  it("orders participants by position then rankableEntryId regardless of input order", () => {
    const base = rqBuildInput();
    const reversed = build({
      snapshot: { ...base.snapshot!, entries: [...base.snapshot!.entries].reverse() },
      playerStats: [...base.playerStats].reverse(),
      defenseStats: [...base.defenseStats].reverse(),
    });
    expect(reversed.content!.participants.map((p) => p.rankableEntryId)).toEqual(["q-missing", "q-pos", "q-zero", "r-pos", "d-buf", "d-kc"]);
    expect(reversed.contentChecksum).toBe(build().contentChecksum);
  });

  describe("frozen identity", () => {
    it("matches by the frozen provider + externalId, with the live identity checked against it", () => {
      const base = rqBuildInput().snapshot!;
      const drifted = rqEntry("q-pos", "QB");
      drifted.rankable = { ...drifted.rankable, externalId: "nfl-reassigned" };
      const p = participantsOf({ snapshot: { ...base, entries: [drifted, rqEntry("q-zero", "QB")] } });
      expect(p.get("q-pos")).toMatchObject({ externalId: "nfl-q-pos", participationState: "ABSENT_UNRESOLVED" });
      expect(p.get("q-pos")?.evidence.issues.map((i) => i.code)).toEqual(["FROZEN_IDENTITY_MISMATCH"]);
    });

    it("rejects a non nflcom-bootstrap provider", () => {
      const base = rqBuildInput().snapshot!;
      const entry = rqEntry("q-pos", "QB", { frozenIdentity: { provider: "mock", externalId: "nfl-q-pos" } });
      entry.rankable = { ...entry.rankable, provider: "mock" };
      const p = participantsOf({ snapshot: { ...base, entries: [entry] } });
      expect(p.get("q-pos")?.evidence.issues.map((i) => i.code)).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);
      expect(p.get("q-pos")?.participationState).toBe("ABSENT_UNRESOLVED");
    });

    it("requires DEF identity def-{TEAM} without any SNG crosswalk", () => {
      const base = rqBuildInput().snapshot!;
      const malformed = rqEntry("d-kc", "DEF", { team: "KC", externalId: "def-WAS" });
      const p = participantsOf({ snapshot: { ...base, entries: [malformed, rqEntry("d-buf", "DEF", { team: "WAS" })] } });
      expect(p.get("d-kc")?.evidence.issues.map((i) => i.code)).toEqual(["DEF_IDENTITY_MALFORMED"]);
      // Washington stays WAS (no WSH crosswalk): def-WAS for team WAS is valid.
      expect(p.get("d-buf")?.externalId).toBe("def-WAS");
    });

    it("keeps a pre-freeze-identity row usable with an advisory only", () => {
      const base = rqBuildInput().snapshot!;
      const p = participantsOf({ snapshot: { ...base, entries: [rqEntry("q-pos", "QB", { frozenIdentity: null })] } });
      expect(p.get("q-pos")?.participationState).toBe("PARTICIPATED_WITH_STATS");
      expect(p.get("q-pos")?.evidence.issues.map((i) => i.code)).toEqual(["IDENTITY_NOT_FROZEN"]);
    });
  });

  describe("week-level blockers (content is null)", () => {
    it.each([
      ["WEEK_NOT_COMPLETE", { week: { ...rqBuildInput().week, status: "LOCKED" } }],
      ["WEEK_SCORING_VERSION_MISMATCH", { week: { ...rqBuildInput().week, fantasyScoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V1" } }],
      ["WEEK_GAMES_NOT_FINAL", { games: [{ id: "g1", status: "FINAL" }, { id: "g2", status: "IN_PROGRESS" }] }],
      ["NO_CURRENT_FROZEN_SNAPSHOT", { snapshot: null }],
      ["NO_CURRENT_FROZEN_SNAPSHOT", { snapshot: { ...rqBuildInput().snapshot!, status: "SUPERSEDED", currentForWeekId: null } }],
      ["CONTEST_NOT_LOCKED", { contests: [{ id: "c-qb", position: "QB", status: "OPEN", snapshotId: "snap-1" }] }],
      ["CONTEST_SNAPSHOT_MISMATCH", { contests: [{ id: "c-qb", position: "QB", status: "LOCKED", snapshotId: "snap-0" }] }],
    ] as const)("%s", (code, overrides) => {
      const result = build(overrides as Partial<RankEyeQFinalWeekStatsBuildInput>);
      expect(result.content).toBeNull();
      expect(result.contentChecksum).toBeNull();
      expect(result.blockers.map((b) => b.code)).toContain(code);
    });

    it("tolerates CANCELED games but not POSTPONED or SCHEDULED ones", () => {
      expect(build({ games: [{ id: "g1", status: "FINAL" }, { id: "g2", status: "FINAL" }, { id: "g3", status: "CANCELED" }] }).blockers).toEqual([]);
      for (const status of ["POSTPONED", "SCHEDULED", "OTHER"]) {
        expect(build({ games: [{ id: "g1", status: "FINAL" }, { id: "g2", status }] }).blockers.map((b) => b.code)).toEqual(["WEEK_GAMES_NOT_FINAL"]);
      }
    });
  });
});

describe("called players outside the eligible pool (INVALIDATED_CALLED path)", () => {
  const base = () => rqBuildInput();
  const withCalled = (calledEntries: RankEyeQFinalWeekStatsBuildInput["calledEntries"], overrides: Partial<RankEyeQFinalWeekStatsBuildInput> = {}) =>
    participantsOf({ calledEntries, ...overrides });

  it("adds a called player the snapshot no longer holds, matched by the called entry's frozen identity", () => {
    const called = rqEntry("q-gone", "QB", { snapshotEntryId: "se-old-q-gone" });
    const p = withCalled([called], { playerStats: [...base().playerStats, rqStat("q-gone", 9.5)] });
    expect(p.get("q-gone")).toMatchObject({
      snapshotEntryId: "se-old-q-gone",
      provider: "nflcom-bootstrap",
      externalId: "nfl-q-gone",
      participationState: "PARTICIPATED_WITH_STATS",
      pointsHundredths: 950,
    });
    // The pool participants are unchanged.
    expect(p.get("q-pos")?.pointsHundredths).toBe(1854);
  });

  it("uses the snapshot's own entry for a called player that is still in the snapshot but no longer eligible", () => {
    const excluded = rqEntry("q-out", "QB", { eligibility: "EXCLUDED" });
    const calledOld = rqEntry("q-out", "QB", { snapshotEntryId: "se-older-q-out" });
    const snapshot = { ...base().snapshot!, entries: [...base().snapshot!.entries, excluded] };
    const p = withCalled([calledOld], { snapshot, playerStats: [...base().playerStats, rqStat("q-out", 4)] });
    expect(p.get("q-out")).toMatchObject({ snapshotEntryId: "se-q-out", pointsHundredths: 400 });
  });

  it("never duplicates an eligible pool member that boards also called", () => {
    const p = withCalled([rqEntry("q-pos", "QB", { snapshotEntryId: "se-older-q-pos" })]);
    expect([...p.keys()].filter((id) => id === "q-pos")).toHaveLength(1);
    expect(p.get("q-pos")?.snapshotEntryId).toBe("se-q-pos");
  });

  it("applies the same stat rules: a missing line is unresolved (never zero) and a zero line awaits review", () => {
    const p = withCalled([rqEntry("q-nostat", "QB"), rqEntry("q-zero2", "QB")], { playerStats: [...base().playerStats, rqStat("q-zero2", 0)] });
    expect(p.get("q-nostat")).toMatchObject({ participationState: "ABSENT_UNRESOLVED", pointsHundredths: null });
    expect(p.get("q-nostat")?.evidence.issues.map((i) => i.code)).toEqual(["STAT_ROW_MISSING"]);
    expect(p.get("q-zero2")).toMatchObject({ participationState: "PENDING_ZERO_REVIEW", pointsHundredths: null });
  });

  it("reads a called DEF from DefenseWeekStat with the def-{TEAM} identity rule", () => {
    const p = withCalled([rqEntry("d-gone", "DEF", { team: "DAL" })], { defenseStats: [...base().defenseStats, rqStat("d-gone", 3)] });
    expect(p.get("d-gone")).toMatchObject({ kind: "TEAM_DEFENSE", externalId: "def-DAL", pointsHundredths: 300 });
    expect(p.get("d-gone")?.evidence.statTable).toBe("DefenseWeekStat");
    const malformed = withCalled([rqEntry("d-bad", "DEF", { team: "DAL", externalId: "def-WAS" })]);
    expect(malformed.get("d-bad")?.evidence.issues.map((i) => i.code)).toContain("DEF_IDENTITY_MALFORMED");
    expect(malformed.get("d-bad")?.participationState).toBe("ABSENT_UNRESOLVED");
  });

  it("flags a player absent from the snapshot that was called under two frozen identities", () => {
    const a = rqEntry("q-two", "QB", { snapshotEntryId: "se-a", externalId: "nfl-one" });
    const b = rqEntry("q-two", "QB", { snapshotEntryId: "se-b", externalId: "nfl-two" });
    const p = withCalled([b, a]);
    expect(p.get("q-two")).toMatchObject({ snapshotEntryId: "se-a", participationState: "ABSENT_UNRESOLVED" });
    expect(p.get("q-two")?.evidence.issues.map((i) => i.code)).toContain("CALLED_IDENTITY_AMBIGUOUS");
  });

  it("is order-independent, dedupes repeated calls, and yields a verifiable snapshot", () => {
    const calls = [rqEntry("q-gone", "QB", { snapshotEntryId: "se-old" }), rqEntry("q-gone", "QB", { snapshotEntryId: "se-old" }), rqEntry("r-gone", "RB")];
    const stats = [...base().playerStats, rqStat("q-gone", 9.5), rqStat("r-gone", 2.25)];
    const first = build({ calledEntries: calls, playerStats: stats });
    const second = build({ calledEntries: [...calls].reverse(), playerStats: [...stats].reverse() });
    expect(first.contentChecksum).toBe(second.contentChecksum);
    expect(first.content!.participants.filter((p) => p.rankableEntryId === "q-gone")).toHaveLength(1);
    const verified = verifyRankEyeQFinalWeekStatsSnapshot(first.content, { expectedWeekId: RQ_WEEK_ID, allowUnresolved: true });
    expect(verified.ok).toBe(true);
  });

  it("changes the checksum only when called outside players exist (no calls = unchanged)", () => {
    expect(build({ calledEntries: [] }).contentChecksum).toBe(build().contentChecksum);
    expect(build({ calledEntries: [rqEntry("q-gone", "QB")] }).contentChecksum).not.toBe(build().contentChecksum);
  });
});

describe("buildRankEyeQFinalWeekStatsSnapshot (loader)", () => {
  function fakeDb(submissions: unknown[] = [], extraSnapshotEntries: unknown[] = []) {
    const calls: Array<{ model: string; method: string; args: unknown }> = [];
    const record = <T>(model: string, method: string, result: T) => (args: unknown) => {
      calls.push({ model, method, args });
      return Promise.resolve(result);
    };
    const input = rqBuildInput();
    const snapshot = input.snapshot!;
    const db = {
      week: { findUnique: record("week", "findUnique", { id: RQ_WEEK_ID, weekNumber: 6, status: "COMPLETE", fantasyScoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2", season: { year: 2026 } }) },
      nflGame: { findMany: record("nflGame", "findMany", input.games) },
      waiverSnapshot: {
        findFirst: record("waiverSnapshot", "findFirst", {
          id: snapshot.id,
          version: snapshot.version,
          status: "FROZEN",
          currentForWeekId: RQ_WEEK_ID,
          entriesFingerprint: snapshot.entriesFingerprint,
          entries: [...snapshot.entries.map((e) => ({
            id: e.snapshotEntryId,
            rankableEntryId: e.rankableEntryId,
            position: e.position,
            evidenceRole: e.evidenceRole,
            eligibility: e.eligibility,
            displayNameAtFreeze: e.displayNameAtFreeze,
            teamAtFreeze: e.teamAtFreeze,
            nflGameId: e.nflGameId,
            identityProviderAtFreeze: e.frozenIdentity?.provider ?? null,
            identityExternalIdAtFreeze: e.frozenIdentity?.externalId ?? null,
            rankableEntry: e.rankable,
          })), ...extraSnapshotEntries],
        }),
      },
      waiverContest: { findMany: record("waiverContest", "findMany", input.contests) },
      waiverSubmission: { findMany: record("waiverSubmission", "findMany", submissions) },
      playerWeekStat: { findMany: record("playerWeekStat", "findMany", input.playerStats) },
      defenseWeekStat: { findMany: record("defenseWeekStat", "findMany", input.defenseStats) },
    };
    return { db, calls };
  }

  it("selects only: current FROZEN snapshot, manual WeekStat rows by rankableEntryId, and matches the pure assembly", async () => {
    const { db, calls } = fakeDb();
    const result = await buildRankEyeQFinalWeekStatsSnapshot({ weekId: RQ_WEEK_ID }, db as never);
    expect(result.contentChecksum).toBe(build().contentChecksum);
    expect(calls.every((c) => c.method === "findUnique" || c.method === "findMany" || c.method === "findFirst")).toBe(true);
    const find = (model: string) => calls.find((c) => c.model === model)!.args as { where: Record<string, unknown> };
    expect(find("waiverSnapshot").where).toEqual({ weekId: RQ_WEEK_ID, currentForWeekId: RQ_WEEK_ID, status: "FROZEN" });
    expect(find("playerWeekStat").where).toEqual({ weekId: RQ_WEEK_ID, provider: "manual", rankableEntryId: { in: ["q-pos", "q-zero", "q-missing", "r-pos"] } });
    expect(find("defenseWeekStat").where).toEqual({ weekId: RQ_WEEK_ID, provider: "manual", rankableEntryId: { in: ["d-kc", "d-buf"] } });
  });

  it("loads locked-board called players outside the pool and reads their stat rows too", async () => {
    const row = (id: string, position: string, externalId: string) => ({
      id: `se-${id}`,
      rankableEntryId: id,
      position,
      evidenceRole: "CANDIDATE",
      eligibility: "ELIGIBLE",
      displayNameAtFreeze: `Name ${id}`,
      teamAtFreeze: "KC",
      nflGameId: "g1",
      identityProviderAtFreeze: "nflcom-bootstrap",
      identityExternalIdAtFreeze: externalId,
      rankableEntry: { provider: "nflcom-bootstrap", externalId, team: "KC" },
    });
    const submissions = [
      { lockedRevision: { calls: [{ snapshotEntry: row("q-pos", "QB", "nfl-q-pos") }, { snapshotEntry: row("q-gone", "QB", "nfl-q-gone") }] } },
      { lockedRevision: null },
      { lockedRevision: { calls: [{ snapshotEntry: { ...row("q-ineligible", "QB", "nfl-q-ineligible"), eligibility: "EXCLUDED" } }] } },
    ];
    const ineligibleInSnapshot = { ...row("q-ineligible", "QB", "nfl-q-ineligible"), eligibility: "EXCLUDED" };
    const { db, calls } = fakeDb(submissions, [ineligibleInSnapshot]);
    const result = await buildRankEyeQFinalWeekStatsSnapshot({ weekId: RQ_WEEK_ID }, db as never);
    const ids = result.content!.participants.map((p) => p.rankableEntryId);
    expect(ids).toEqual(expect.arrayContaining(["q-gone", "q-ineligible"]));
    expect(ids.filter((id) => id === "q-pos")).toHaveLength(1);
    const find = (model: string) => calls.find((c) => c.model === model)!.args as { where: Record<string, unknown> };
    expect(find("waiverSubmission").where).toEqual({ contestId: { in: ["c-qb"] }, lockedRevisionId: { not: null } });
    expect(find("playerWeekStat").where).toEqual({
      weekId: RQ_WEEK_ID,
      provider: "manual",
      rankableEntryId: { in: ["q-pos", "q-zero", "q-missing", "r-pos", "q-gone", "q-ineligible"] },
    });
    expect(calls.every((c) => c.method === "findUnique" || c.method === "findMany" || c.method === "findFirst")).toBe(true);
  });

  it("throws NOT_FOUND for an unknown week", async () => {
    const { db } = fakeDb();
    db.week.findUnique = () => Promise.resolve(null) as never;
    await expect(buildRankEyeQFinalWeekStatsSnapshot({ weekId: "nope" }, db as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
