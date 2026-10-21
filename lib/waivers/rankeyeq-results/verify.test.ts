import { describe, expect, it } from "vitest";
import { rqBuiltContent, rqResolvedContent } from "@/lib/waivers/__fixtures__/rankeyeq-results";
import { rankEyeQContentChecksum } from "@/lib/waivers/rankeyeq-results/checksum";
import type { RankEyeQFinalWeekStatsContent, RankEyeQParticipant } from "@/lib/waivers/rankeyeq-results/types";
import { verifyRankEyeQFinalWeekStatsSnapshot, type RankEyeQVerifyOptions } from "@/lib/waivers/rankeyeq-results/verify";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const codes = (result: ReturnType<typeof verifyRankEyeQFinalWeekStatsSnapshot>) => (result.ok ? [] : result.issues.map((i) => i.code));
const verify = (content: unknown, options?: RankEyeQVerifyOptions) => verifyRankEyeQFinalWeekStatsSnapshot(content, options);

/** A mutable JSON copy (as read back from a database row) of the resolved fixture, with its summary kept consistent. */
function stored(mutate?: (content: RankEyeQFinalWeekStatsContent, find: (id: string) => RankEyeQParticipant) => void): RankEyeQFinalWeekStatsContent {
  const content = clone(rqResolvedContent()) as { -readonly [K in keyof RankEyeQFinalWeekStatsContent]: RankEyeQFinalWeekStatsContent[K] };
  mutate?.(content, (id) => content.participants.find((p) => p.rankableEntryId === id)!);
  return content;
}

describe("verifyRankEyeQFinalWeekStatsSnapshot", () => {
  it("accepts a fully resolved snapshot and returns the recomputed checksum", () => {
    const content = rqResolvedContent();
    const checksum = rankEyeQContentChecksum(content);
    const result = verify(content, { expectedContentChecksum: checksum, expectedWeekId: "week-6" });
    expect(result).toMatchObject({ ok: true, verified: { contentChecksum: checksum } });
  });

  it("is insensitive to JSON key order (as after a jsonb round trip)", () => {
    const content = rqResolvedContent();
    const reordered = JSON.parse(JSON.stringify(content, (_key, value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value)));
    expect(verify(reordered, { expectedContentChecksum: rankEyeQContentChecksum(content) }).ok).toBe(true);
  });

  describe("unresolved states block ACCEPTED publication", () => {
    it("rejects PENDING_ZERO_REVIEW and ABSENT_UNRESOLVED", () => {
      const result = verify(rqBuiltContent());
      expect(result.ok).toBe(false);
      const issues = result.ok ? [] : result.issues.filter((i) => i.code === "UNRESOLVED_PARTICIPANT");
      expect(issues.map((i) => i.rankableEntryId).sort()).toEqual(["d-buf", "q-missing", "q-zero"]);
    });

    it("allows them only for explicit pre-publication checks", () => {
      expect(verify(rqBuiltContent(), { allowUnresolved: true }).ok).toBe(true);
    });

    it("never treats a non-ACCEPTED publication state as authoritative", () => {
      for (const publicationState of ["SUPERSEDED", "WITHDRAWN"] as const) {
        expect(codes(verify(rqResolvedContent(), { publicationState }))).toEqual(["PUBLICATION_STATE_NOT_ACCEPTED"]);
      }
    });
  });

  describe("integrity", () => {
    it("detects a tampered snapshot via the checksum", () => {
      const checksum = rankEyeQContentChecksum(rqResolvedContent());
      const tampered = stored((_c, find) => {
        find("q-pos").pointsHundredths = 9999;
      });
      expect(codes(verify(tampered, { expectedContentChecksum: checksum }))).toEqual(["CHECKSUM_MISMATCH"]);
    });

    it("rejects non-object and malformed content", () => {
      expect(codes(verify(null))).toEqual(["CONTENT_NOT_OBJECT"]);
      expect(codes(verify([]))).toEqual(["CONTENT_NOT_OBJECT"]);
      expect(codes(verify({ schemaVersion: "rankeyeq-final-week-stats/1" }))).toContain("CONTENT_SHAPE_INVALID");
      const noParticipants = stored();
      (noParticipants as unknown as Record<string, unknown>).participants = "nope";
      expect(codes(verify(noParticipants))).toContain("CONTENT_SHAPE_INVALID");
    });

    it("rejects non-integer points and content that cannot be canonicalized (floats)", () => {
      const floatPoints = stored((_c, find) => {
        find("q-pos").pointsHundredths = 18.54;
      });
      expect(codes(verify(floatPoints))).toEqual(["CONTENT_SHAPE_INVALID"]);
      const floatExtra = stored((_c, find) => {
        (find("q-pos").evidence as unknown as Record<string, unknown>).rawFantasyPoints = 18.54;
      });
      expect(codes(verify(floatExtra))).toEqual(["CONTENT_NOT_CANONICALIZABLE"]);
    });

    it("cross-checks the stored row metadata", () => {
      const content = rqResolvedContent();
      const good = { schemaVersion: content.schemaVersion, scoringVersion: content.scoringVersion, rankingsWeekStatus: "COMPLETE", sourceWeekId: "week-6", weekId: "week-6", participantCount: 6, pendingZeroCount: 0, unresolvedCount: 0, authorityBasis: "RANKEYEQ_OPERATOR_ATTESTED", attestationVersion: "rankeyeq-final-week-stats-attestation/1" };
      expect(verify(content, { row: good }).ok).toBe(true);
      expect(codes(verify(content, { row: { ...good, participantCount: 5, unresolvedCount: 1 } }))).toEqual(["ROW_METADATA_MISMATCH", "ROW_METADATA_MISMATCH"]);
      expect(codes(verify(content, { row: { ...good, authorityBasis: "SNG_ACCEPTED" } }))).toEqual(["AUTHORITY_BASIS_MISMATCH"]);
      expect(codes(verify(content, { row: { ...good, attestationVersion: "rankeyeq-sng-artifact-import-attestation/1" } }))).toEqual(["ATTESTATION_VERSION_MISMATCH"]);
    });

    it("rejects a different week", () => {
      expect(codes(verify(rqResolvedContent(), { expectedWeekId: "week-7" }))).toEqual(["WEEK_MISMATCH"]);
    });
  });

  describe("pins", () => {
    it.each([
      ["SCHEMA_VERSION_MISMATCH", (c: RankEyeQFinalWeekStatsContent): void => void ((c as { schemaVersion: string }).schemaVersion = "sng-canonical-nfl-weekly-performance/1")],
      ["SOURCE_KIND_MISMATCH", (c: RankEyeQFinalWeekStatsContent): void => void ((c as { sourceKind: string }).sourceKind = "SNG_CANONICAL")],
      ["SCORING_VERSION_MISMATCH", (c: RankEyeQFinalWeekStatsContent): void => void ((c as { scoringVersion: string }).scoringVersion = "SNG_NFL_HALF_PPR")],
      ["WEEK_STATUS_NOT_COMPLETE", (c: RankEyeQFinalWeekStatsContent): void => void ((c as { rankingsWeekStatus: string }).rankingsWeekStatus = "LOCKED")],
      ["SOURCE_WEEK_MISMATCH", (c: RankEyeQFinalWeekStatsContent): void => void ((c as { sourceWeekId: string }).sourceWeekId = "week-5")],
      ["STAT_PROVIDER_MISMATCH", (c: RankEyeQFinalWeekStatsContent): void => void ((c as { statProvider: string }).statProvider = "mock")],
      ["SERIES_KEY_MISMATCH", (c: RankEyeQFinalWeekStatsContent): void => void ((c as { seriesKey: string }).seriesKey = "NFL:2026:7:RANKEYEQ_FINAL_WEEK_STATS@1:FANTASYTRACK_NFL_HALF_PPR_V2")],
    ] as const)("%s", (code, mutate) => {
      expect(codes(verify(stored((c) => void mutate(c))))).toContain(code);
    });

    it("requires locked contests pinned to the content's waiver snapshot", () => {
      const open = stored((c) => void ((c.contests[0] as { status: string }).status = "OPEN"));
      expect(codes(verify(open))).toEqual(["CONTEST_INVALID"]);
      const wrong = stored((c) => void ((c.contests[0] as { snapshotId: string }).snapshotId = "snap-0"));
      expect(codes(verify(wrong))).toEqual(["CONTEST_INVALID"]);
    });
  });

  describe("participant invariants", () => {
    it("rejects a PARTICIPATED_ZERO forged without an operator decision", () => {
      const forged = stored((_c, find) => {
        find("q-zero").evidence = { ...find("q-zero").evidence, decision: null };
      });
      expect(codes(verify(forged))).toEqual(["PARTICIPANT_EVIDENCE_INVALID"]);
    });

    it("rejects a zero inferred as DNP or a played zero without review proof", () => {
      const inferred = stored((_c, find) => {
        const p = find("q-zero") as { participationState: string; disposition: string; proof: string; evidence: { decision: unknown } };
        p.participationState = "VERIFIED_NON_PARTICIPANT";
        p.disposition = "DNP";
        p.proof = "WEEK_STAT_LINE";
        p.evidence.decision = null;
      });
      const result = codes(verify(inferred));
      expect(result).toContain("PARTICIPANT_STATE_INCOHERENT");
      expect(result).toContain("PARTICIPANT_EVIDENCE_INVALID");
    });

    it("rejects a DNP with points and a stat line with zero points", () => {
      const dnpPoints = stored((_c, find) => void ((find("d-buf") as { pointsHundredths: number | null }).pointsHundredths = 0));
      expect(codes(verify(dnpPoints))).toEqual(["PARTICIPANT_STATE_INCOHERENT"]);
      const zeroStat = stored((_c, find) => void ((find("q-pos") as { pointsHundredths: number | null }).pointsHundredths = 0));
      expect(codes(verify(zeroStat))).toEqual(["PARTICIPANT_STATE_INCOHERENT"]);
    });

    it("rejects an operator decision attached to a positive stat line", () => {
      const overridden = stored((_c, find) => {
        find("q-pos").evidence = { ...find("q-pos").evidence, decision: find("q-zero").evidence.decision };
      });
      expect(codes(verify(overridden))).toEqual(["PARTICIPANT_EVIDENCE_INVALID"]);
    });

    it("requires scorable participants to carry a final, non-provisional, V2-scored manual stat row and FINAL games", () => {
      for (const mutate of [
        (p: RankEyeQParticipant) => void ((p.evidence as { isProvisional: boolean | null }).isProvisional = true),
        (p: RankEyeQParticipant) => void ((p.evidence as { statProvider: string | null }).statProvider = "mock"),
        (p: RankEyeQParticipant) => void ((p.evidence as { statScoringVersion: string | null }).statScoringVersion = "V1"),
        (p: RankEyeQParticipant) => void ((p.evidence as { statRowId: string | null }).statRowId = null),
        (p: RankEyeQParticipant) => void ((p.evidence.games[0] as { status: string }).status = "IN_PROGRESS"),
        (p: RankEyeQParticipant) => void ((p.evidence as { issues: unknown }).issues = [{ code: "GAME_NOT_FINAL", detail: "x" }]),
      ]) {
        expect(codes(verify(stored((_c, find) => mutate(find("q-pos")))))).toContain("PARTICIPANT_EVIDENCE_INVALID");
      }
    });

    it("requires nflcom-bootstrap identities and def-{TEAM} for defenses", () => {
      expect(codes(verify(stored((_c, find) => void ((find("q-pos") as { provider: string }).provider = "mock"))))).toContain("PARTICIPANT_IDENTITY_INVALID");
      expect(codes(verify(stored((_c, find) => void ((find("d-kc") as { externalId: string }).externalId = "sng-kansas-city-chiefs"))))).toContain("PARTICIPANT_IDENTITY_INVALID");
      expect(codes(verify(stored((_c, find) => void ((find("d-kc") as { kind: string }).kind = "PLAYER"))))).toContain("PARTICIPANT_IDENTITY_INVALID");
    });

    it("rejects duplicate participants and out-of-order content", () => {
      const duplicate = stored((c) => void (c.participants as RankEyeQParticipant[]).push({ ...c.participants[0] }));
      expect(codes(verify(duplicate))).toEqual(expect.arrayContaining(["PARTICIPANT_DUPLICATE"]));
      const sameIdentity = stored((c, find) => void ((find("r-pos") as { externalId: string }).externalId = c.participants[0].externalId));
      expect(codes(verify(sameIdentity))).toContain("PARTICIPANT_DUPLICATE");
      const unordered = stored((c) => void (c.participants as RankEyeQParticipant[]).reverse());
      expect(codes(verify(unordered))).toEqual(["PARTICIPANT_ORDER_INVALID"]);
    });

    it("rejects a summary that does not match the participants", () => {
      const wrong = stored((c) => void ((c.summary as { participantCount: number }).participantCount = 99));
      expect(codes(verify(wrong))).toEqual(["SUMMARY_MISMATCH"]);
    });
  });
});
