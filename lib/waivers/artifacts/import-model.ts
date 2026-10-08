import { createHash } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  WAIVER_ARTIFACT_AUTHORITY_BASIS,
  WAIVER_ARTIFACT_AUTHORITY_LABEL,
  WAIVER_ARTIFACT_IMPORT_ATTESTATION_TEXT,
  WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION,
  type WaiverArtifactAuthorityMode,
} from "@/lib/waivers/artifacts/authority";
import {
  checkSngCanonicalSuccession,
  verifySngCanonicalArtifact,
  type CanonicalArtifactRef,
  type CanonicalArtifactSummary,
  type CanonicalVerificationIssue,
  type CanonicalVerificationResult,
} from "@/lib/waivers/canonical/artifact-verifier";
import { SNG_PUBLICATION_STATES, type SngPublicationState } from "@/lib/waivers/canonical/contract";
import { RANKEYEQ_SNG_TEAM_CROSSWALK_STATUS, RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION } from "@/lib/waivers/canonical/team-crosswalk";

export const WAIVER_ARTIFACT_SOURCE_REFERENCE_MAX = 500;
export const WAIVER_ARTIFACT_REASON_MAX = 1000;
export const WAIVER_ARTIFACT_ID_MAX = 200;

export type WaiverArtifactState = SngPublicationState;

/**
 * Operator-supplied authority evidence. Every field reaches RankEyeQ through
 * the operator; the artifact-derived fields are cross-checked against the
 * verified bytes so a transcription mismatch blocks the import.
 */
export type WaiverArtifactImportEvidence = {
  expectedContentChecksum: string;
  sngArtifactId: string;
  sngRevision: number | null;
  sngAcceptanceId: string;
  sngAcceptedAt: Date | null;
  attestedPublicationState: string;
  sourceReference: string;
  sourceObservedAt: Date | null;
};

export type WaiverArtifactImportInput = { weekId: string; artifactText: string; evidence: WaiverArtifactImportEvidence };

export type WaiverArtifactWeek = { id: string; season: number; weekNumber: number; label: string; isTest: boolean };

/** A locally imported artifact with its latest publication event. */
export type StoredWaiverArtifact = {
  id: string;
  artifactId: string;
  seriesKey: string;
  revision: number;
  supersedesArtifactId: string | null;
  contentChecksum: string;
  weekId: string;
  latestState: WaiverArtifactState;
  latestSequence: number;
};

/** Every local artifact that can collide with or precede the candidate. */
export type WaiverArtifactLedger = {
  byArtifactId: StoredWaiverArtifact | null;
  byChecksum: StoredWaiverArtifact | null;
  atRevision: StoredWaiverArtifact | null;
  latestInSeries: StoredWaiverArtifact | null;
  declaredPredecessor: StoredWaiverArtifact | null;
};

export const EMPTY_WAIVER_ARTIFACT_LEDGER: WaiverArtifactLedger = {
  byArtifactId: null,
  byChecksum: null,
  atRevision: null,
  latestInSeries: null,
  declaredPredecessor: null,
};

export type WaiverArtifactIssue = { level: "BLOCKER" | "ADVISORY"; code: string; message: string; details?: unknown };

export type WaiverArtifactImportStatus = "READY" | "ALREADY_IMPORTED" | "BLOCKED";
export type WaiverArtifactPredecessorAction = "NONE" | "SUPERSEDE" | "PREDECESSOR_WITHDRAWN";

export type WaiverArtifactImportPreview = {
  weekId: string;
  week: WaiverArtifactWeek | null;
  status: WaiverArtifactImportStatus;
  importEnabled: boolean;
  authorityMode: WaiverArtifactAuthorityMode;
  textSha256: string;
  byteLength: number;
  verification: { ok: boolean; issues: CanonicalVerificationIssue[] };
  summary: CanonicalArtifactSummary | null;
  contract: {
    schemaVersion: string;
    serializationVersion: string;
    rulesetCode: string;
    rulesetVersion: number;
    rulesetDefinitionChecksum: string;
    engineVersion: string;
    positionPolicyVersion: string;
    readinessPolicyVersion: string;
  } | null;
  acceptance: { id: string; acceptedAt: string; acceptedById: string; status: string; reason: string } | null;
  succession: {
    latestArtifactId: string | null;
    latestRevision: number | null;
    latestState: WaiverArtifactState | null;
    skippedRevisions: number | null;
    predecessorAction: WaiverArtifactPredecessorAction;
    predecessorRowId: string | null;
    predecessorSequence: number | null;
    existingArtifactRowId: string | null;
  };
  blockers: WaiverArtifactIssue[];
  advisories: WaiverArtifactIssue[];
  previewFingerprint: string;
};

const HEX64 = /^[a-f0-9]{64}$/;

export const waiverArtifactTextSha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export const waiverArtifactByteLength = (text: string) => Buffer.byteLength(text, "utf8");

/** Verifies the text with the authoritative 4A verifier against the target Week and operator evidence. */
export function verifyWaiverArtifactText(input: WaiverArtifactImportInput, week: WaiverArtifactWeek | null): CanonicalVerificationResult {
  const expected = input.evidence.expectedContentChecksum.trim();
  const attested = input.evidence.attestedPublicationState.trim();
  return verifySngCanonicalArtifact(input.artifactText, {
    expectedSeason: week?.season,
    expectedWeek: week?.weekNumber,
    expectedContentChecksum: HEX64.test(expected) ? expected : undefined,
    attestedPublicationState: attested || undefined,
  });
}

const blocker = (code: string, message: string, details?: unknown): WaiverArtifactIssue => ({ level: "BLOCKER", code, message, details });
const advisory = (code: string, message: string, details?: unknown): WaiverArtifactIssue => ({ level: "ADVISORY", code, message, details });

function evidenceIssues(evidence: WaiverArtifactImportEvidence, verified: CanonicalVerificationResult | null, now: Date): WaiverArtifactIssue[] {
  const issues: WaiverArtifactIssue[] = [];
  const missing: string[] = [];
  if (!evidence.expectedContentChecksum.trim()) missing.push("expectedContentChecksum");
  if (!evidence.sngArtifactId.trim()) missing.push("sngArtifactId");
  if (evidence.sngRevision === null) missing.push("sngRevision");
  if (!evidence.sngAcceptanceId.trim()) missing.push("sngAcceptanceId");
  if (!evidence.sngAcceptedAt) missing.push("sngAcceptedAt");
  if (!evidence.attestedPublicationState.trim()) missing.push("attestedPublicationState");
  if (!evidence.sourceReference.trim()) missing.push("sourceReference");
  if (!evidence.sourceObservedAt) missing.push("sourceObservedAt");
  if (missing.length) issues.push(blocker("EVIDENCE_MISSING", "Every SNG acceptance authority field is required", { missing }));

  const expected = evidence.expectedContentChecksum.trim();
  if (expected && !HEX64.test(expected)) issues.push(blocker("EVIDENCE_INVALID", "The expected SHA-256 must be 64 lowercase hex characters"));
  const attested = evidence.attestedPublicationState.trim();
  if (attested && !(SNG_PUBLICATION_STATES as readonly string[]).includes(attested)) {
    issues.push(blocker("EVIDENCE_INVALID", `Attested publication state must be one of ${SNG_PUBLICATION_STATES.join(", ")}`));
  }
  if (evidence.sourceReference.length > WAIVER_ARTIFACT_SOURCE_REFERENCE_MAX) issues.push(blocker("EVIDENCE_INVALID", "The source reference is too long"));
  if (evidence.sourceObservedAt && evidence.sourceObservedAt.getTime() > now.getTime()) {
    issues.push(blocker("SOURCE_OBSERVED_AT_INVALID", "The SNG source observation time is in the future"));
  }

  if (verified?.ok) {
    const { artifact, summary } = verified;
    const mismatched: string[] = [];
    if (evidence.sngArtifactId.trim() && evidence.sngArtifactId.trim() !== summary.artifactId) mismatched.push("sngArtifactId");
    if (evidence.sngRevision !== null && evidence.sngRevision !== summary.revision) mismatched.push("sngRevision");
    if (evidence.sngAcceptanceId.trim() && evidence.sngAcceptanceId.trim() !== artifact.payload.acceptance.id) mismatched.push("sngAcceptanceId");
    if (evidence.sngAcceptedAt && evidence.sngAcceptedAt.getTime() !== Date.parse(summary.acceptedAt)) mismatched.push("sngAcceptedAt");
    if (mismatched.length) issues.push(blocker("EVIDENCE_MISMATCH", "Operator-entered SNG evidence differs from the verified artifact", { mismatched }));
    if (evidence.sourceObservedAt && evidence.sourceObservedAt.getTime() < Date.parse(summary.acceptedAt)) {
      issues.push(blocker("SOURCE_OBSERVED_AT_INVALID", "The SNG source observation precedes the artifact's acceptance"));
    }
  }
  return issues;
}

const ref = (row: StoredWaiverArtifact | CanonicalArtifactSummary): CanonicalArtifactRef => ({
  artifactId: row.artifactId,
  seriesKey: row.seriesKey,
  revision: row.revision,
  supersedesArtifactId: row.supersedesArtifactId,
  contentChecksum: row.contentChecksum,
});

type SuccessionOutcome = {
  blockers: WaiverArtifactIssue[];
  advisories: WaiverArtifactIssue[];
  replayOf: StoredWaiverArtifact | null;
  skippedRevisions: number | null;
  predecessorAction: WaiverArtifactPredecessorAction;
  predecessor: StoredWaiverArtifact | null;
};

/**
 * Relates the candidate to every local artifact it could collide with, then
 * to the latest revision of its series via `checkSngCanonicalSuccession`.
 * Imports must be contiguous: a skipped revision or an unknown predecessor
 * blocks rather than being guessed away.
 */
export function evaluateWaiverArtifactSuccession(summary: CanonicalArtifactSummary, ledger: WaiverArtifactLedger, weekId: string): SuccessionOutcome {
  const out: SuccessionOutcome = { blockers: [], advisories: [], replayOf: null, skippedRevisions: null, predecessorAction: "NONE", predecessor: null };
  const existing = ledger.byArtifactId;
  if (existing) {
    const identical = existing.contentChecksum === summary.contentChecksum && existing.revision === summary.revision && existing.seriesKey === summary.seriesKey;
    if (!identical) {
      out.blockers.push(blocker("ARTIFACT_ID_REUSED", `Artifact ${summary.artifactId} was already imported with different content`));
    } else if (existing.latestState === "WITHDRAWN") {
      out.blockers.push(blocker("WITHDRAWN_REIMPORT", "This artifact was recorded as WITHDRAWN; re-importing it cannot restore it"));
    } else if (existing.weekId !== weekId) {
      out.blockers.push(blocker("IMPORTED_FOR_ANOTHER_WEEK", "This artifact is already imported for a different RankEyeQ week"));
    } else {
      out.replayOf = existing;
      out.skippedRevisions = 0;
    }
    return out;
  }
  if (ledger.byChecksum) {
    out.blockers.push(blocker("CHECKSUM_REUSED", `Identical content was already imported as ${ledger.byChecksum.artifactId}`));
    return out;
  }
  if (ledger.atRevision) {
    out.blockers.push(blocker("REVISION_CONFLICT", `Revision ${summary.revision} of this series was already imported as ${ledger.atRevision.artifactId}`));
    return out;
  }

  const latest = ledger.latestInSeries;
  if (latest && latest.weekId !== weekId) {
    out.blockers.push(blocker("IMPORTED_FOR_ANOTHER_WEEK", "This SNG series is already bound to a different RankEyeQ week"));
  }
  const succession = checkSngCanonicalSuccession(latest ? ref(latest) : null, ref(summary));
  if (!succession.ok) {
    out.blockers.push(blocker(succession.code, succession.detail));
  } else {
    out.skippedRevisions = succession.skippedRevisions;
    if (succession.skippedRevisions > 0) {
      out.blockers.push(blocker("REVISION_SKIPPED", `${succession.skippedRevisions} earlier revision(s) of this series were never imported; import them in order`));
    }
    if (!succession.predecessorKnown && succession.skippedRevisions === 0) {
      out.blockers.push(blocker("PREDECESSOR_NOT_IMPORTED", `Predecessor ${summary.supersedesArtifactId} was never imported`));
    }
  }
  const declared = ledger.declaredPredecessor;
  if (declared && declared.seriesKey !== summary.seriesKey) {
    out.blockers.push(blocker("CROSS_WEEK_PREDECESSOR", `Predecessor ${declared.artifactId} belongs to a different week's series`));
  }
  if (out.blockers.length || !summary.supersedesArtifactId || !latest || latest.artifactId !== summary.supersedesArtifactId) return out;

  out.predecessor = latest;
  if (latest.latestState === "ACCEPTED") {
    out.predecessorAction = "SUPERSEDE";
    out.advisories.push(advisory("SUPERSEDES_PREDECESSOR", `Importing records revision ${latest.revision} (${latest.artifactId}) as SUPERSEDED; its history is preserved`));
  } else if (latest.latestState === "WITHDRAWN") {
    out.predecessorAction = "PREDECESSOR_WITHDRAWN";
    out.advisories.push(advisory("PREDECESSOR_WITHDRAWN", `Predecessor ${latest.artifactId} is WITHDRAWN; it stays withdrawn`));
  } else {
    out.blockers.push(blocker("PREDECESSOR_STATE_INVALID", `Predecessor ${latest.artifactId} is already ${latest.latestState}`));
  }
  return out;
}

function ledgerFingerprintPart(row: StoredWaiverArtifact | null) {
  return row ? [row.id, row.latestSequence, row.latestState] : null;
}

/** Pure import evaluation: verification + evidence + succession + publication authority. */
export function evaluateWaiverArtifactImport(input: {
  request: WaiverArtifactImportInput;
  week: WaiverArtifactWeek | null;
  verification: CanonicalVerificationResult;
  ledger: WaiverArtifactLedger;
  authorityMode: WaiverArtifactAuthorityMode;
  now: Date;
}): WaiverArtifactImportPreview {
  const { request, week, verification, ledger, authorityMode, now } = input;
  const blockers: WaiverArtifactIssue[] = [];
  const advisories: WaiverArtifactIssue[] = [];
  if (!week) blockers.push(blocker("WEEK_NOT_FOUND", "Week not found"));
  if (!verification.ok) {
    blockers.push(blocker("ARTIFACT_INVALID", "The artifact failed canonical verification", { issues: verification.issues }));
  }
  blockers.push(...evidenceIssues(request.evidence, verification, now));

  const summary = verification.ok ? verification.summary : null;
  const succession = summary && week ? evaluateWaiverArtifactSuccession(summary, ledger, week.id) : null;
  if (succession) {
    blockers.push(...succession.blockers);
    advisories.push(...succession.advisories);
  }

  if (authorityMode === "UNVERIFIABLE") {
    blockers.push(
      blocker(
        "PUBLICATION_AUTHORITY_UNVERIFIABLE",
        "SNG publishes no verifiable acceptance receipt; RankEyeQ cannot independently establish publication authority. Import is disabled pending a product decision.",
      ),
    );
  } else {
    advisories.push(
      advisory(
        "OPERATOR_ATTESTED_AUTHORITY",
        `${WAIVER_ARTIFACT_AUTHORITY_LABEL}. Publication authority rests on the importing admin's attestation; the checksum proves the content is unaltered, not who published it.`,
      ),
    );
  }
  advisories.push(advisory("NO_GRADING", "Importing records evidence only; it never grades a contest or replaces grading evidence"));
  if (RANKEYEQ_SNG_TEAM_CROSSWALK_STATUS === "SOURCE_DERIVED_PENDING_PRODUCER_FIXTURE") {
    advisories.push(advisory("CROSSWALK_PENDING_PRODUCER_FIXTURE", `${RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION} awaits SNG producer fixture confirmation`));
  }
  if (week?.isTest) advisories.push(advisory("TEST_WEEK", "The target week is a test week"));
  if (succession?.replayOf) advisories.push(advisory("ALREADY_IMPORTED", "This exact artifact is already imported; applying writes nothing"));

  const status: WaiverArtifactImportStatus = blockers.length ? "BLOCKED" : succession?.replayOf ? "ALREADY_IMPORTED" : "READY";
  const textSha256 = waiverArtifactTextSha256(request.artifactText);
  const evidence = request.evidence;
  const previewFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        v: 1,
        weekId: request.weekId,
        textSha256,
        evidence: {
          expectedContentChecksum: evidence.expectedContentChecksum.trim(),
          sngArtifactId: evidence.sngArtifactId.trim(),
          sngRevision: evidence.sngRevision,
          sngAcceptanceId: evidence.sngAcceptanceId.trim(),
          sngAcceptedAt: evidence.sngAcceptedAt?.toISOString() ?? null,
          attestedPublicationState: evidence.attestedPublicationState.trim(),
          sourceReference: evidence.sourceReference.trim(),
          sourceObservedAt: evidence.sourceObservedAt?.toISOString() ?? null,
        },
        authorityMode,
        verification: verification.ok ? "OK" : verification.issues.map((issue) => issue.code),
        ledger: [ledger.byArtifactId, ledger.byChecksum, ledger.atRevision, ledger.latestInSeries, ledger.declaredPredecessor].map(ledgerFingerprintPart),
        status,
        blockers: blockers.map((issue) => issue.code),
        advisories: advisories.map((issue) => issue.code),
        predecessorAction: succession?.predecessorAction ?? "NONE",
      }),
    )
    .digest("hex");

  const artifact = verification.ok ? verification.artifact : null;
  const latest = ledger.latestInSeries;
  return {
    weekId: request.weekId,
    week,
    status,
    importEnabled: status === "READY",
    authorityMode,
    textSha256,
    byteLength: waiverArtifactByteLength(request.artifactText),
    verification: { ok: verification.ok, issues: verification.ok ? [] : verification.issues },
    summary,
    contract: artifact
      ? {
          schemaVersion: artifact.schemaVersion,
          serializationVersion: artifact.serializationVersion,
          rulesetCode: artifact.payload.ruleset.code,
          rulesetVersion: artifact.payload.ruleset.version,
          rulesetDefinitionChecksum: artifact.payload.ruleset.definitionChecksum,
          engineVersion: artifact.payload.engine.version,
          positionPolicyVersion: artifact.payload.engine.positionPolicyVersion,
          readinessPolicyVersion: artifact.payload.acceptance.readinessPolicyVersion,
        }
      : null,
    acceptance: artifact
      ? {
          id: artifact.payload.acceptance.id,
          acceptedAt: artifact.payload.acceptance.acceptedAt,
          acceptedById: artifact.payload.acceptance.acceptedById,
          status: artifact.payload.acceptance.status,
          reason: artifact.payload.acceptance.reason,
        }
      : null,
    succession: {
      latestArtifactId: latest?.artifactId ?? null,
      latestRevision: latest?.revision ?? null,
      latestState: latest?.latestState ?? null,
      skippedRevisions: succession?.skippedRevisions ?? null,
      predecessorAction: succession?.predecessorAction ?? "NONE",
      predecessorRowId: succession?.predecessor?.id ?? null,
      predecessorSequence: succession?.predecessor?.latestSequence ?? null,
      existingArtifactRowId: succession?.replayOf?.id ?? null,
    },
    blockers,
    advisories,
    previewFingerprint,
  };
}

/** Immutable metadata row for a READY preview of verified bytes. */
export function waiverArtifactRowData(
  verified: Extract<CanonicalVerificationResult, { ok: true }>,
  request: WaiverArtifactImportInput,
  preview: WaiverArtifactImportPreview,
  adminUserId: string,
): Prisma.WaiverCanonicalArtifactUncheckedCreateInput {
  const { artifact, summary } = verified;
  const evidence = request.evidence;
  if (!evidence.sourceObservedAt) throw new Error("sourceObservedAt is required");
  return {
    artifactId: summary.artifactId,
    seriesKey: summary.seriesKey,
    revision: summary.revision,
    supersedesArtifactId: summary.supersedesArtifactId,
    contentChecksum: summary.contentChecksum,
    schemaVersion: artifact.schemaVersion,
    serializationVersion: artifact.serializationVersion,
    rulesetCode: artifact.payload.ruleset.code,
    rulesetVersion: artifact.payload.ruleset.version,
    rulesetDefinitionChecksum: artifact.payload.ruleset.definitionChecksum,
    engineVersion: artifact.payload.engine.version,
    positionPolicyVersion: artifact.payload.engine.positionPolicyVersion,
    readinessPolicyVersion: artifact.payload.acceptance.readinessPolicyVersion,
    acceptanceId: artifact.payload.acceptance.id,
    acceptedAt: new Date(summary.acceptedAt),
    sngAcceptedById: artifact.payload.acceptance.acceptedById,
    generatedAt: new Date(artifact.generatedAt),
    readinessEvidenceChecksum: summary.readinessEvidenceChecksum,
    manifestChecksum: summary.manifestChecksum,
    runFingerprint: summary.runFingerprint,
    inputSetChecksum: summary.inputSetChecksum,
    sourceRevisionFingerprint: summary.sourceRevisionFingerprint,
    season: summary.season,
    weekNumber: summary.week,
    weekId: request.weekId,
    qbFieldSize: summary.fieldSizes.QB,
    rbFieldSize: summary.fieldSizes.RB,
    wrFieldSize: summary.fieldSizes.WR,
    teFieldSize: summary.fieldSizes.TE,
    defFieldSize: summary.fieldSizes.DEF,
    participantCount: summary.participantCount,
    byteLength: preview.byteLength,
    defCrosswalkVersion: RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION,
    expectedContentChecksum: evidence.expectedContentChecksum.trim(),
    attestedPublicationState: "ACCEPTED",
    authorityBasis: WAIVER_ARTIFACT_AUTHORITY_BASIS,
    sourceReference: evidence.sourceReference.trim(),
    sourceObservedAt: evidence.sourceObservedAt,
    attestationVersion: WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION,
    attestationText: WAIVER_ARTIFACT_IMPORT_ATTESTATION_TEXT,
    previewFingerprint: preview.previewFingerprint,
    importedByUserId: adminUserId,
  };
}

/** Basis recorded for each publication event state. */
export const WAIVER_ARTIFACT_EVENT_BASIS = {
  ACCEPTED: "IMPORT_ATTESTATION",
  SUPERSEDED: "SUCCESSOR_IMPORT",
  WITHDRAWN: "OPERATOR_WITHDRAWAL",
} as const satisfies Record<WaiverArtifactState, string>;

/**
 * Legal publication transitions. ACCEPTED is recorded only by import (event
 * 1); SUPERSEDED only by importing the verified successor; WITHDRAWN only by
 * an operator with a reason, from ACCEPTED or from SUPERSEDED (a historical
 * artifact later withdrawn or discredited). WITHDRAWN is terminal. Nothing
 * ever transitions into ACCEPTED, so withdrawing never restores a predecessor
 * and a series can never regain a second ACCEPTED artifact.
 */
export const WAIVER_ARTIFACT_TRANSITIONS: Readonly<Record<WaiverArtifactState | "NONE", readonly WaiverArtifactState[]>> = {
  NONE: ["ACCEPTED"],
  ACCEPTED: ["SUPERSEDED", "WITHDRAWN"],
  SUPERSEDED: ["WITHDRAWN"],
  WITHDRAWN: [],
};

export function canRecordWaiverArtifactEvent(from: WaiverArtifactState | null, to: WaiverArtifactState): boolean {
  return WAIVER_ARTIFACT_TRANSITIONS[from ?? "NONE"].includes(to);
}

export type WaiverArtifactWithdrawalEvidence = { reason: string; sourceReference: string; sourceObservedAt: Date | null };

export function waiverArtifactWithdrawalIssues(evidence: WaiverArtifactWithdrawalEvidence, acceptedAt: Date, now: Date): string[] {
  const issues: string[] = [];
  if (!evidence.reason.trim()) issues.push("A withdrawal reason is required");
  if (evidence.reason.length > WAIVER_ARTIFACT_REASON_MAX) issues.push("The withdrawal reason is too long");
  if (!evidence.sourceReference.trim()) issues.push("An SNG source reference for the withdrawal is required");
  if (evidence.sourceReference.length > WAIVER_ARTIFACT_SOURCE_REFERENCE_MAX) issues.push("The source reference is too long");
  if (!evidence.sourceObservedAt) issues.push("The SNG observation time is required");
  else if (evidence.sourceObservedAt.getTime() > now.getTime()) issues.push("The SNG observation time is in the future");
  else if (evidence.sourceObservedAt.getTime() < acceptedAt.getTime()) issues.push("The SNG observation precedes the artifact's acceptance");
  return issues;
}
