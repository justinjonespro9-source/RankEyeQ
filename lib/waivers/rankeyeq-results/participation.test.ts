import { describe, expect, it } from "vitest";
import { rqBuiltContent, rqDecision } from "@/lib/waivers/__fixtures__/rankeyeq-results";
import { rankEyeQContentChecksum } from "@/lib/waivers/rankeyeq-results/checksum";
import { applyParticipationDecisions, listRankEyeQParticipationReviewItems } from "@/lib/waivers/rankeyeq-results/participation";

const participant = (content: ReturnType<typeof rqBuiltContent>, id: string) => content.participants.find((p) => p.rankableEntryId === id)!;

describe("listRankEyeQParticipationReviewItems", () => {
  it("lists pending zeros as decidable and absent stats as undecidable blockers", () => {
    const items = listRankEyeQParticipationReviewItems(rqBuiltContent());
    expect(items.map((i) => [i.rankableEntryId, i.reviewKind, i.state])).toEqual([
      ["q-missing", "UNRESOLVED_BLOCKER", "ABSENT_UNRESOLVED"],
      ["q-zero", "ZERO_POINT_REVIEW", "PENDING_ZERO_REVIEW"],
      ["d-buf", "ZERO_POINT_REVIEW", "PENDING_ZERO_REVIEW"],
    ]);
    expect(items[0].issues.map((i) => i.code)).toEqual(["STAT_ROW_MISSING"]);
    expect(items[1]).toMatchObject({ provider: "nflcom-bootstrap", externalId: "nfl-q-zero", statRowId: "stat-q-zero-0", gameIds: ["g2"] });
  });
});

describe("applyParticipationDecisions", () => {
  it("promotes PLAYED_ZERO to PARTICIPATED_ZERO (PLAYED, zero hundredths) with evidence", () => {
    const content = rqBuiltContent();
    const result = applyParticipationDecisions(content, [rqDecision("q-zero", "PLAYED_ZERO")]);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toEqual([{ rankableEntryId: "q-zero", decision: "PLAYED_ZERO" }]);
    expect(participant(result.content, "q-zero")).toMatchObject({
      participationState: "PARTICIPATED_ZERO",
      disposition: "PLAYED",
      proof: "OPERATOR_PLAYED_ZERO_REVIEW",
      pointsHundredths: 0,
    });
    expect(participant(result.content, "q-zero").evidence.decision).toEqual({
      decision: "PLAYED_ZERO",
      evidenceReference: "https://example.test/boxscore/week6",
      reason: "Reviewed official box score and game book",
      decidedByUserId: "admin-1",
      decidedAt: "2026-10-20T15:00:00.000Z",
    });
    expect(result.content.summary).toMatchObject({ pendingZeroCount: 1, unresolvedCount: 2 });
  });

  it("promotes DID_NOT_PLAY to VERIFIED_NON_PARTICIPANT / DNP with no points", () => {
    const result = applyParticipationDecisions(rqBuiltContent(), [rqDecision("d-buf", "DID_NOT_PLAY", { decidedAt: new Date("2026-10-20T16:30:00Z") })]);
    expect(result.rejected).toEqual([]);
    expect(participant(result.content, "d-buf")).toMatchObject({
      participationState: "VERIFIED_NON_PARTICIPANT",
      disposition: "DNP",
      proof: "OPERATOR_DID_NOT_PLAY_REVIEW",
      pointsHundredths: null,
    });
    expect(participant(result.content, "d-buf").evidence.decision?.decidedAt).toBe("2026-10-20T16:30:00.000Z");
  });

  it("never mutates its input and changes the checksum only when something applied", () => {
    const content = rqBuiltContent();
    const before = rankEyeQContentChecksum(content);
    const result = applyParticipationDecisions(content, [rqDecision("q-zero", "PLAYED_ZERO")]);
    expect(rankEyeQContentChecksum(content)).toBe(before);
    expect(rankEyeQContentChecksum(result.content)).not.toBe(before);
    expect(rankEyeQContentChecksum(applyParticipationDecisions(content, []).content)).toBe(before);
  });

  it("leaves a PENDING decision unresolved without rejecting it", () => {
    const result = applyParticipationDecisions(rqBuiltContent(), [rqDecision("q-zero", "PENDING", { evidenceReference: "", reason: "" })]);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toEqual([]);
    expect(participant(result.content, "q-zero").participationState).toBe("PENDING_ZERO_REVIEW");
  });

  it.each(["PLAYED_ZERO", "DID_NOT_PLAY"] as const)("rejects inventing a %s for ABSENT_UNRESOLVED (missing stats are not zero)", (decision) => {
    const result = applyParticipationDecisions(rqBuiltContent(), [rqDecision("q-missing", decision)]);
    expect(result.rejected).toEqual([expect.objectContaining({ rankableEntryId: "q-missing", code: "UNRESOLVED_CANNOT_BE_ZEROED" })]);
    expect(result.applied).toEqual([]);
    expect(participant(result.content, "q-missing")).toMatchObject({ participationState: "ABSENT_UNRESOLVED", pointsHundredths: null });
  });

  it("rejects overriding a positive stat line", () => {
    const result = applyParticipationDecisions(rqBuiltContent(), [rqDecision("q-pos", "DID_NOT_PLAY")]);
    expect(result.rejected).toEqual([expect.objectContaining({ rankableEntryId: "q-pos", code: "NOT_PENDING_ZERO_REVIEW" })]);
    expect(participant(result.content, "q-pos").participationState).toBe("PARTICIPATED_WITH_STATS");
  });

  it("rejects an already-decided participant on a second pass", () => {
    const first = applyParticipationDecisions(rqBuiltContent(), [rqDecision("q-zero", "PLAYED_ZERO")]);
    const second = applyParticipationDecisions(first.content, [rqDecision("q-zero", "DID_NOT_PLAY")]);
    expect(second.rejected).toEqual([expect.objectContaining({ code: "NOT_PENDING_ZERO_REVIEW" })]);
    expect(participant(second.content, "q-zero").participationState).toBe("PARTICIPATED_ZERO");
  });

  it("rejects unknown entries, duplicate decisions and unknown decision values", () => {
    const result = applyParticipationDecisions(rqBuiltContent(), [
      rqDecision("nobody", "PLAYED_ZERO"),
      rqDecision("q-zero", "PLAYED_ZERO"),
      rqDecision("q-zero", "DID_NOT_PLAY"),
      { ...rqDecision("d-buf", "PLAYED_ZERO"), decision: "MAYBE" as never },
    ]);
    expect(result.rejected.map((r) => [r.rankableEntryId, r.code])).toEqual([
      ["nobody", "UNKNOWN_ENTRY"],
      ["q-zero", "DUPLICATE_DECISION"],
      ["d-buf", "DECISION_UNKNOWN"],
    ]);
    // The first decision for q-zero still applies; the duplicate does not override it.
    expect(participant(result.content, "q-zero").participationState).toBe("PARTICIPATED_ZERO");
    expect(participant(result.content, "d-buf").participationState).toBe("PENDING_ZERO_REVIEW");
  });

  it.each([
    ["EVIDENCE_REQUIRED", { evidenceReference: "   " }],
    ["EVIDENCE_REQUIRED", { evidenceReference: "x".repeat(501) }],
    ["REASON_REQUIRED", { reason: "" }],
    ["DECIDER_REQUIRED", { decidedByUserId: " " }],
    ["DECIDED_AT_INVALID", { decidedAt: "not-a-date" }],
  ] as const)("requires evidence, reason, operator and timestamp (%s)", (code, overrides) => {
    const result = applyParticipationDecisions(rqBuiltContent(), [rqDecision("q-zero", "PLAYED_ZERO", overrides)]);
    expect(result.rejected).toEqual([expect.objectContaining({ code })]);
    expect(participant(result.content, "q-zero").participationState).toBe("PENDING_ZERO_REVIEW");
  });

  it("trims evidence fields before recording them", () => {
    const result = applyParticipationDecisions(rqBuiltContent(), [rqDecision("q-zero", "PLAYED_ZERO", { evidenceReference: "  box-score-12  ", reason: " ok " })]);
    expect(participant(result.content, "q-zero").evidence.decision).toMatchObject({ evidenceReference: "box-score-12", reason: "ok" });
  });
});
