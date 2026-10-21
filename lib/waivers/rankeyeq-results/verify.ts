import { RankEyeQCanonicalJsonError, canonicalRankEyeQJson, rankEyeQContentChecksum } from "@/lib/waivers/rankeyeq-results/checksum";
import {
  RANKEYEQ_FANTASY_SCORING_VERSION,
  RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION,
  RANKEYEQ_FINAL_WEEK_STATS_SOURCE_KIND,
  RANKEYEQ_IDENTITY_PROVIDER,
  RANKEYEQ_PARTICIPANT_DISPOSITIONS,
  RANKEYEQ_PARTICIPATION_PROOFS,
  RANKEYEQ_PARTICIPATION_STATES,
  RANKEYEQ_POSITIONS,
  RANKEYEQ_REQUIRED_GAME_STATUS,
  RANKEYEQ_REQUIRED_WEEK_STATUS,
  RANKEYEQ_RESULTS_ATTESTATION_VERSION,
  RANKEYEQ_RESULTS_AUTHORITY_BASIS,
  RANKEYEQ_UNRESOLVED_STATES,
  RANKEYEQ_WEEK_STAT_PROVIDER,
  rankEyeQDefenseExternalId,
  rankEyeQResultsSeriesKey,
  type RankEyeQParticipationState,
  type RankEyeQPublicationState,
} from "@/lib/waivers/rankeyeq-results/contract";
import { sortRankEyeQParticipants, summarizeRankEyeQParticipants } from "@/lib/waivers/rankeyeq-results/summary";
import { RANKEYEQ_ADVISORY_ISSUE_CODES, type RankEyeQFinalWeekStatsContent, type RankEyeQParticipant } from "@/lib/waivers/rankeyeq-results/types";

/**
 * Integrity and structure verification of a stored RankEyeQ final-week-stats
 * snapshot. It recomputes the content checksum, re-checks every pin and every
 * participant invariant, and for ACCEPTED publication refuses any unresolved
 * state (PENDING_ZERO_REVIEW, ABSENT_UNRESOLVED). It never re-scores facts.
 */

export const RANKEYEQ_VERIFICATION_ISSUE_CODES = [
  "CONTENT_NOT_OBJECT",
  "CONTENT_SHAPE_INVALID",
  "CONTENT_NOT_CANONICALIZABLE",
  "SCHEMA_VERSION_MISMATCH",
  "SOURCE_KIND_MISMATCH",
  "SCORING_VERSION_MISMATCH",
  "WEEK_STATUS_NOT_COMPLETE",
  "SOURCE_WEEK_MISMATCH",
  "STAT_PROVIDER_MISMATCH",
  "SERIES_KEY_MISMATCH",
  "CHECKSUM_MISMATCH",
  "WEEK_MISMATCH",
  "ROW_METADATA_MISMATCH",
  "AUTHORITY_BASIS_MISMATCH",
  "ATTESTATION_VERSION_MISMATCH",
  "CONTEST_INVALID",
  "PARTICIPANT_IDENTITY_INVALID",
  "PARTICIPANT_DUPLICATE",
  "PARTICIPANT_ORDER_INVALID",
  "PARTICIPANT_STATE_INCOHERENT",
  "PARTICIPANT_EVIDENCE_INVALID",
  "SUMMARY_MISMATCH",
  "UNRESOLVED_PARTICIPANT",
  "PUBLICATION_STATE_NOT_ACCEPTED",
] as const;
export type RankEyeQVerificationIssueCode = (typeof RANKEYEQ_VERIFICATION_ISSUE_CODES)[number];
export type RankEyeQVerificationIssue = { code: RankEyeQVerificationIssueCode; detail: string; rankableEntryId?: string };

/** Stored-row metadata the verifier cross-checks against the content (all optional). */
export type RankEyeQSnapshotRowMetadata = {
  schemaVersion?: string;
  scoringVersion?: string;
  rankingsWeekStatus?: string;
  sourceWeekId?: string;
  seriesKey?: string;
  weekId?: string;
  participantCount?: number;
  pendingZeroCount?: number;
  unresolvedCount?: number;
  authorityBasis?: string;
  attestationVersion?: string;
};

export type RankEyeQVerifyOptions = {
  /** The stored `contentChecksum` the recomputed digest must equal. */
  expectedContentChecksum?: string;
  expectedWeekId?: string;
  row?: RankEyeQSnapshotRowMetadata;
  /** ACCEPTED (the default) additionally refuses unresolved participants. */
  publicationState?: RankEyeQPublicationState;
  /** Pre-publication checks: skip the unresolved-participant refusal (build and preview only). */
  allowUnresolved?: boolean;
};

export type VerifiedRankEyeQFinalWeekStats = {
  content: RankEyeQFinalWeekStatsContent;
  contentChecksum: string;
};

export type RankEyeQVerificationResult =
  | { ok: true; verified: VerifiedRankEyeQFinalWeekStats }
  | { ok: false; issues: RankEyeQVerificationIssue[] };

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const oneOf = <T extends string>(options: readonly T[], value: unknown): value is T => typeof value === "string" && (options as readonly string[]).includes(value);

/** Shape validation of the parts the invariant checks rely on; returns the problems found. */
function shapeProblems(content: Record_): string[] {
  const problems: string[] = [];
  for (const key of ["schemaVersion", "sourceKind", "seriesKey", "scoringVersion", "rankingsWeekStatus", "sourceWeekId", "statProvider"]) {
    if (!isNonEmptyString(content[key])) problems.push(`${key} must be a non-empty string`);
  }
  const week = content.week;
  if (!isRecord(week) || !isNonEmptyString(week.id) || !isInt(week.season) || !isInt(week.weekNumber)) problems.push("week must carry id, season and weekNumber");
  const snapshot = content.waiverSnapshot;
  if (!isRecord(snapshot) || !isNonEmptyString(snapshot.id) || !isInt(snapshot.version) || !isNonEmptyString(snapshot.entriesFingerprint)) {
    problems.push("waiverSnapshot must carry id, version and entriesFingerprint");
  }
  if (!Array.isArray(content.contests)) problems.push("contests must be an array");
  else {
    content.contests.forEach((contest, index) => {
      if (!isRecord(contest) || !isNonEmptyString(contest.contestId) || !oneOf(RANKEYEQ_POSITIONS, contest.position) || !isNonEmptyString(contest.status) || !isNonEmptyString(contest.snapshotId)) {
        problems.push(`contests[${index}] must carry contestId, position, status and snapshotId`);
      }
    });
  }
  if (!Array.isArray(content.participants)) problems.push("participants must be an array");
  else {
    content.participants.forEach((participant, index) => {
      const at = `participants[${index}]`;
      if (!isRecord(participant)) return problems.push(`${at} must be an object`);
      for (const key of ["rankableEntryId", "snapshotEntryId", "provider", "externalId", "displayName"]) {
        if (!isNonEmptyString(participant[key])) problems.push(`${at}.${key} must be a non-empty string`);
      }
      if (!oneOf(["PLAYER", "TEAM_DEFENSE"] as const, participant.kind)) problems.push(`${at}.kind is invalid`);
      if (!oneOf(RANKEYEQ_POSITIONS, participant.position)) problems.push(`${at}.position is invalid`);
      if (participant.team !== null && !isString(participant.team)) problems.push(`${at}.team must be a string or null`);
      if (!oneOf(RANKEYEQ_PARTICIPATION_STATES, participant.participationState)) problems.push(`${at}.participationState is invalid`);
      if (!oneOf(RANKEYEQ_PARTICIPANT_DISPOSITIONS, participant.disposition)) problems.push(`${at}.disposition is invalid`);
      if (!oneOf(RANKEYEQ_PARTICIPATION_PROOFS, participant.proof)) problems.push(`${at}.proof is invalid`);
      if (participant.pointsHundredths !== null && !isInt(participant.pointsHundredths)) problems.push(`${at}.pointsHundredths must be an integer or null`);
      if (!Array.isArray(participant.gameIds) || !participant.gameIds.every(isNonEmptyString)) problems.push(`${at}.gameIds must be an array of ids`);
      const evidence = participant.evidence;
      if (
        !isRecord(evidence) ||
        !["PlayerWeekStat", "DefenseWeekStat"].includes(String(evidence.statTable)) ||
        !Array.isArray(evidence.games) ||
        !evidence.games.every((game) => isRecord(game) && isNonEmptyString(game.gameId) && isNonEmptyString(game.status)) ||
        !Array.isArray(evidence.issues) ||
        !evidence.issues.every((issue) => isRecord(issue) && isNonEmptyString(issue.code) && isString(issue.detail)) ||
        (evidence.decision !== null && !isRecord(evidence.decision))
      ) {
        problems.push(`${at}.evidence is malformed`);
      }
    });
  }
  if (!isRecord(content.summary)) problems.push("summary must be an object");
  return problems;
}

function checkParticipant(participant: RankEyeQParticipant, issues: RankEyeQVerificationIssue[]) {
  const id = participant.rankableEntryId;
  const add = (code: RankEyeQVerificationIssueCode, detail: string) => issues.push({ code, detail, rankableEntryId: id });
  const { evidence } = participant;

  if (participant.provider !== RANKEYEQ_IDENTITY_PROVIDER) {
    add("PARTICIPANT_IDENTITY_INVALID", `provider ${participant.provider} must be ${RANKEYEQ_IDENTITY_PROVIDER}`);
  }
  const isDefense = participant.position === "DEF";
  if ((participant.kind === "TEAM_DEFENSE") !== isDefense) add("PARTICIPANT_IDENTITY_INVALID", `kind ${participant.kind} is incoherent with position ${participant.position}`);
  if (evidence.statTable !== (isDefense ? "DefenseWeekStat" : "PlayerWeekStat")) add("PARTICIPANT_EVIDENCE_INVALID", `stat table ${evidence.statTable} is incoherent with position ${participant.position}`);
  if (isDefense) {
    if (participant.team === null || participant.externalId !== rankEyeQDefenseExternalId(participant.team)) {
      add("PARTICIPANT_IDENTITY_INVALID", `DEF identity ${participant.externalId} must be def-{TEAM} for team ${participant.team}`);
    }
  }
  const gameIdsFromEvidence = evidence.games.map((game) => game.gameId);
  if (JSON.stringify(gameIdsFromEvidence) !== JSON.stringify(participant.gameIds)) add("PARTICIPANT_EVIDENCE_INVALID", "gameIds do not equal the game evidence");

  const coherent = (disposition: string, proof: string, points: "NONZERO" | "ZERO" | "NULL") => {
    if (participant.disposition !== disposition || participant.proof !== proof) {
      add("PARTICIPANT_STATE_INCOHERENT", `${participant.participationState} requires disposition ${disposition} and proof ${proof}`);
    }
    const value = participant.pointsHundredths;
    const pointsOk = points === "NULL" ? value === null : points === "ZERO" ? value === 0 : value !== null && value !== 0;
    if (!pointsOk) add("PARTICIPANT_STATE_INCOHERENT", `${participant.participationState} requires ${points} points (got ${value})`);
  };
  const requireDecision = (expected: "PLAYED_ZERO" | "DID_NOT_PLAY") => {
    const decision = evidence.decision;
    if (!decision || decision.decision !== expected) return add("PARTICIPANT_EVIDENCE_INVALID", `${participant.participationState} requires an operator ${expected} decision`);
    if (!isNonEmptyString(decision.evidenceReference) || !isNonEmptyString(decision.reason) || !isNonEmptyString(decision.decidedByUserId) || Number.isNaN(Date.parse(String(decision.decidedAt)))) {
      add("PARTICIPANT_EVIDENCE_INVALID", "the operator decision needs an evidence reference, reason, operator and valid decidedAt");
    }
  };
  const requireFinalStatLine = () => {
    if (evidence.statRowId === null || evidence.statProvider !== RANKEYEQ_WEEK_STAT_PROVIDER) add("PARTICIPANT_EVIDENCE_INVALID", "a scorable participant needs a manual WeekStat row");
    if (evidence.isProvisional !== false) add("PARTICIPANT_EVIDENCE_INVALID", "a scorable participant's WeekStat row must not be provisional");
    if (evidence.statScoringVersion !== RANKEYEQ_FANTASY_SCORING_VERSION) add("PARTICIPANT_EVIDENCE_INVALID", `the WeekStat row must be scored under ${RANKEYEQ_FANTASY_SCORING_VERSION}`);
    if (participant.gameIds.length === 0) add("PARTICIPANT_EVIDENCE_INVALID", "a scorable participant needs a linked game");
    if (evidence.games.some((game) => game.status !== RANKEYEQ_REQUIRED_GAME_STATUS)) add("PARTICIPANT_EVIDENCE_INVALID", "every backing game must be FINAL");
    if (evidence.issues.some((issue) => !RANKEYEQ_ADVISORY_ISSUE_CODES.has(issue.code))) add("PARTICIPANT_EVIDENCE_INVALID", "a scorable participant cannot carry blocking issues");
  };

  switch (participant.participationState) {
    case "PARTICIPATED_WITH_STATS":
      coherent("PLAYED", "WEEK_STAT_LINE", "NONZERO");
      requireFinalStatLine();
      if (evidence.decision !== null) add("PARTICIPANT_EVIDENCE_INVALID", "a positive stat line is never overridden by an operator decision");
      break;
    case "PARTICIPATED_ZERO":
      coherent("PLAYED", "OPERATOR_PLAYED_ZERO_REVIEW", "ZERO");
      requireFinalStatLine();
      requireDecision("PLAYED_ZERO");
      break;
    case "VERIFIED_NON_PARTICIPANT":
      coherent("DNP", "OPERATOR_DID_NOT_PLAY_REVIEW", "NULL");
      requireFinalStatLine();
      requireDecision("DID_NOT_PLAY");
      break;
    case "PENDING_ZERO_REVIEW":
    case "ABSENT_UNRESOLVED":
      coherent("UNRESOLVED", "NONE", "NULL");
      if (evidence.decision !== null) add("PARTICIPANT_EVIDENCE_INVALID", `${participant.participationState} cannot carry an operator decision`);
      break;
  }
}

/** Recomputes the checksum and re-verifies every pin and invariant of stored snapshot content. */
export function verifyRankEyeQFinalWeekStatsSnapshot(contentInput: unknown, options: RankEyeQVerifyOptions = {}): RankEyeQVerificationResult {
  const issues: RankEyeQVerificationIssue[] = [];
  if (!isRecord(contentInput)) return { ok: false, issues: [{ code: "CONTENT_NOT_OBJECT", detail: "Snapshot content must be an object" }] };
  const problems = shapeProblems(contentInput);
  if (problems.length > 0) {
    return { ok: false, issues: problems.map((detail) => ({ code: "CONTENT_SHAPE_INVALID" as const, detail })) };
  }
  const content = contentInput as unknown as RankEyeQFinalWeekStatsContent;

  let checksum: string;
  try {
    checksum = rankEyeQContentChecksum(content);
  } catch (error) {
    if (!(error instanceof RankEyeQCanonicalJsonError)) throw error;
    return { ok: false, issues: [{ code: "CONTENT_NOT_CANONICALIZABLE", detail: error.message }] };
  }
  if (options.expectedContentChecksum !== undefined && options.expectedContentChecksum !== checksum) {
    issues.push({ code: "CHECKSUM_MISMATCH", detail: `Recomputed ${checksum}; stored ${options.expectedContentChecksum}` });
  }

  if (content.schemaVersion !== RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION) {
    issues.push({ code: "SCHEMA_VERSION_MISMATCH", detail: `schemaVersion ${content.schemaVersion}; ${RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION} required` });
  }
  if (content.sourceKind !== RANKEYEQ_FINAL_WEEK_STATS_SOURCE_KIND) {
    issues.push({ code: "SOURCE_KIND_MISMATCH", detail: `sourceKind ${content.sourceKind}; ${RANKEYEQ_FINAL_WEEK_STATS_SOURCE_KIND} required` });
  }
  if (content.scoringVersion !== RANKEYEQ_FANTASY_SCORING_VERSION) {
    issues.push({ code: "SCORING_VERSION_MISMATCH", detail: `scoringVersion ${content.scoringVersion}; ${RANKEYEQ_FANTASY_SCORING_VERSION} required` });
  }
  if (content.rankingsWeekStatus !== RANKEYEQ_REQUIRED_WEEK_STATUS) {
    issues.push({ code: "WEEK_STATUS_NOT_COMPLETE", detail: `rankingsWeekStatus ${content.rankingsWeekStatus}; ${RANKEYEQ_REQUIRED_WEEK_STATUS} required` });
  }
  if (content.sourceWeekId !== content.week.id) {
    issues.push({ code: "SOURCE_WEEK_MISMATCH", detail: `sourceWeekId ${content.sourceWeekId} is not the snapshot week ${content.week.id}` });
  }
  if (content.statProvider !== RANKEYEQ_WEEK_STAT_PROVIDER) {
    issues.push({ code: "STAT_PROVIDER_MISMATCH", detail: `statProvider ${content.statProvider}; ${RANKEYEQ_WEEK_STAT_PROVIDER} required` });
  }
  if (content.seriesKey !== rankEyeQResultsSeriesKey(content.week.season, content.week.weekNumber)) {
    issues.push({ code: "SERIES_KEY_MISMATCH", detail: `seriesKey ${content.seriesKey} does not match season ${content.week.season} week ${content.week.weekNumber}` });
  }
  if (options.expectedWeekId !== undefined && options.expectedWeekId !== content.week.id) {
    issues.push({ code: "WEEK_MISMATCH", detail: `Content is for week ${content.week.id}; ${options.expectedWeekId} expected` });
  }

  const positionsSeen = new Set<string>();
  for (const contest of content.contests) {
    if (positionsSeen.has(contest.position)) issues.push({ code: "CONTEST_INVALID", detail: `Duplicate ${contest.position} contest` });
    positionsSeen.add(contest.position);
    if (contest.status !== "LOCKED") issues.push({ code: "CONTEST_INVALID", detail: `${contest.position} contest ${contest.contestId} is ${contest.status}; LOCKED required` });
    if (contest.snapshotId !== content.waiverSnapshot.id) {
      issues.push({ code: "CONTEST_INVALID", detail: `${contest.position} contest ${contest.contestId} is not pinned to waiver snapshot ${content.waiverSnapshot.id}` });
    }
  }

  const seenEntries = new Set<string>();
  const seenIdentities = new Set<string>();
  for (const participant of content.participants) {
    if (seenEntries.has(participant.rankableEntryId)) issues.push({ code: "PARTICIPANT_DUPLICATE", detail: "Duplicate rankableEntryId", rankableEntryId: participant.rankableEntryId });
    seenEntries.add(participant.rankableEntryId);
    const identity = `${participant.provider}\u0000${participant.externalId}`;
    if (seenIdentities.has(identity)) {
      issues.push({ code: "PARTICIPANT_DUPLICATE", detail: `Duplicate identity ${participant.provider}:${participant.externalId}`, rankableEntryId: participant.rankableEntryId });
    }
    seenIdentities.add(identity);
    checkParticipant(participant, issues);
  }
  const expectedOrder = sortRankEyeQParticipants(content.participants).map((participant) => participant.rankableEntryId);
  if (JSON.stringify(expectedOrder) !== JSON.stringify(content.participants.map((participant) => participant.rankableEntryId))) {
    issues.push({ code: "PARTICIPANT_ORDER_INVALID", detail: "Participants must be in contract order (position, then rankableEntryId)" });
  }

  const summary = summarizeRankEyeQParticipants(content.participants);
  if (canonicalRankEyeQJson(summary) !== canonicalRankEyeQJson(content.summary)) {
    issues.push({ code: "SUMMARY_MISMATCH", detail: "summary does not equal the recomputed participant counts" });
  }

  const state = options.publicationState ?? "ACCEPTED";
  if (state !== "ACCEPTED") {
    issues.push({ code: "PUBLICATION_STATE_NOT_ACCEPTED", detail: `Publication state is ${state}; only ACCEPTED snapshots are authoritative` });
  } else if (!options.allowUnresolved) {
    for (const participant of content.participants) {
      if (RANKEYEQ_UNRESOLVED_STATES.has(participant.participationState as RankEyeQParticipationState)) {
        issues.push({ code: "UNRESOLVED_PARTICIPANT", detail: `${participant.participationState} blocks ACCEPTED publication`, rankableEntryId: participant.rankableEntryId });
      }
    }
  }

  const row = options.row;
  if (row) {
    const compare = (field: string, stored: unknown, actual: unknown) => {
      if (stored !== undefined && stored !== actual) issues.push({ code: "ROW_METADATA_MISMATCH", detail: `${field}: row ${String(stored)}; content ${String(actual)}` });
    };
    compare("schemaVersion", row.schemaVersion, content.schemaVersion);
    compare("scoringVersion", row.scoringVersion, content.scoringVersion);
    compare("rankingsWeekStatus", row.rankingsWeekStatus, content.rankingsWeekStatus);
    compare("sourceWeekId", row.sourceWeekId, content.sourceWeekId);
    compare("seriesKey", row.seriesKey, content.seriesKey);
    compare("weekId", row.weekId, content.week.id);
    compare("participantCount", row.participantCount, summary.participantCount);
    compare("pendingZeroCount", row.pendingZeroCount, summary.pendingZeroCount);
    compare("unresolvedCount", row.unresolvedCount, summary.unresolvedCount);
    if (row.authorityBasis !== undefined && row.authorityBasis !== RANKEYEQ_RESULTS_AUTHORITY_BASIS) {
      issues.push({ code: "AUTHORITY_BASIS_MISMATCH", detail: `authorityBasis ${row.authorityBasis}; ${RANKEYEQ_RESULTS_AUTHORITY_BASIS} required` });
    }
    if (row.attestationVersion !== undefined && row.attestationVersion !== RANKEYEQ_RESULTS_ATTESTATION_VERSION) {
      issues.push({ code: "ATTESTATION_VERSION_MISMATCH", detail: `attestationVersion ${row.attestationVersion}; ${RANKEYEQ_RESULTS_ATTESTATION_VERSION} required` });
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, verified: { content, contentChecksum: checksum } };
}
