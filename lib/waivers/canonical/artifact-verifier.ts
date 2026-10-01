import type {
  SngCanonicalArtifact,
  SngLedgerRow,
  SngManifest,
  SngManifestEvent,
  SngResultSet,
} from "@/lib/waivers/canonical/artifact-types";
import {
  RANKEYEQ_PLAYER_IDENTITY_PROVIDER,
  SNG_CANONICAL_ARTIFACT_SCHEMA_VERSION,
  SNG_CANONICAL_CHECKSUM_ALGORITHM,
  SNG_CANONICAL_MAX_ARTIFACT_CHARS,
  SNG_CANONICAL_SERIALIZATION_VERSION,
  SNG_COVERAGE_MANIFEST_CONTRACT_VERSION,
  SNG_COVERAGE_MANIFEST_SCOPE,
  SNG_DEF_POINTS_ALLOWED_POLICY,
  SNG_DEFENSE_IDENTITY_PROVIDER,
  SNG_DNP_PROOFS,
  SNG_ENGINE_VERSION,
  SNG_EVENT_DISPOSITIONS,
  SNG_LEAGUE,
  SNG_MAX_SEASON,
  SNG_MAX_WEEK,
  SNG_MIN_SEASON,
  SNG_MIN_WEEK,
  SNG_PARTICIPANT_DISPOSITIONS,
  SNG_PARTICIPANT_KINDS,
  SNG_PARTICIPATION_CHANNELS,
  SNG_PARTICIPATION_PROOFS,
  SNG_PARTICIPATION_STATES,
  SNG_POSITION_POLICY_VERSION,
  SNG_POSITIONS,
  SNG_READINESS_POLICY_VERSION,
  SNG_RULESET_CODE,
  SNG_RULESET_DEFINITION_CHECKSUM,
  SNG_RULESET_VERSION,
  SNG_SCORABLE_PROOFS,
  SNG_SCORABLE_STATES,
  SNG_SEASON_TYPE,
  SNG_SOURCE_FINALITIES,
  SNG_UNRESOLVED_STATES,
  sngSeriesKey,
  type SngPosition,
} from "@/lib/waivers/canonical/contract";
import {
  CanonicalSerializationError,
  canonicalExportChecksum,
  canonicalExportJson,
} from "@/lib/waivers/canonical/serialization";

export const CANONICAL_VERIFICATION_CODES = [
  "ARTIFACT_INPUT_INVALID",
  "ARTIFACT_JSON_INVALID",
  "ARTIFACT_UNSAFE_VALUE",
  "ARTIFACT_NON_CANONICAL_BYTES",
  "CONTENT_CHECKSUM_MISMATCH",
  "EXPECTED_CHECKSUM_MISMATCH",
  "ARTIFACT_NOT_CURRENT",
  "SCHEMA_VERSION_UNSUPPORTED",
  "SERIALIZATION_VERSION_UNSUPPORTED",
  "ENVELOPE_INVALID",
  "SERIES_KEY_MISMATCH",
  "REVISION_STRUCTURE_INVALID",
  "ACCEPTANCE_IDENTITY_MISMATCH",
  "ARTIFACT_NOT_ACCEPTED",
  "READINESS_NOT_READY",
  "WEEK_INVALID",
  "WEEK_MISMATCH",
  "RULESET_PIN_MISMATCH",
  "ENGINE_PIN_MISMATCH",
  "RUN_STATE_INVALID",
  "CONSUMER_CONTRACT_MISMATCH",
  "MANIFEST_INVALID",
  "MANIFEST_CHECKSUM_MISMATCH",
  "LEDGER_INVALID",
  "PARTICIPATION_UNRESOLVED",
  "PARTICIPATION_INVARIANT",
  "DISPOSITION_EVENT_INVARIANT",
  "IDENTITY_CONTRACT_INVALID",
  "DUPLICATE_IDENTITY",
  "RESULT_SETS_INVALID",
  "RESULT_SET_INVALID",
  "EXPORTED_ROWS_CHECKSUM_MISMATCH",
  "FIELD_SIZE_MISMATCH",
  "FIELD_POPULATION_MISMATCH",
  "RESULT_ENTRY_INVALID",
  "POINTS_INVALID",
  "RANK_TIE_INVARIANT",
] as const;
export type CanonicalVerificationCode = (typeof CANONICAL_VERIFICATION_CODES)[number];
export type CanonicalVerificationIssue = { code: CanonicalVerificationCode; detail: string };

export type CanonicalArtifactSummary = {
  artifactId: string;
  seriesKey: string;
  revision: number;
  supersedesArtifactId: string | null;
  contentChecksum: string;
  season: number;
  week: number;
  acceptedAt: string;
  manifestChecksum: string;
  readinessEvidenceChecksum: string;
  runFingerprint: string;
  inputSetChecksum: string;
  sourceRevisionFingerprint: string;
  fieldSizes: Record<SngPosition, number>;
  participantCount: number;
  stateCounts: Record<string, number>;
};

export type VerifiedSngCanonicalArtifact = { artifact: SngCanonicalArtifact; summary: CanonicalArtifactSummary };

export type CanonicalVerificationResult =
  | ({ ok: true } & VerifiedSngCanonicalArtifact)
  | { ok: false; issues: CanonicalVerificationIssue[] };

export type CanonicalVerificationOptions = {
  expectedSeason?: number;
  expectedWeek?: number;
  /** Digest the operator read from the authenticated SNG download (manual review). */
  expectedContentChecksum?: string;
  /** Publication state attested from the download header / SNG UI; bytes never carry it. */
  attestedPublicationState?: string;
};

const MAX_ISSUES = 200;
const HEX64 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type Rec = Record<string, unknown>;

class Issues {
  readonly list: CanonicalVerificationIssue[] = [];
  add(code: CanonicalVerificationCode, detail: string): false {
    if (this.list.length < MAX_ISSUES) this.list.push({ code, detail });
    return false;
  }
  get empty() {
    return this.list.length === 0;
  }
}

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isHex64 = (value: unknown): value is string => typeof value === "string" && HEX64.test(value);
const isIsoUtc = (value: unknown): value is string =>
  typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
const isSafeInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const isPositiveInt = (value: unknown): value is number => isSafeInt(value) && value >= 1;
const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === "string" && (options as readonly string[]).includes(value);
const same = (a: unknown, b: unknown) => canonicalExportJson(a) === canonicalExportJson(b);
const identityKey = (provider: string, externalId: string) => `${provider}\u0000${externalId}`;

function hasExactKeys(value: Rec, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function findUnsafeKey(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findUnsafeKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      if (UNSAFE_KEYS.has(key)) return `${path}.${key}`;
      const hit = findUnsafeKey((value as Rec)[key], `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shape validation (strict key sets; failures stop semantic checks)
// ---------------------------------------------------------------------------

const ENVELOPE_KEYS = [
  "schemaVersion",
  "serializationVersion",
  "artifactId",
  "seriesKey",
  "revision",
  "supersedesArtifactId",
  "generatedAt",
  "contentChecksumAlgorithm",
  "contentChecksum",
  "payload",
] as const;
const PAYLOAD_KEYS = ["week", "ruleset", "engine", "run", "acceptance", "coverage", "events", "sources", "participationLedger", "resultSets"] as const;
const EVIDENCE_KEYS = ["label", "reference", "checksum", "observedAt"] as const;
const IDENTITY_KEYS = ["provider", "externalId", "evidence"] as const;
const PARTICIPANT_KEYS = [
  "participantId",
  "kind",
  "position",
  "eventKey",
  "teamKey",
  "state",
  "disposition",
  "participationProof",
  "channelsReviewed",
  "sourcePosition",
  "eligibilityEvidence",
  "evidence",
  "identities",
] as const;
const LEDGER_KEYS = [...PARTICIPANT_KEYS, "pointsHundredths", "competitionRank"] as const;
const MANIFEST_KEYS = [
  "contractVersion",
  "league",
  "season",
  "seasonType",
  "week",
  "positionPolicyVersion",
  "scheduleEvidence",
  "populationEvidence",
  "scope",
  "channelsReviewed",
  "events",
  "participants",
  "sources",
  "consumerContract",
] as const;
const EVENT_KEYS = [
  "key",
  "homeTeamKey",
  "awayTeamKey",
  "disposition",
  "finalityEvidence",
  "playerParticipantIds",
  "defenseParticipantIds",
  "pointsAllowedEvidence",
] as const;
const RESULT_SET_KEYS = [
  "resultSetId",
  "positionCode",
  "eligibilityPolicyVersion",
  "resultSetChecksum",
  "exportedRowsChecksum",
  "fieldSize",
  "finality",
  "sourceComplete",
  "readinessEvidenceChecksum",
  "entries",
] as const;
const ENTRY_KEYS = [
  "resultKey",
  "participantId",
  "participantKind",
  "canonicalName",
  "externalIdentities",
  "canonicalPosition",
  "teamKey",
  "eventKey",
  "opponentTeamKey",
  "participationState",
  "sourceFinality",
  "pointsHundredths",
  "competitionRank",
  "tieGroupKey",
  "tieGroupSize",
  "displayOrdinal",
  "derivedPerformanceId",
  "resultFingerprint",
  "inputSnapshotId",
  "inputChecksum",
  "sourceRevisionFingerprint",
  "eligibilityEvidence",
  "performanceEvidence",
] as const;

function isEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, EVIDENCE_KEYS) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.reference) &&
    isHex64(value.checksum) &&
    isIsoUtc(value.observedAt)
  );
}

function isIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, IDENTITY_KEYS) &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.externalId) &&
    isEvidence(value.evidence)
  );
}

function isChannelList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((channel) => isOneOf(channel, SNG_PARTICIPATION_CHANNELS));
}

function participantFieldsValid(value: Rec): boolean {
  return (
    isNonEmptyString(value.participantId) &&
    isOneOf(value.kind, SNG_PARTICIPANT_KINDS) &&
    isOneOf(value.position, SNG_POSITIONS) &&
    (value.eventKey === null || isNonEmptyString(value.eventKey)) &&
    isNonEmptyString(value.teamKey) &&
    isOneOf(value.state, SNG_PARTICIPATION_STATES) &&
    isOneOf(value.disposition, SNG_PARTICIPANT_DISPOSITIONS) &&
    isOneOf(value.participationProof, SNG_PARTICIPATION_PROOFS) &&
    isChannelList(value.channelsReviewed) &&
    isNonEmptyString(value.sourcePosition) &&
    isEvidence(value.eligibilityEvidence) &&
    (value.evidence === null || isEvidence(value.evidence)) &&
    Array.isArray(value.identities) &&
    value.identities.every(isIdentity)
  );
}

function checkManifestShape(value: unknown, issues: Issues): value is SngManifest {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) return issues.add("MANIFEST_INVALID", "coverage.manifest has an unexpected shape");
  let ok = true;
  if (
    !isEvidence(value.scheduleEvidence) ||
    !isEvidence(value.populationEvidence) ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    !value.sources.every(isEvidence) ||
    !isChannelList(value.channelsReviewed)
  ) {
    ok = issues.add("MANIFEST_INVALID", "manifest evidence, sources or channels are malformed");
  }
  const contract = value.consumerContract;
  if (
    !isRecord(contract) ||
    !hasExactKeys(contract, ["playerProvider", "defenseProvider", "evidence"]) ||
    !isNonEmptyString(contract.playerProvider) ||
    !isNonEmptyString(contract.defenseProvider) ||
    !isEvidence(contract.evidence)
  ) {
    ok = issues.add("MANIFEST_INVALID", "manifest.consumerContract is malformed");
  }
  if (!Array.isArray(value.events) || value.events.length === 0) {
    ok = issues.add("MANIFEST_INVALID", "manifest.events must be a non-empty array");
  } else {
    value.events.forEach((event, index) => {
      const valid =
        isRecord(event) &&
        hasExactKeys(event, EVENT_KEYS) &&
        isNonEmptyString(event.key) &&
        isNonEmptyString(event.homeTeamKey) &&
        isNonEmptyString(event.awayTeamKey) &&
        isOneOf(event.disposition, SNG_EVENT_DISPOSITIONS) &&
        isEvidence(event.finalityEvidence) &&
        Array.isArray(event.playerParticipantIds) &&
        event.playerParticipantIds.every(isNonEmptyString) &&
        Array.isArray(event.defenseParticipantIds) &&
        event.defenseParticipantIds.every(isNonEmptyString) &&
        Array.isArray(event.pointsAllowedEvidence) &&
        event.pointsAllowedEvidence.every(
          (row) =>
            isRecord(row) &&
            hasExactKeys(row, ["participantId", "pointsAllowed", "evidence"]) &&
            isNonEmptyString(row.participantId) &&
            isSafeInt(row.pointsAllowed) &&
            row.pointsAllowed >= 0 &&
            isEvidence(row.evidence),
        );
      if (!valid) ok = issues.add("MANIFEST_INVALID", `manifest.events[${index}] is malformed`);
    });
  }
  if (!Array.isArray(value.participants) || value.participants.length === 0) {
    ok = issues.add("MANIFEST_INVALID", "manifest.participants must be a non-empty array");
  } else {
    value.participants.forEach((participant, index) => {
      if (!isRecord(participant) || !hasExactKeys(participant, PARTICIPANT_KEYS) || !participantFieldsValid(participant)) {
        ok = issues.add("MANIFEST_INVALID", `manifest.participants[${index}] is malformed`);
      }
    });
  }
  return ok;
}

function checkLedgerShape(value: unknown, issues: Issues): value is SngLedgerRow[] {
  if (!Array.isArray(value)) return issues.add("LEDGER_INVALID", "participationLedger must be an array");
  let ok = true;
  value.forEach((row, index) => {
    const valid =
      isRecord(row) &&
      hasExactKeys(row, LEDGER_KEYS) &&
      participantFieldsValid(row) &&
      (row.pointsHundredths === null || typeof row.pointsHundredths === "number") &&
      (row.competitionRank === null || typeof row.competitionRank === "number");
    if (!valid) ok = issues.add("LEDGER_INVALID", `participationLedger[${index}] is malformed`);
  });
  return ok;
}

function checkResultSetsShape(value: unknown, issues: Issues): value is SngResultSet[] {
  if (!Array.isArray(value) || value.length !== SNG_POSITIONS.length) {
    return issues.add("RESULT_SETS_INVALID", `exactly ${SNG_POSITIONS.length} result sets are required`);
  }
  let ok = true;
  value.forEach((set, index) => {
    if (!isRecord(set) || !hasExactKeys(set, RESULT_SET_KEYS) || !Array.isArray(set.entries)) {
      ok = issues.add("RESULT_SETS_INVALID", `resultSets[${index}] has an unexpected shape`);
      return;
    }
    if (set.positionCode !== SNG_POSITIONS[index]) {
      ok = issues.add("RESULT_SETS_INVALID", `resultSets[${index}] must be ${SNG_POSITIONS[index]} (got ${String(set.positionCode)})`);
    }
    set.entries.forEach((entry, entryIndex) => {
      const where = `${String(set.positionCode)} entries[${entryIndex}]`;
      if (!isRecord(entry) || !hasExactKeys(entry, ENTRY_KEYS)) {
        ok = issues.add("RESULT_ENTRY_INVALID", `${where} has an unexpected shape`);
        return;
      }
      const valid =
        isNonEmptyString(entry.resultKey) &&
        isNonEmptyString(entry.participantId) &&
        isOneOf(entry.participantKind, SNG_PARTICIPANT_KINDS) &&
        isNonEmptyString(entry.canonicalName) &&
        Array.isArray(entry.externalIdentities) &&
        entry.externalIdentities.every(isIdentity) &&
        isOneOf(entry.canonicalPosition, SNG_POSITIONS) &&
        isNonEmptyString(entry.teamKey) &&
        isNonEmptyString(entry.eventKey) &&
        isNonEmptyString(entry.opponentTeamKey) &&
        isOneOf(entry.participationState, SNG_PARTICIPATION_STATES) &&
        typeof entry.sourceFinality === "string" &&
        isHex64(entry.tieGroupKey) &&
        isNonEmptyString(entry.derivedPerformanceId) &&
        isHex64(entry.resultFingerprint) &&
        isNonEmptyString(entry.inputSnapshotId) &&
        isHex64(entry.inputChecksum) &&
        isHex64(entry.sourceRevisionFingerprint) &&
        isRecord(entry.eligibilityEvidence) &&
        isRecord(entry.performanceEvidence);
      if (!valid) ok = issues.add("RESULT_ENTRY_INVALID", `${where} has malformed fields`);
      for (const field of ["pointsHundredths", "competitionRank", "tieGroupSize", "displayOrdinal"] as const) {
        if (!isSafeInt(entry[field])) ok = issues.add("POINTS_INVALID", `${where}.${field} must be a safe integer`);
      }
    });
  });
  return ok;
}

// ---------------------------------------------------------------------------
// Semantic validation
// ---------------------------------------------------------------------------

function checkEnvelopeSemantics(a: SngCanonicalArtifact, manifest: SngManifest, issues: Issues, options: CanonicalVerificationOptions) {
  const { payload } = a;
  if (a.contentChecksumAlgorithm !== SNG_CANONICAL_CHECKSUM_ALGORITHM) issues.add("ENVELOPE_INVALID", "contentChecksumAlgorithm must be SHA-256");
  if (!isNonEmptyString(a.artifactId)) issues.add("ENVELOPE_INVALID", "artifactId is required");
  if (!isIsoUtc(a.generatedAt)) issues.add("ENVELOPE_INVALID", "generatedAt must be an ISO UTC instant");

  if (!isPositiveInt(a.revision)) {
    issues.add("REVISION_STRUCTURE_INVALID", "revision must be a positive integer");
  } else if (a.revision === 1 && a.supersedesArtifactId !== null) {
    issues.add("REVISION_STRUCTURE_INVALID", "revision 1 cannot supersede an artifact");
  } else if (a.revision > 1 && (!isNonEmptyString(a.supersedesArtifactId) || a.supersedesArtifactId === a.artifactId)) {
    issues.add("REVISION_STRUCTURE_INVALID", `revision ${a.revision} must supersede a distinct predecessor artifact`);
  }

  const week = payload.week;
  if (
    !isRecord(week) ||
    !hasExactKeys(week, ["league", "season", "seasonType", "week"]) ||
    week.league !== SNG_LEAGUE ||
    week.seasonType !== SNG_SEASON_TYPE ||
    !isSafeInt(week.season) ||
    week.season < SNG_MIN_SEASON ||
    week.season > SNG_MAX_SEASON ||
    !isSafeInt(week.week) ||
    week.week < SNG_MIN_WEEK ||
    week.week > SNG_MAX_WEEK ||
    manifest.league !== SNG_LEAGUE ||
    manifest.seasonType !== SNG_SEASON_TYPE ||
    week.season !== manifest.season ||
    week.week !== manifest.week
  ) {
    issues.add("WEEK_INVALID", "payload.week must be a supported NFL REG week matching the reviewed manifest");
  } else {
    if (options.expectedSeason !== undefined && week.season !== options.expectedSeason) {
      issues.add("WEEK_MISMATCH", `artifact season ${week.season} is not the expected ${options.expectedSeason}`);
    }
    if (options.expectedWeek !== undefined && week.week !== options.expectedWeek) {
      issues.add("WEEK_MISMATCH", `artifact week ${week.week} is not the expected ${options.expectedWeek}`);
    }
    if (a.seriesKey !== sngSeriesKey(week.season, week.week)) {
      issues.add("SERIES_KEY_MISMATCH", `seriesKey must be ${sngSeriesKey(week.season, week.week)}`);
    }
  }

  const ruleset = payload.ruleset;
  if (
    !isRecord(ruleset) ||
    !hasExactKeys(ruleset, ["status", "code", "version", "definition", "definitionChecksum", "minimumEngineVersion"]) ||
    ruleset.status !== "ACTIVE" ||
    ruleset.code !== SNG_RULESET_CODE ||
    ruleset.version !== SNG_RULESET_VERSION ||
    ruleset.definitionChecksum !== SNG_RULESET_DEFINITION_CHECKSUM ||
    ruleset.minimumEngineVersion !== SNG_ENGINE_VERSION ||
    !isRecord(ruleset.definition)
  ) {
    issues.add("RULESET_PIN_MISMATCH", `ruleset must be ACTIVE ${SNG_RULESET_CODE}@${SNG_RULESET_VERSION} with the approved checksum`);
  }

  const engine = payload.engine;
  if (
    !isRecord(engine) ||
    !hasExactKeys(engine, ["version", "positionPolicyVersion"]) ||
    engine.version !== SNG_ENGINE_VERSION ||
    engine.positionPolicyVersion !== SNG_POSITION_POLICY_VERSION ||
    manifest.positionPolicyVersion !== SNG_POSITION_POLICY_VERSION
  ) {
    issues.add("ENGINE_PIN_MISMATCH", `engine must be ${SNG_ENGINE_VERSION} with policy ${SNG_POSITION_POLICY_VERSION}`);
  }

  const run = payload.run;
  if (
    !isRecord(run) ||
    !hasExactKeys(run, ["scoringRunId", "mode", "status", "runFingerprint", "inputSetChecksum", "sourceRevisionFingerprint"]) ||
    !isNonEmptyString(run.scoringRunId) ||
    run.mode !== "SHADOW" ||
    run.status !== "COMPLETED" ||
    !isHex64(run.runFingerprint) ||
    !isHex64(run.inputSetChecksum) ||
    !isHex64(run.sourceRevisionFingerprint)
  ) {
    issues.add("RUN_STATE_INVALID", "run must be a COMPLETED SHADOW calculation with lineage checksums");
  }

  const readiness = payload.coverage.readiness;
  const readinessOk =
    isRecord(readiness) &&
    readiness.ready === true &&
    Array.isArray(readiness.blockers) &&
    readiness.blockers.length === 0 &&
    isHex64(readiness.evidenceChecksum);
  if (!readinessOk) issues.add("READINESS_NOT_READY", "coverage.readiness must be ready with zero blockers");

  const acceptance = payload.acceptance;
  if (
    !isRecord(acceptance) ||
    !hasExactKeys(acceptance, [
      "id",
      "seriesKey",
      "revision",
      "supersedesId",
      "acceptedById",
      "acceptedAt",
      "reason",
      "manifestChecksum",
      "status",
      "readinessPolicyVersion",
      "readinessEvidenceChecksum",
    ])
  ) {
    issues.add("ACCEPTANCE_IDENTITY_MISMATCH", "payload.acceptance has an unexpected shape");
    return;
  }
  if (acceptance.status !== "ACCEPTED") issues.add("ARTIFACT_NOT_ACCEPTED", `acceptance.status is ${String(acceptance.status)}`);
  if (
    acceptance.id !== a.artifactId ||
    acceptance.seriesKey !== a.seriesKey ||
    acceptance.revision !== a.revision ||
    acceptance.supersedesId !== a.supersedesArtifactId ||
    acceptance.acceptedAt !== a.generatedAt ||
    !isIsoUtc(acceptance.acceptedAt) ||
    !isNonEmptyString(acceptance.acceptedById) ||
    !isNonEmptyString(acceptance.reason)
  ) {
    issues.add("ACCEPTANCE_IDENTITY_MISMATCH", "acceptance must restate the envelope artifact, series, revision, predecessor and time");
  }
  if (acceptance.readinessPolicyVersion !== SNG_READINESS_POLICY_VERSION) {
    issues.add("READINESS_NOT_READY", `readinessPolicyVersion must be ${SNG_READINESS_POLICY_VERSION}`);
  }
  if (readinessOk && acceptance.readinessEvidenceChecksum !== readiness.evidenceChecksum) {
    issues.add("READINESS_NOT_READY", "acceptance readiness checksum differs from coverage readiness");
  }
  if (acceptance.manifestChecksum !== canonicalExportChecksum(manifest)) {
    issues.add("MANIFEST_CHECKSUM_MISMATCH", "acceptance.manifestChecksum does not match the embedded manifest");
  }
}

function checkManifestSemantics(manifest: SngManifest, issues: Issues) {
  if (manifest.contractVersion !== SNG_COVERAGE_MANIFEST_CONTRACT_VERSION || manifest.scope !== SNG_COVERAGE_MANIFEST_SCOPE) {
    issues.add("MANIFEST_INVALID", "unsupported manifest contract version or scope");
  }
  const allChannels = (channels: string[]) =>
    channels.length === SNG_PARTICIPATION_CHANNELS.length && SNG_PARTICIPATION_CHANNELS.every((c) => channels.includes(c));
  if (!allChannels(manifest.channelsReviewed)) issues.add("MANIFEST_INVALID", "all participation channels must be reviewed");
  if (manifest.consumerContract.playerProvider !== RANKEYEQ_PLAYER_IDENTITY_PROVIDER) {
    issues.add("CONSUMER_CONTRACT_MISMATCH", `playerProvider must be ${RANKEYEQ_PLAYER_IDENTITY_PROVIDER}`);
  }
  if (manifest.consumerContract.defenseProvider !== SNG_DEFENSE_IDENTITY_PROVIDER) {
    issues.add("CONSUMER_CONTRACT_MISMATCH", `defenseProvider must be ${SNG_DEFENSE_IDENTITY_PROVIDER}`);
  }
  const eventKeys = manifest.events.map((event) => event.key);
  if (new Set(eventKeys).size !== eventKeys.length) issues.add("MANIFEST_INVALID", "event keys must be unique");
  const participantIds = manifest.participants.map((p) => p.participantId);
  if (new Set(participantIds).size !== participantIds.length) issues.add("MANIFEST_INVALID", "participant IDs must be unique");
  for (const event of manifest.events) {
    if (event.homeTeamKey === event.awayTeamKey) issues.add("MANIFEST_INVALID", `${event.key}: home and away teams must differ`);
    if (
      event.disposition !== "PLAYED" &&
      (event.playerParticipantIds.length || event.defenseParticipantIds.length || event.pointsAllowedEvidence.length)
    ) {
      issues.add("DISPOSITION_EVENT_INVARIANT", `${event.key}: ${event.disposition} event cannot carry participation facts`);
    }
  }
}

function checkParticipation(row: SngLedgerRow, events: Map<string, SngManifestEvent>, playedEvents: SngManifestEvent[], issues: Issues) {
  const id = row.participantId;
  const scorable = SNG_SCORABLE_STATES.has(row.state);
  if (SNG_UNRESOLVED_STATES.has(row.state)) {
    issues.add("PARTICIPATION_UNRESOLVED", `${id}: ${row.state} cannot appear in an accepted artifact`);
    return;
  }
  if ((row.kind === "TEAM_DEFENSE") !== (row.position === "DEF")) {
    issues.add("PARTICIPATION_INVARIANT", `${id}: TEAM_DEFENSE must be exactly the DEF position`);
  }
  if (row.evidence === null) issues.add("PARTICIPATION_INVARIANT", `${id}: participation evidence is required`);
  if (scorable) {
    const channelsComplete =
      row.channelsReviewed.length === SNG_PARTICIPATION_CHANNELS.length &&
      SNG_PARTICIPATION_CHANNELS.every((c) => row.channelsReviewed.includes(c));
    if (row.disposition !== "PLAYED" || !SNG_SCORABLE_PROOFS.has(row.participationProof) || !channelsComplete || row.eventKey === null) {
      issues.add("PARTICIPATION_INVARIANT", `${id}: scorable participation requires PLAYED with complete factual proof`);
    }
    if (!isSafeInt(row.pointsHundredths)) issues.add("POINTS_INVALID", `${id}: scorable pointsHundredths must be a safe integer`);
    if (!isPositiveInt(row.competitionRank)) issues.add("PARTICIPATION_INVARIANT", `${id}: scorable competitionRank must be a positive integer`);
  } else {
    if (row.pointsHundredths !== null || row.competitionRank !== null) {
      issues.add("PARTICIPATION_INVARIANT", `${id}: VERIFIED_NON_PARTICIPANT must have null points and null rank`);
    }
    if (row.disposition === "PLAYED" || row.disposition === "UNRESOLVED") {
      issues.add("PARTICIPATION_INVARIANT", `${id}: VERIFIED_NON_PARTICIPANT cannot be ${row.disposition}`);
    } else if (row.disposition === "DNP" ? !SNG_DNP_PROOFS.has(row.participationProof) : row.participationProof !== "WEEK_DISPOSITION") {
      issues.add("PARTICIPATION_INVARIANT", `${id}: ${row.disposition} is not affirmed by ${row.participationProof}`);
    }
  }

  const event = row.eventKey === null ? undefined : events.get(row.eventKey);
  if (row.eventKey !== null && !event) {
    issues.add("DISPOSITION_EVENT_INVARIANT", `${id}: event ${row.eventKey} is not in the manifest`);
    return;
  }
  const inEvent = (e: SngManifestEvent | undefined) => !!e && (e.homeTeamKey === row.teamKey || e.awayTeamKey === row.teamKey);
  if ((scorable || row.disposition === "DNP") && !(event?.disposition === "PLAYED" && inEvent(event))) {
    issues.add("DISPOSITION_EVENT_INVARIANT", `${id}: ${row.disposition} requires a PLAYED event for team ${row.teamKey}`);
  }
  if (scorable && event) {
    const list = row.kind === "PLAYER" ? event.playerParticipantIds : event.defenseParticipantIds;
    if (!list.includes(id)) issues.add("DISPOSITION_EVENT_INVARIANT", `${id}: missing from event ${event.key} participant population`);
  }
  if (row.disposition === "CANCELLED_GAME" && event?.disposition !== "CANCELLED") {
    issues.add("DISPOSITION_EVENT_INVARIANT", `${id}: CANCELLED_GAME requires a CANCELLED event`);
  }
  if (row.disposition === "MOVED_OUT_OF_WEEK" && event?.disposition !== "MOVED_OUT_OF_WEEK") {
    issues.add("DISPOSITION_EVENT_INVARIANT", `${id}: MOVED_OUT_OF_WEEK requires a MOVED_OUT_OF_WEEK event`);
  }
  if (row.disposition === "BYE" && playedEvents.some((e) => inEvent(e))) {
    issues.add("DISPOSITION_EVENT_INVARIANT", `${id}: BYE conflicts with a PLAYED event for team ${row.teamKey}`);
  }
}

function checkLedgerSemantics(ledger: SngLedgerRow[], manifest: SngManifest, issues: Issues) {
  if (ledger.length !== manifest.participants.length) {
    issues.add("LEDGER_INVALID", `ledger has ${ledger.length} rows; manifest has ${manifest.participants.length} participants`);
  }
  for (let i = 1; i < ledger.length; i += 1) {
    if (!(ledger[i - 1].participantId < ledger[i].participantId)) {
      issues.add("LEDGER_INVALID", "ledger must be strictly ordered by participantId (UTF-16 code units)");
      break;
    }
  }
  const byId = new Map(manifest.participants.map((p) => [p.participantId, p]));
  for (const row of ledger) {
    const proof = byId.get(row.participantId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pointsHundredths, competitionRank, ...participant } = row;
    if (!proof || !same(participant, proof)) {
      issues.add("LEDGER_INVALID", `${row.participantId}: ledger row does not restate its manifest participant`);
    }
  }

  const events = new Map(manifest.events.map((e) => [e.key, e]));
  const playedEvents = manifest.events.filter((e) => e.disposition === "PLAYED");
  const seenIdentities = new Map<string, string>();
  for (const row of ledger) {
    checkParticipation(row, events, playedEvents, issues);
    const contractProvider = row.kind === "PLAYER" ? RANKEYEQ_PLAYER_IDENTITY_PROVIDER : SNG_DEFENSE_IDENTITY_PROVIDER;
    const contractIdentities = row.identities.filter((identity) => identity.provider === contractProvider);
    if (contractIdentities.length !== 1) {
      issues.add("IDENTITY_CONTRACT_INVALID", `${row.participantId}: exactly one ${contractProvider} identity is required (found ${contractIdentities.length})`);
    } else if (row.kind === "TEAM_DEFENSE" && contractIdentities[0].externalId !== row.teamKey) {
      issues.add("IDENTITY_CONTRACT_INVALID", `${row.participantId}: TEAM_DEFENSE externalId must equal teamKey`);
    }
    for (const identity of row.identities) {
      const key = identityKey(identity.provider, identity.externalId);
      const owner = seenIdentities.get(key);
      if (owner !== undefined) {
        issues.add("DUPLICATE_IDENTITY", `${identity.provider}:${identity.externalId} maps to ${owner} and ${row.participantId}`);
      } else {
        seenIdentities.set(key, row.participantId);
      }
    }
  }
}

function checkResultSetSemantics(sets: SngResultSet[], ledger: SngLedgerRow[], manifest: SngManifest, readinessChecksum: string, issues: Issues) {
  const ledgerById = new Map(ledger.map((row) => [row.participantId, row]));
  const events = new Map(manifest.events.map((e) => [e.key, e]));
  for (const set of sets) {
    const position = set.positionCode;
    if (
      !isNonEmptyString(set.resultSetId) ||
      set.eligibilityPolicyVersion !== SNG_POSITION_POLICY_VERSION ||
      !isHex64(set.resultSetChecksum) ||
      set.finality !== "FINAL" ||
      set.sourceComplete !== true ||
      set.readinessEvidenceChecksum !== readinessChecksum
    ) {
      issues.add("RESULT_SET_INVALID", `${position}: result set must be FINAL, source-complete, pinned to the policy and the accepted readiness`);
    }
    if (!isHex64(set.exportedRowsChecksum) || set.exportedRowsChecksum !== canonicalExportChecksum(set.entries)) {
      issues.add("EXPORTED_ROWS_CHECKSUM_MISMATCH", `${position}: exportedRowsChecksum does not match the exported rows`);
    }
    if (!isSafeInt(set.fieldSize) || set.fieldSize !== set.entries.length) {
      issues.add("FIELD_SIZE_MISMATCH", `${position}: fieldSize ${String(set.fieldSize)} differs from ${set.entries.length} entries`);
    }
    const expected = ledger.filter((row) => row.position === position && SNG_SCORABLE_STATES.has(row.state)).map((row) => row.participantId);
    const actual = set.entries.map((entry) => entry.participantId);
    const actualSet = new Set(actual);
    if (actualSet.size !== actual.length || expected.length !== actual.length || expected.some((id) => !actualSet.has(id))) {
      issues.add("FIELD_POPULATION_MISMATCH", `${position}: entries must be exactly the ${expected.length} scorable ${position} participants`);
    }

    const tieKeyByPoints = new Map<number, string>();
    const pointsByTieKey = new Map<string, number>();
    set.entries.forEach((entry, index) => {
      const where = `${position}:${entry.participantId}`;
      const row = ledgerById.get(entry.participantId);
      if (!row) {
        issues.add("RESULT_ENTRY_INVALID", `${where}: not in the participation ledger`);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { pointsHundredths, competitionRank, ...participant } = row;
      const event = events.get(entry.eventKey);
      const opponent = event ? (event.homeTeamKey === entry.teamKey ? event.awayTeamKey : event.homeTeamKey) : null;
      if (
        entry.resultKey !== `${position}:${entry.participantId}` ||
        entry.canonicalPosition !== position ||
        row.position !== position ||
        entry.participantKind !== row.kind ||
        entry.teamKey !== row.teamKey ||
        entry.eventKey !== row.eventKey ||
        entry.participationState !== row.state ||
        !same(entry.externalIdentities, row.identities) ||
        !same(entry.eligibilityEvidence, participant) ||
        entry.opponentTeamKey !== opponent ||
        !isOneOf(entry.sourceFinality, SNG_SOURCE_FINALITIES)
      ) {
        issues.add("RESULT_ENTRY_INVALID", `${where}: entry does not restate its ledger participant, event or finality`);
      }
      if (entry.pointsHundredths !== row.pointsHundredths || entry.competitionRank !== row.competitionRank) {
        issues.add("RESULT_ENTRY_INVALID", `${where}: points/rank differ from the participation ledger`);
      }
      if (row.kind === "TEAM_DEFENSE" && entry.performanceEvidence.pointsAllowedPolicy !== SNG_DEF_POINTS_ALLOWED_POLICY) {
        issues.add("RESULT_ENTRY_INVALID", `${where}: DEF pointsAllowedPolicy must be ${SNG_DEF_POINTS_ALLOWED_POLICY}`);
      }

      const better = set.entries.filter((other) => other.pointsHundredths > entry.pointsHundredths).length;
      const tied = set.entries.filter((other) => other.pointsHundredths === entry.pointsHundredths).length;
      const previous = index > 0 ? set.entries[index - 1] : null;
      if (
        entry.displayOrdinal !== index + 1 ||
        (previous !== null && previous.pointsHundredths < entry.pointsHundredths) ||
        entry.competitionRank !== better + 1 ||
        entry.tieGroupSize !== tied
      ) {
        issues.add("RANK_TIE_INVARIANT", `${where}: competition rank/tie/order does not follow integer points`);
      }
      const knownKey = tieKeyByPoints.get(entry.pointsHundredths);
      const knownPoints = pointsByTieKey.get(entry.tieGroupKey);
      if ((knownKey !== undefined && knownKey !== entry.tieGroupKey) || (knownPoints !== undefined && knownPoints !== entry.pointsHundredths)) {
        issues.add("RANK_TIE_INVARIANT", `${where}: tieGroupKey must identify exactly one points value`);
      }
      tieKeyByPoints.set(entry.pointsHundredths, entry.tieGroupKey);
      pointsByTieKey.set(entry.tieGroupKey, entry.pointsHundredths);
    });
  }
}

function summarize(a: SngCanonicalArtifact): CanonicalArtifactSummary {
  const fieldSizes = Object.fromEntries(a.payload.resultSets.map((set) => [set.positionCode, set.fieldSize])) as Record<SngPosition, number>;
  const stateCounts: Record<string, number> = {};
  for (const row of a.payload.participationLedger) stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1;
  return {
    artifactId: a.artifactId,
    seriesKey: a.seriesKey,
    revision: a.revision,
    supersedesArtifactId: a.supersedesArtifactId,
    contentChecksum: a.contentChecksum,
    season: a.payload.week.season,
    week: a.payload.week.week,
    acceptedAt: a.payload.acceptance.acceptedAt,
    manifestChecksum: a.payload.acceptance.manifestChecksum,
    readinessEvidenceChecksum: a.payload.acceptance.readinessEvidenceChecksum,
    runFingerprint: a.payload.run.runFingerprint,
    inputSetChecksum: a.payload.run.inputSetChecksum,
    sourceRevisionFingerprint: a.payload.run.sourceRevisionFingerprint,
    fieldSizes,
    participantCount: a.payload.participationLedger.length,
    stateCounts,
  };
}

/**
 * Verifies exported artifact text against the consumer contract. Integrity
 * failures (bytes, canonical form, digest) stop immediately; structural and
 * semantic checks then collect every issue. Points are trusted SNG output:
 * nothing here re-scores facts or recomputes SNG's opaque inner fingerprints.
 */
export function verifySngCanonicalArtifact(bytes: unknown, options: CanonicalVerificationOptions = {}): CanonicalVerificationResult {
  const issues = new Issues();
  const fail = () => ({ ok: false as const, issues: issues.list });

  if (typeof bytes !== "string" || bytes.length === 0 || bytes.length > SNG_CANONICAL_MAX_ARTIFACT_CHARS || bytes.charCodeAt(0) === 0xfeff) {
    issues.add("ARTIFACT_INPUT_INVALID", "artifact must be non-empty canonical JSON text without a byte-order mark");
    return fail();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes);
  } catch {
    issues.add("ARTIFACT_JSON_INVALID", "artifact is not valid JSON");
    return fail();
  }
  const unsafeKey = findUnsafeKey(raw, "$");
  if (unsafeKey) {
    issues.add("ARTIFACT_UNSAFE_VALUE", `unsafe object key at ${unsafeKey}`);
    return fail();
  }
  let canonical: string;
  try {
    canonical = canonicalExportJson(raw);
  } catch (error) {
    if (!(error instanceof CanonicalSerializationError)) throw error;
    issues.add("ARTIFACT_UNSAFE_VALUE", error.message);
    return fail();
  }
  if (canonical !== bytes) {
    issues.add("ARTIFACT_NON_CANONICAL_BYTES", `artifact text is not ${SNG_CANONICAL_SERIALIZATION_VERSION} serialization`);
    return fail();
  }
  if (!isRecord(raw) || !isHex64(raw.contentChecksum)) {
    issues.add("ENVELOPE_INVALID", "artifact must be an object with a lowercase SHA-256 contentChecksum");
    return fail();
  }
  const { contentChecksum, ...body } = raw;
  if (canonicalExportChecksum(body) !== contentChecksum) {
    issues.add("CONTENT_CHECKSUM_MISMATCH", "contentChecksum does not match the canonical envelope");
    return fail();
  }
  if (options.expectedContentChecksum !== undefined && options.expectedContentChecksum !== contentChecksum) {
    issues.add("EXPECTED_CHECKSUM_MISMATCH", "artifact digest differs from the operator-entered digest");
    return fail();
  }
  if (options.attestedPublicationState !== undefined && options.attestedPublicationState !== "ACCEPTED") {
    issues.add("ARTIFACT_NOT_CURRENT", `attested publication state is ${options.attestedPublicationState}, not ACCEPTED`);
  }

  if (raw.schemaVersion !== SNG_CANONICAL_ARTIFACT_SCHEMA_VERSION) {
    issues.add("SCHEMA_VERSION_UNSUPPORTED", `schemaVersion must be ${SNG_CANONICAL_ARTIFACT_SCHEMA_VERSION}`);
    return fail();
  }
  if (raw.serializationVersion !== SNG_CANONICAL_SERIALIZATION_VERSION) {
    issues.add("SERIALIZATION_VERSION_UNSUPPORTED", `serializationVersion must be ${SNG_CANONICAL_SERIALIZATION_VERSION}`);
    return fail();
  }
  if (!hasExactKeys(raw, ENVELOPE_KEYS) || !isRecord(raw.payload) || !hasExactKeys(raw.payload, PAYLOAD_KEYS)) {
    issues.add("ENVELOPE_INVALID", "envelope or payload has an unexpected key set");
    return fail();
  }
  const payload = raw.payload;
  if (!isRecord(payload.coverage) || !hasExactKeys(payload.coverage, ["manifest", "readiness"])) {
    issues.add("ENVELOPE_INVALID", "payload.coverage must hold exactly manifest and readiness");
    return fail();
  }
  if (!Array.isArray(payload.events) || !Array.isArray(payload.sources)) {
    issues.add("ENVELOPE_INVALID", "payload.events and payload.sources must be arrays");
  }
  const manifestOk = checkManifestShape(payload.coverage.manifest, issues);
  const ledgerOk = checkLedgerShape(payload.participationLedger, issues);
  const setsOk = checkResultSetsShape(payload.resultSets, issues);
  if (!manifestOk || !ledgerOk || !setsOk || !issues.empty) return fail();

  const artifact = raw as unknown as SngCanonicalArtifact;
  const manifest = artifact.payload.coverage.manifest;
  checkEnvelopeSemantics(artifact, manifest, issues, options);
  checkManifestSemantics(manifest, issues);
  checkLedgerSemantics(artifact.payload.participationLedger, manifest, issues);
  checkResultSetSemantics(
    artifact.payload.resultSets,
    artifact.payload.participationLedger,
    manifest,
    artifact.payload.acceptance.readinessEvidenceChecksum,
    issues,
  );
  if (!issues.empty) return fail();
  return { ok: true, artifact, summary: summarize(artifact) };
}

export type CanonicalSuccessionCode =
  | "SERIES_MISMATCH"
  | "ARTIFACT_ID_REUSED"
  | "CHECKSUM_REUSED"
  | "REVISION_CONFLICT"
  | "REVISION_REGRESSION"
  | "PREDECESSOR_MISMATCH";

export type CanonicalArtifactRef = Pick<CanonicalArtifactSummary, "artifactId" | "seriesKey" | "revision" | "supersedesArtifactId" | "contentChecksum">;

export type CanonicalSuccession =
  | {
      ok: true;
      replay: boolean;
      /** False when the predecessor named by the artifact was never imported locally. */
      predecessorKnown: boolean;
      /** SNG revisions between the local latest and this artifact that were never imported. */
      skippedRevisions: number;
    }
  | { ok: false; code: CanonicalSuccessionCode; detail: string };

/**
 * Relates a newly verified artifact to the latest artifact of the same series
 * already imported locally. SNG allocates revision N+1 against its highest
 * prior revision, whatever that revision's publication state. Skipped
 * revisions are surfaced, not guessed away.
 */
export function checkSngCanonicalSuccession(previous: CanonicalArtifactRef | null, next: CanonicalArtifactRef): CanonicalSuccession {
  if (previous === null) {
    return { ok: true, replay: false, predecessorKnown: next.supersedesArtifactId === null, skippedRevisions: next.revision - 1 };
  }
  if (previous.seriesKey !== next.seriesKey) {
    return { ok: false, code: "SERIES_MISMATCH", detail: `${next.seriesKey} does not continue ${previous.seriesKey}` };
  }
  if (previous.artifactId === next.artifactId) {
    return previous.contentChecksum === next.contentChecksum && previous.revision === next.revision
      ? { ok: true, replay: true, predecessorKnown: true, skippedRevisions: 0 }
      : { ok: false, code: "ARTIFACT_ID_REUSED", detail: `artifact ${next.artifactId} reappeared with different content` };
  }
  if (previous.contentChecksum === next.contentChecksum) {
    return { ok: false, code: "CHECKSUM_REUSED", detail: "a different artifact ID carries identical content" };
  }
  if (next.revision === previous.revision) {
    return { ok: false, code: "REVISION_CONFLICT", detail: `revision ${next.revision} was already imported as ${previous.artifactId}` };
  }
  if (next.revision < previous.revision) {
    return { ok: false, code: "REVISION_REGRESSION", detail: `revision ${next.revision} is older than imported revision ${previous.revision}` };
  }
  if (next.revision === previous.revision + 1 && next.supersedesArtifactId !== previous.artifactId) {
    return { ok: false, code: "PREDECESSOR_MISMATCH", detail: `revision ${next.revision} must supersede ${previous.artifactId}` };
  }
  return {
    ok: true,
    replay: false,
    predecessorKnown: next.supersedesArtifactId === previous.artifactId,
    skippedRevisions: next.revision - previous.revision - 1,
  };
}
