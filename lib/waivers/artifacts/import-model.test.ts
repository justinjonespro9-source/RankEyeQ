import { describe, expect, it } from "vitest";
import {
  WAIVER_ARTIFACT_AUTHORITY_LABEL,
  WAIVER_ARTIFACT_IMPORT_ATTESTATION_TEXT,
  WAIVER_ARTIFACT_PUBLICATION_AUTHORITY,
} from "@/lib/waivers/artifacts/authority";
import {
  canRecordWaiverArtifactEvent,
  EMPTY_WAIVER_ARTIFACT_LEDGER,
  evaluateWaiverArtifactImport,
  verifyWaiverArtifactText,
  WAIVER_ARTIFACT_TRANSITIONS,
  waiverArtifactWithdrawalIssues,
  type StoredWaiverArtifact,
  type WaiverArtifactImportEvidence,
  type WaiverArtifactImportInput,
  type WaiverArtifactLedger,
  type WaiverArtifactWeek,
} from "@/lib/waivers/artifacts/import-model";
import { SNG_RULESET_VERSION, sngSeriesKey } from "@/lib/waivers/canonical/contract";
import {
  buildSyntheticCanonicalArtifact,
  sealSyntheticArtifact,
  syntheticCanonicalDraft,
  SYNTHETIC_PARTICIPANTS,
  type SealedSyntheticArtifact,
} from "@/lib/waivers/__fixtures__/canonical-artifact";

const NOW = new Date("2026-10-08T00:00:00.000Z");
const WEEK5: WaiverArtifactWeek = { id: "week-5", season: 2026, weekNumber: 5, label: "Week 5", isTest: false };
const WEEK6: WaiverArtifactWeek = { id: "week-6", season: 2026, weekNumber: 6, label: "Week 6", isTest: false };
const SERIES5 = sngSeriesKey(2026, 5);

function evidenceFor(sealed: SealedSyntheticArtifact, overrides: Partial<WaiverArtifactImportEvidence> = {}): WaiverArtifactImportEvidence {
  const artifact = sealed.artifact as { artifactId: string; revision: number; payload: { acceptance: { id: string; acceptedAt: string } } };
  return {
    expectedContentChecksum: sealed.checksum,
    sngArtifactId: artifact.artifactId,
    sngRevision: artifact.revision,
    sngAcceptanceId: artifact.payload.acceptance.id,
    sngAcceptedAt: new Date(artifact.payload.acceptance.acceptedAt),
    attestedPublicationState: "ACCEPTED",
    sourceReference: "sng-admin://artifacts/artifact-r1",
    sourceObservedAt: new Date("2026-10-07T16:00:00.000Z"),
    ...overrides,
  };
}

function evaluate(
  sealed: SealedSyntheticArtifact,
  options: { week?: WaiverArtifactWeek | null; ledger?: WaiverArtifactLedger; evidence?: Partial<WaiverArtifactImportEvidence>; text?: string; mode?: "UNVERIFIABLE" | "OPERATOR_ATTESTED" } = {},
) {
  const week = options.week === undefined ? WEEK5 : options.week;
  const request: WaiverArtifactImportInput = { weekId: week?.id ?? "missing", artifactText: options.text ?? sealed.bytes, evidence: evidenceFor(sealed, options.evidence) };
  return evaluateWaiverArtifactImport({
    request,
    week,
    verification: verifyWaiverArtifactText(request, week),
    ledger: options.ledger ?? EMPTY_WAIVER_ARTIFACT_LEDGER,
    authorityMode: options.mode ?? "OPERATOR_ATTESTED",
    now: NOW,
  });
}

const codes = (preview: ReturnType<typeof evaluate>) => preview.blockers.map((issue) => issue.code);
const verifierCodes = (preview: ReturnType<typeof evaluate>) => preview.verification.issues.map((issue) => issue.code);

function stored(sealed: SealedSyntheticArtifact, overrides: Partial<StoredWaiverArtifact> = {}): StoredWaiverArtifact {
  const artifact = sealed.artifact as { artifactId: string; seriesKey: string; revision: number; supersedesArtifactId: string | null };
  return {
    id: `row-${artifact.artifactId}`,
    artifactId: artifact.artifactId,
    seriesKey: artifact.seriesKey,
    revision: artifact.revision,
    supersedesArtifactId: artifact.supersedesArtifactId,
    contentChecksum: sealed.checksum,
    weekId: WEEK5.id,
    latestState: "ACCEPTED",
    latestSequence: 1,
    ...overrides,
  };
}

const R1 = buildSyntheticCanonicalArtifact({ revision: 1 });
const R2 = buildSyntheticCanonicalArtifact({ revision: 2 });
const R3 = buildSyntheticCanonicalArtifact({ revision: 3 });

describe("publication authority gate", () => {
  it("ships OPERATOR_ATTESTED (product-approved V1 operator-trust model) with an honest label", () => {
    expect(WAIVER_ARTIFACT_PUBLICATION_AUTHORITY).toBe("OPERATOR_ATTESTED");
    expect(WAIVER_ARTIFACT_AUTHORITY_LABEL).toBe("Operator verified — SNG publication not independently authenticated");
    expect(WAIVER_ARTIFACT_IMPORT_ATTESTATION_TEXT).toMatch(/authenticated publication\/download surface/);
    expect(WAIVER_ARTIFACT_IMPORT_ATTESTATION_TEXT).toMatch(/proves the content is unaltered, not who authored or published it/);
    const advisory = evaluate(R1).advisories.find((issue) => issue.code === "OPERATOR_ATTESTED_AUTHORITY")!;
    expect(advisory.message).toContain(WAIVER_ARTIFACT_AUTHORITY_LABEL);
  });

  it("an otherwise valid artifact is blocked by the UNVERIFIABLE kill switch", () => {
    const preview = evaluate(R1, { mode: "UNVERIFIABLE" });
    expect(preview.verification.ok).toBe(true);
    expect(codes(preview)).toEqual(["PUBLICATION_AUTHORITY_UNVERIFIABLE"]);
    expect(preview.status).toBe("BLOCKED");
    expect(preview.importEnabled).toBe(false);
  });
});

describe("import preview — verification and evidence", () => {
  it("previews a valid first revision as READY with contract, acceptance and fingerprint", () => {
    const preview = evaluate(R1);
    expect(codes(preview)).toEqual([]);
    expect(preview.status).toBe("READY");
    expect(preview.importEnabled).toBe(true);
    expect(preview.summary).toMatchObject({ artifactId: "artifact-r1", revision: 1, seriesKey: SERIES5, contentChecksum: R1.checksum });
    expect(preview.contract).toMatchObject({ rulesetCode: "SNG_NFL_HALF_PPR", rulesetVersion: SNG_RULESET_VERSION, engineVersion: "sng-nfl-fantasy-engine/1.0.0" });
    expect(preview.acceptance).toMatchObject({ id: "artifact-r1", status: "ACCEPTED" });
    expect(preview.advisories.map((issue) => issue.code)).toEqual(expect.arrayContaining(["OPERATOR_ATTESTED_AUTHORITY", "NO_GRADING", "CROSSWALK_PENDING_PRODUCER_FIXTURE"]));
    expect(preview.previewFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.byteLength).toBe(Buffer.byteLength(R1.bytes, "utf8"));
  });

  it("rejects a SHA-256 that differs from the authenticated source digest", () => {
    const preview = evaluate(R1, { evidence: { expectedContentChecksum: "0".repeat(64) } });
    expect(codes(preview)).toContain("ARTIFACT_INVALID");
    expect(verifierCodes(preview)).toEqual(["EXPECTED_CHECKSUM_MISMATCH"]);
  });

  it("rejects non-canonical serialization of otherwise identical content", () => {
    const pretty = JSON.stringify(JSON.parse(R1.bytes), null, 2);
    const preview = evaluate(R1, { text: pretty });
    expect(verifierCodes(preview)).toEqual(["ARTIFACT_NON_CANONICAL_BYTES"]);
    expect(preview.status).toBe("BLOCKED");
  });

  it("rejects a different ruleset pin", () => {
    const draft = syntheticCanonicalDraft() as { payload: { ruleset: { version: number } } };
    draft.payload.ruleset.version = 2;
    const sealed = sealSyntheticArtifact(draft as unknown as Record<string, unknown>);
    const preview = evaluate(sealed);
    expect(codes(preview)).toContain("ARTIFACT_INVALID");
    expect(verifierCodes(preview)).toEqual(["RULESET_PIN_MISMATCH"]);
  });

  it("rejects an artifact for a different season or week than the target Week", () => {
    expect(verifierCodes(evaluate(R1, { week: WEEK6 }))).toContain("WEEK_MISMATCH");
    expect(verifierCodes(evaluate(R1, { week: { ...WEEK5, season: 2027 } }))).toContain("WEEK_MISMATCH");
  });

  it("blocks when acceptance authority evidence is missing", () => {
    const preview = evaluate(R1, { evidence: { sngAcceptanceId: "", sourceReference: " ", sourceObservedAt: null, sngAcceptedAt: null } });
    const missing = preview.blockers.find((issue) => issue.code === "EVIDENCE_MISSING");
    expect(missing?.details).toEqual({ missing: ["sngAcceptanceId", "sngAcceptedAt", "sourceReference", "sourceObservedAt"] });
    expect(preview.status).toBe("BLOCKED");
  });

  it("blocks operator evidence that contradicts the verified bytes", () => {
    const preview = evaluate(R1, { evidence: { sngArtifactId: "artifact-rX", sngRevision: 2, sngAcceptedAt: new Date("2026-10-07T15:00:01.000Z") } });
    expect(preview.blockers.find((issue) => issue.code === "EVIDENCE_MISMATCH")?.details).toEqual({ mismatched: ["sngArtifactId", "sngRevision", "sngAcceptedAt"] });
  });

  it("blocks invalid acceptance evidence: non-ACCEPTED state, malformed digest, impossible observation times", () => {
    expect(verifierCodes(evaluate(R1, { evidence: { attestedPublicationState: "WITHDRAWN" } }))).toContain("ARTIFACT_NOT_CURRENT");
    expect(codes(evaluate(R1, { evidence: { attestedPublicationState: "PUBLISHED" } }))).toContain("EVIDENCE_INVALID");
    expect(codes(evaluate(R1, { evidence: { expectedContentChecksum: "ABC" } }))).toContain("EVIDENCE_INVALID");
    expect(codes(evaluate(R1, { evidence: { sourceObservedAt: new Date("2026-10-09T00:00:00.000Z") } }))).toContain("SOURCE_OBSERVED_AT_INVALID");
    expect(codes(evaluate(R1, { evidence: { sourceObservedAt: new Date("2026-10-07T14:00:00.000Z") } }))).toContain("SOURCE_OBSERVED_AT_INVALID");
  });

  it("blocks a missing week", () => {
    expect(codes(evaluate(R1, { week: null }))).toContain("WEEK_NOT_FOUND");
  });

  it("changes the fingerprint when evidence or local history changes", () => {
    const base = evaluate(R1).previewFingerprint;
    expect(evaluate(R1).previewFingerprint).toBe(base);
    expect(evaluate(R1, { evidence: { sourceReference: "sng-admin://other" } }).previewFingerprint).not.toBe(base);
    const withHistory = evaluate(R2, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, latestInSeries: stored(R1), declaredPredecessor: stored(R1) } });
    const afterWithdrawal = evaluate(R2, {
      ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, latestInSeries: stored(R1, { latestState: "WITHDRAWN", latestSequence: 2 }), declaredPredecessor: stored(R1) },
    });
    expect(withHistory.previewFingerprint).not.toBe(afterWithdrawal.previewFingerprint);
  });
});

describe("import preview — succession and idempotency", () => {
  it("valid next revision supersedes an ACCEPTED predecessor", () => {
    const preview = evaluate(R2, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, latestInSeries: stored(R1), declaredPredecessor: stored(R1) } });
    expect(codes(preview)).toEqual([]);
    expect(preview.succession).toMatchObject({ predecessorAction: "SUPERSEDE", predecessorRowId: "row-artifact-r1", predecessorSequence: 1, skippedRevisions: 0 });
    expect(preview.advisories.map((issue) => issue.code)).toContain("SUPERSEDES_PREDECESSOR");
  });

  it("successor of a WITHDRAWN predecessor leaves it withdrawn", () => {
    const r1 = stored(R1, { latestState: "WITHDRAWN", latestSequence: 2 });
    const preview = evaluate(R2, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, latestInSeries: r1, declaredPredecessor: r1 } });
    expect(codes(preview)).toEqual([]);
    expect(preview.succession.predecessorAction).toBe("PREDECESSOR_WITHDRAWN");
  });

  it("identical retry is ALREADY_IMPORTED and writes nothing", () => {
    const preview = evaluate(R1, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, byArtifactId: stored(R1), byChecksum: stored(R1), atRevision: stored(R1), latestInSeries: stored(R1) } });
    expect(codes(preview)).toEqual([]);
    expect(preview.status).toBe("ALREADY_IMPORTED");
    expect(preview.succession.existingArtifactRowId).toBe("row-artifact-r1");
  });

  it("a WITHDRAWN artifact cannot be silently restored by re-import", () => {
    const r1 = stored(R1, { latestState: "WITHDRAWN", latestSequence: 2 });
    expect(codes(evaluate(R1, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, byArtifactId: r1, latestInSeries: r1 } }))).toEqual(["WITHDRAWN_REIMPORT"]);
  });

  it("artifact ID collision with different content", () => {
    const changed = buildSyntheticCanonicalArtifact({ participants: SYNTHETIC_PARTICIPANTS.map((p) => (p.id === "qb-a" ? { ...p, points: 2411 } : p)) });
    expect(codes(evaluate(changed, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, byArtifactId: stored(R1), latestInSeries: stored(R1) } }))).toEqual(["ARTIFACT_ID_REUSED"]);
  });

  it("checksum collision under a different artifact ID", () => {
    const other = stored(R1, { id: "row-other", artifactId: "artifact-other" });
    expect(codes(evaluate(R1, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, byChecksum: other } }))).toEqual(["CHECKSUM_REUSED"]);
  });

  it("same series/revision with different content", () => {
    const rival = buildSyntheticCanonicalArtifact({ artifactId: "artifact-r1-rival" });
    expect(codes(evaluate(rival, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, atRevision: stored(R1), latestInSeries: stored(R1) } }))).toEqual(["REVISION_CONFLICT"]);
  });

  it("revision regression", () => {
    const rival = buildSyntheticCanonicalArtifact({ artifactId: "artifact-r1-late" });
    expect(codes(evaluate(rival, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, latestInSeries: stored(R2) } }))).toEqual(["REVISION_REGRESSION"]);
  });

  it("skipped revision (first import is not revision 1, or n+2 after n)", () => {
    expect(codes(evaluate(R2))).toEqual(["REVISION_SKIPPED"]);
    expect(codes(evaluate(R3, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, latestInSeries: stored(R1) } }))).toEqual(["REVISION_SKIPPED"]);
  });

  it("predecessor mismatch", () => {
    const wrong = buildSyntheticCanonicalArtifact({ revision: 2, supersedesArtifactId: "artifact-elsewhere" });
    expect(codes(evaluate(wrong, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, latestInSeries: stored(R1) } }))).toEqual(["PREDECESSOR_MISMATCH"]);
  });

  it("cross-week predecessor", () => {
    const week6r2 = buildSyntheticCanonicalArtifact({ week: 6, revision: 2, supersedesArtifactId: "artifact-r1" });
    const preview = evaluate(week6r2, { week: WEEK6, ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, declaredPredecessor: stored(R1) } });
    expect(codes(preview)).toEqual(["REVISION_SKIPPED", "CROSS_WEEK_PREDECESSOR"]);
  });

  it("a series already bound to another RankEyeQ week is blocked", () => {
    expect(codes(evaluate(R2, { ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, latestInSeries: stored(R1, { weekId: "week-5-test" }) } }))).toContain(
      "IMPORTED_FOR_ANOTHER_WEEK",
    );
  });
});

describe("publication transitions", () => {
  it("defines exactly the legal transitions", () => {
    expect(WAIVER_ARTIFACT_TRANSITIONS).toEqual({ NONE: ["ACCEPTED"], ACCEPTED: ["SUPERSEDED", "WITHDRAWN"], SUPERSEDED: ["WITHDRAWN"], WITHDRAWN: [] });
    expect(canRecordWaiverArtifactEvent(null, "ACCEPTED")).toBe(true);
    expect(canRecordWaiverArtifactEvent("ACCEPTED", "WITHDRAWN")).toBe(true);
    expect(canRecordWaiverArtifactEvent("ACCEPTED", "SUPERSEDED")).toBe(true);
    expect(canRecordWaiverArtifactEvent("SUPERSEDED", "WITHDRAWN")).toBe(true);
    for (const to of ["ACCEPTED", "SUPERSEDED", "WITHDRAWN"] as const) expect(canRecordWaiverArtifactEvent("WITHDRAWN", to)).toBe(false);
    expect(canRecordWaiverArtifactEvent("SUPERSEDED", "SUPERSEDED")).toBe(false);
    expect(canRecordWaiverArtifactEvent("SUPERSEDED", "ACCEPTED")).toBe(false);
    expect(canRecordWaiverArtifactEvent("ACCEPTED", "ACCEPTED")).toBe(false);
    expect(canRecordWaiverArtifactEvent(null, "WITHDRAWN")).toBe(false);
  });

  it("no transition ever re-enters ACCEPTED, so a series cannot regain a second ACCEPTED artifact", () => {
    for (const from of ["ACCEPTED", "SUPERSEDED", "WITHDRAWN"] as const) expect(WAIVER_ARTIFACT_TRANSITIONS[from]).not.toContain("ACCEPTED");
  });

  it("a superseded-then-withdrawn predecessor still blocks forks and re-import", () => {
    const r1Stored = stored(R1, { latestState: "WITHDRAWN", latestSequence: 3 });
    const r2Stored = stored(R2);
    const rival = buildSyntheticCanonicalArtifact({ revision: 2, artifactId: "artifact-rival-r2", supersedesArtifactId: "artifact-r1" });
    const fork = evaluate(rival, { mode: "OPERATOR_ATTESTED", ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, atRevision: r2Stored, latestInSeries: r2Stored, declaredPredecessor: r1Stored } });
    expect(codes(fork)).toEqual(["REVISION_CONFLICT"]);
    const replay = evaluate(R1, { mode: "OPERATOR_ATTESTED", ledger: { ...EMPTY_WAIVER_ARTIFACT_LEDGER, byArtifactId: r1Stored, byChecksum: r1Stored, atRevision: r1Stored, latestInSeries: r2Stored } });
    expect(codes(replay)).toEqual(["WITHDRAWN_REIMPORT"]);
  });

  it("withdrawal requires a reason, a source reference and a plausible observation time", () => {
    const acceptedAt = new Date("2026-10-07T15:00:00.000Z");
    expect(waiverArtifactWithdrawalIssues({ reason: "SNG withdrew", sourceReference: "sng-admin://x", sourceObservedAt: new Date("2026-10-07T18:00:00.000Z") }, acceptedAt, NOW)).toEqual([]);
    expect(waiverArtifactWithdrawalIssues({ reason: " ", sourceReference: "", sourceObservedAt: null }, acceptedAt, NOW)).toHaveLength(3);
    expect(waiverArtifactWithdrawalIssues({ reason: "x", sourceReference: "y", sourceObservedAt: new Date("2026-10-07T14:00:00.000Z") }, acceptedAt, NOW)).toHaveLength(1);
  });
});
