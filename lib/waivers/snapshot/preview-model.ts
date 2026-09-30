import { createHash } from "node:crypto";
import type {
  ContestPosition,
  NflGameStatus,
  WaiverEligibility,
  WaiverEvidenceRole,
  WaiverExclusionReason,
  WaiverMatchMethod,
  WeeklyAvailabilityDesignation,
} from "@/lib/generated/prisma/client";
import { normalizePlayerName } from "@/lib/nfl/player-identity";
import { resolveWaiverLocksAt } from "@/lib/waivers/lock-time";
import {
  computeWaiverCompleteness,
  type WaiverCompletenessEvidence,
  type WaiverPoolPlayer,
  type WaiverTrackedPlayer,
} from "@/lib/waivers/snapshot/completeness";
import {
  deriveWaiverEligibility,
  deriveWaiverEvidenceRole,
  type WaiverEntryFacts,
  type WaiverGameFact,
  type WaiverWeekGame,
} from "@/lib/waivers/snapshot/eligibility";
import type { WaiverInputParse, WaiverInputRow } from "@/lib/waivers/snapshot/input";
import { matchWaiverRow, type WaiverCandidateRef, type WaiverMatchIndex, type WaiverMatchResult } from "@/lib/waivers/snapshot/match";

/** Mirrors the Rankings roster-sync staleness window (ROSTER_STALE_AFTER_MS); parity is tested. */
export const WAIVER_ROSTER_STALE_AFTER_MS = 72 * 60 * 60 * 1000;

export const WAIVER_FOLLOW_UP_ACK_REASONS = ["SOURCE_HAS_NO_LISTING", "UNABLE_TO_VERIFY", "SOURCE_UNAVAILABLE", "OTHER"] as const;
export type WaiverFollowUpAckReason = (typeof WAIVER_FOLLOW_UP_ACK_REASONS)[number];
export type WaiverFollowUpAck = { rankableEntryId: string; reason: WaiverFollowUpAckReason; note: string | null };

export type WaiverIssueLevel = "BLOCKER" | "CONFIRM" | "INFO";
export type WaiverPreviewIssue = {
  level: WaiverIssueLevel;
  code: string;
  message: string;
  lineNumbers?: number[];
  rankableEntryIds?: string[];
};

export type WaiverPreviewRowState =
  | "MATCHED"
  | "AMBIGUOUS"
  | "UNMATCHED"
  | "POSITION_MISMATCH"
  | "ID_MISMATCH"
  | "DUPLICATE"
  | "INVALID";

/** One snapshot entry exactly as it would be frozen, plus source-side evidence. */
export type WaiverPreviewEntry = {
  rankableEntryId: string;
  evidenceRole: WaiverEvidenceRole;
  position: ContestPosition;
  displayNameAtFreeze: string;
  teamAtFreeze: string | null;
  rosteredBps: number;
  sourceLabel: string;
  sourceUrl: string | null;
  observedAt: Date;
  inputLineNumber: number;
  inputLine: string;
  matchMethod: WaiverMatchMethod;
  eligibility: WaiverEligibility;
  exclusionReason: WaiverExclusionReason | null;
  exclusionNote: string | null;
  nflGameId: string | null;
  opponentAtFreeze: string | null;
  kickoffAtFreeze: Date | null;
  isByeAtFreeze: boolean;
  availabilityDesignationAtFreeze: WeeklyAvailabilityDesignation | null;
  rosterStatusAtFreeze: string | null;
  availabilitySourceAtFreeze: string | null;
  hardUnavailableAtFreeze: boolean;
  /** Not a column: event status copied into import-log metadata and fingerprints. */
  gameStatusAtFreeze: NflGameStatus | null;
  sourceTeam: string | null;
  teamConflict: boolean;
  tracked: boolean;
  /** The canonical facts eligibility was derived from; corrections re-derive from these, never from live data. */
  facts: WaiverEntryFacts;
};

export type WaiverPreviewRow = {
  lineNumber: number;
  line: string;
  playerName: string;
  positionRaw: string;
  teamRaw: string;
  percentRaw: string;
  state: WaiverPreviewRowState;
  issues: string[];
  candidates: WaiverCandidateRef[];
  entry: WaiverPreviewEntry | null;
};

export type WaiverSnapshotCounts = {
  candidateCount: number;
  eligibleCount: number;
  excludedCount: number;
  followUpCount: number;
};

export type WaiverPreviewForm = {
  weekId: string;
  sourceLabel: string;
  sourceUrl: string | null;
  observedAt: Date | null;
};

export type WaiverPreviewContext = {
  now: Date;
  week: { id: string; seasonId: string; weekNumber: number };
  thresholdBps: number;
  games: ReadonlyArray<WaiverWeekGame>;
  currentSnapshot: { id: string; version: number } | null;
  rosterSyncedAt: Date | null;
  tracked: ReadonlyArray<WaiverTrackedPlayer>;
  rankingsPool: ReadonlyArray<WaiverPoolPlayer>;
  previousWeekNumber: number | null;
  previousEligible: ReadonlyArray<WaiverPoolPlayer>;
};

export type WaiverSnapshotPreview = {
  weekId: string;
  header: { sourceLabel: string; sourceUrl: string | null; observedAt: Date | null; thresholdBps: number };
  rawInputSha256: string;
  inputError: WaiverInputParse["error"];
  headerSkipped: boolean;
  ignoredLines: number;
  rows: WaiverPreviewRow[];
  entries: WaiverPreviewEntry[];
  counts: WaiverSnapshotCounts;
  rowStateCounts: Record<WaiverPreviewRowState, number>;
  exclusionCounts: Partial<Record<WaiverExclusionReason, number>>;
  completeness: WaiverCompletenessEvidence;
  issues: WaiverPreviewIssue[];
  blockers: WaiverPreviewIssue[];
  requiredAcknowledgments: string[];
  missingFollowUps: WaiverTrackedPlayer[];
  firstKickoff: Date | null;
  locksAt: Date | null;
  contestsCanOpen: boolean;
  currentSnapshotId: string | null;
  previewFingerprint: string;
  entriesFingerprint: string;
};

export type WaiverMatchedInputRow = { input: WaiverInputRow; match: WaiverMatchResult | null };

/** Matches every parseable row; rows with parse issues get no match attempt. */
export function matchWaiverInputRows(rows: ReadonlyArray<WaiverInputRow>, index: WaiverMatchIndex): WaiverMatchedInputRow[] {
  return rows.map((input) => {
    if (input.issues.length > 0 || !input.position || !input.team) return { input, match: null };
    return {
      input,
      match: matchWaiverRow(
        { playerName: input.playerName, position: input.position, team: input.team, rankEyeQId: input.rankEyeQId },
        index,
      ),
    };
  });
}

export function matchedWaiverEntryIds(rows: ReadonlyArray<WaiverMatchedInputRow>): string[] {
  const ids = new Set<string>();
  for (const row of rows) if (row.match?.status === "MATCHED") ids.add(row.match.rankableEntryId);
  return [...ids].sort();
}

/** Builds one frozen-entry shape from source evidence plus canonical facts. */
export function buildWaiverPreviewEntry(input: {
  rankableEntryId: string;
  position: ContestPosition;
  rosteredBps: number;
  sourceLabel: string;
  sourceUrl: string | null;
  observedAt: Date;
  inputLineNumber: number;
  inputLine: string;
  matchMethod: WaiverMatchMethod;
  sourceTeam: string | null;
  teamConflict: boolean;
  tracked: boolean;
  thresholdBps: number;
  facts: WaiverEntryFacts;
}): WaiverPreviewEntry {
  const role = deriveWaiverEvidenceRole({ rosteredBps: input.rosteredBps, thresholdBps: input.thresholdBps, tracked: input.tracked });
  const decision = deriveWaiverEligibility({ role, rosteredBps: input.rosteredBps, thresholdBps: input.thresholdBps, facts: input.facts });
  const game = input.facts.game.kind === "GAME" ? input.facts.game : null;
  return {
    rankableEntryId: input.rankableEntryId,
    evidenceRole: role,
    position: input.position,
    displayNameAtFreeze: input.facts.canonicalName,
    teamAtFreeze: input.facts.canonicalTeam,
    rosteredBps: input.rosteredBps,
    sourceLabel: input.sourceLabel,
    sourceUrl: input.sourceUrl,
    observedAt: input.observedAt,
    inputLineNumber: input.inputLineNumber,
    inputLine: input.inputLine,
    matchMethod: input.matchMethod,
    eligibility: decision.eligibility,
    exclusionReason: decision.exclusionReason,
    exclusionNote: decision.exclusionNote,
    nflGameId: game?.gameId ?? null,
    opponentAtFreeze: game?.opponent ?? null,
    kickoffAtFreeze: game?.kickoff ?? null,
    isByeAtFreeze: input.facts.game.kind === "BYE",
    availabilityDesignationAtFreeze: input.facts.availability.designation,
    rosterStatusAtFreeze: input.facts.availability.rosterStatus,
    availabilitySourceAtFreeze: input.facts.availability.source,
    hardUnavailableAtFreeze: !input.facts.availability.selectable,
    gameStatusAtFreeze: game?.status ?? null,
    sourceTeam: input.sourceTeam,
    teamConflict: input.teamConflict,
    tracked: input.tracked,
    facts: input.facts,
  };
}

export function waiverSnapshotCounts(entries: ReadonlyArray<Pick<WaiverPreviewEntry, "evidenceRole" | "eligibility">>): WaiverSnapshotCounts {
  const candidates = entries.filter((entry) => entry.evidenceRole === "CANDIDATE");
  return {
    candidateCount: candidates.length,
    eligibleCount: candidates.filter((entry) => entry.eligibility === "ELIGIBLE").length,
    excludedCount: candidates.filter((entry) => entry.eligibility === "EXCLUDED").length,
    followUpCount: entries.length - candidates.length,
  };
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Column-level evidence of one entry in a stable key order (fingerprint and import-log metadata). */
export function serializeWaiverEntryEvidence(entry: WaiverPreviewEntry) {
  return {
    rankableEntryId: entry.rankableEntryId,
    evidenceRole: entry.evidenceRole,
    position: entry.position,
    displayNameAtFreeze: entry.displayNameAtFreeze,
    teamAtFreeze: entry.teamAtFreeze,
    rosteredBps: entry.rosteredBps,
    sourceLabel: entry.sourceLabel,
    sourceUrl: entry.sourceUrl,
    observedAt: iso(entry.observedAt),
    inputLineNumber: entry.inputLineNumber,
    inputLine: entry.inputLine,
    matchMethod: entry.matchMethod,
    eligibility: entry.eligibility,
    exclusionReason: entry.exclusionReason,
    exclusionNote: entry.exclusionNote,
    nflGameId: entry.nflGameId,
    opponentAtFreeze: entry.opponentAtFreeze,
    kickoffAtFreeze: iso(entry.kickoffAtFreeze),
    isByeAtFreeze: entry.isByeAtFreeze,
    availabilityDesignationAtFreeze: entry.availabilityDesignationAtFreeze,
    rosterStatusAtFreeze: entry.rosterStatusAtFreeze,
    availabilitySourceAtFreeze: entry.availabilitySourceAtFreeze,
    hardUnavailableAtFreeze: entry.hardUnavailableAtFreeze,
    gameStatusAtFreeze: entry.gameStatusAtFreeze,
  };
}

export type SerializedWaiverEntryFacts = Omit<WaiverEntryFacts, "game"> & {
  game: Exclude<WaiverGameFact, { kind: "GAME" }> | (Omit<Extract<WaiverGameFact, { kind: "GAME" }>, "kickoff"> & { kickoff: string });
};

export function serializeWaiverEntryFacts(facts: WaiverEntryFacts): SerializedWaiverEntryFacts {
  return {
    rankableEntryId: facts.rankableEntryId,
    canonicalName: facts.canonicalName,
    canonicalTeam: facts.canonicalTeam,
    roster: facts.roster ? { team: facts.roster.team, activeOnNFLRoster: facts.roster.activeOnNFLRoster, nflStatus: facts.roster.nflStatus } : null,
    game: facts.game.kind === "GAME" ? { ...facts.game, kickoff: facts.game.kickoff.toISOString() } : facts.game,
    availability: { ...facts.availability },
  };
}

export function deserializeWaiverEntryFacts(facts: SerializedWaiverEntryFacts): WaiverEntryFacts {
  return { ...facts, game: facts.game.kind === "GAME" ? { ...facts.game, kickoff: new Date(facts.game.kickoff) } : facts.game };
}

/** Per-entry derivation context stored with every frozen version (import-log metadata). */
export type WaiverEntryContext = {
  rankableEntryId: string;
  tracked: boolean;
  sourceTeam: string | null;
  teamConflict: boolean;
  gameStatusAtFreeze: NflGameStatus | null;
  facts: SerializedWaiverEntryFacts;
};

export function waiverEntryContext(entry: WaiverPreviewEntry): WaiverEntryContext {
  return {
    rankableEntryId: entry.rankableEntryId,
    tracked: entry.tracked,
    sourceTeam: entry.sourceTeam,
    teamConflict: entry.teamConflict,
    gameStatusAtFreeze: entry.gameStatusAtFreeze,
    facts: serializeWaiverEntryFacts(entry.facts),
  };
}

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** sha256 over every frozen entry's evidence, ordered by player id. */
export function waiverEntriesFingerprint(entries: ReadonlyArray<WaiverPreviewEntry>): string {
  const ordered = [...entries].sort((a, b) => (a.rankableEntryId < b.rankableEntryId ? -1 : a.rankableEntryId > b.rankableEntryId ? 1 : 0));
  return sha256({ v: 1, entries: ordered.map(serializeWaiverEntryEvidence) });
}

const MATCH_REASON_STATE: Record<Extract<WaiverMatchResult, { status: "INVALID" }>["reason"], WaiverPreviewRowState> = {
  ID_NOT_FOUND: "ID_MISMATCH",
  ID_POSITION_MISMATCH: "ID_MISMATCH",
  ID_NAME_MISMATCH: "ID_MISMATCH",
  POSITION_MISMATCH: "POSITION_MISMATCH",
};

const ROW_STATE_BLOCKERS: Record<Exclude<WaiverPreviewRowState, "MATCHED">, string> = {
  INVALID: "Rows could not be parsed (missing column, invalid position, team, percentage or observed-at)",
  UNMATCHED: "Rows match no RankEyeQ player at that position",
  AMBIGUOUS: "Rows match several RankEyeQ players; add the RankEyeQ ID column",
  POSITION_MISMATCH: "Rows match a RankEyeQ player only at another position",
  ID_MISMATCH: "RankEyeQ ID column does not exist, is at another position, or does not match the name",
  DUPLICATE: "Several rows resolve to the same player",
};

const lines = (rows: ReadonlyArray<{ lineNumber: number }>) => rows.map((row) => row.lineNumber);

/**
 * Pure assembly of a snapshot preview from parsed input, match results and
 * canonical facts. Freeze re-runs exactly this with transaction-scoped facts
 * and compares `previewFingerprint`.
 */
export function assembleWaiverSnapshotPreview(input: {
  form: WaiverPreviewForm;
  parse: WaiverInputParse;
  matched: ReadonlyArray<WaiverMatchedInputRow>;
  factsById: ReadonlyMap<string, WaiverEntryFacts>;
  context: WaiverPreviewContext;
}): WaiverSnapshotPreview {
  const { form, parse, context } = input;
  const thresholdBps = context.thresholdBps;
  const trackedById = new Map(context.tracked.map((player) => [player.rankableEntryId, player]));
  const sourceLabel = form.sourceLabel.trim();
  const sourceUrl = form.sourceUrl?.trim() || null;

  const matchedCount = new Map<string, number>();
  for (const row of input.matched) {
    if (row.match?.status === "MATCHED") {
      matchedCount.set(row.match.rankableEntryId, (matchedCount.get(row.match.rankableEntryId) ?? 0) + 1);
    }
  }
  const unresolvedKey = (row: WaiverInputRow) => `${row.position}|${row.team}|${normalizePlayerName(row.playerName)}`;
  const unresolvedCount = new Map<string, number>();
  for (const row of input.matched) {
    if (row.match && row.match.status !== "MATCHED") {
      const key = unresolvedKey(row.input);
      unresolvedCount.set(key, (unresolvedCount.get(key) ?? 0) + 1);
    }
  }

  const rows: WaiverPreviewRow[] = [];
  const ambiguousGameLines: number[] = [];
  for (const { input: row, match } of input.matched) {
    const base = {
      lineNumber: row.lineNumber,
      line: row.line,
      playerName: row.playerName,
      positionRaw: row.positionRaw,
      teamRaw: row.teamRaw,
      percentRaw: row.percentRaw,
    };
    const issues: string[] = [...row.issues];
    if (row.observedAt && row.observedAt.getTime() > context.now.getTime()) issues.push("FUTURE_OBSERVED_AT");
    if (!match || issues.length > 0) {
      rows.push({ ...base, state: "INVALID", issues, candidates: [], entry: null });
      continue;
    }
    if (match.status !== "MATCHED") {
      const duplicate = (unresolvedCount.get(unresolvedKey(row)) ?? 0) > 1;
      const state: WaiverPreviewRowState = duplicate
        ? "DUPLICATE"
        : match.status === "INVALID"
          ? MATCH_REASON_STATE[match.reason]
          : match.status;
      if (match.status === "INVALID") issues.push(match.reason);
      rows.push({ ...base, state, issues, candidates: "candidates" in match ? match.candidates : [], entry: null });
      continue;
    }
    if ((matchedCount.get(match.rankableEntryId) ?? 0) > 1) {
      rows.push({ ...base, state: "DUPLICATE", issues: [`SAME_PLAYER:${match.rankableEntryId}`], candidates: [], entry: null });
      continue;
    }
    const facts = input.factsById.get(match.rankableEntryId);
    const observedAt = row.observedAt ?? form.observedAt;
    if (!facts || !observedAt || row.rosteredBps === null || !row.position) {
      rows.push({ ...base, state: "INVALID", issues: [facts ? "OBSERVED_AT_MISSING" : "FACTS_MISSING"], candidates: [], entry: null });
      continue;
    }
    if (facts.game.kind === "AMBIGUOUS") ambiguousGameLines.push(row.lineNumber);
    const overrideLabel = row.sourceLabel?.trim() || null;
    rows.push({
      ...base,
      state: "MATCHED",
      issues,
      candidates: [],
      entry: buildWaiverPreviewEntry({
        rankableEntryId: match.rankableEntryId,
        position: row.position,
        rosteredBps: row.rosteredBps,
        sourceLabel: overrideLabel ?? sourceLabel,
        sourceUrl: overrideLabel ? null : sourceUrl,
        observedAt,
        inputLineNumber: row.lineNumber,
        inputLine: row.line,
        matchMethod: match.method,
        sourceTeam: row.team,
        teamConflict: match.teamConflict,
        tracked: trackedById.has(match.rankableEntryId),
        thresholdBps,
        facts,
      }),
    });
  }

  const entries = rows.flatMap((row) => (row.entry ? [row.entry] : []));
  const counts = waiverSnapshotCounts(entries);
  const completeness = computeWaiverCompleteness({
    entries,
    rankingsPool: context.rankingsPool,
    previousWeekNumber: context.previousWeekNumber,
    previousEligible: context.previousEligible,
    tracked: context.tracked,
  });

  const observedTimes = [form.observedAt, ...entries.map((entry) => entry.observedAt)].filter((date): date is Date => Boolean(date));
  const headerObservedAt = observedTimes.length > 0 ? new Date(Math.max(...observedTimes.map((date) => date.getTime()))) : null;

  const scheduled = context.games.filter((game) => game.status !== "CANCELED");
  const firstKickoff = scheduled.length > 0 ? new Date(Math.min(...scheduled.map((game) => game.startsAt.getTime()))) : null;
  const lock = firstKickoff ? resolveWaiverLocksAt(firstKickoff) : null;
  const contestsCanOpen = Boolean(lock?.ok && context.now.getTime() < lock.locksAt.getTime());

  const issues: WaiverPreviewIssue[] = [];
  const blocker = (code: string, message: string, extra: Partial<WaiverPreviewIssue> = {}) =>
    issues.push({ level: "BLOCKER", code, message, ...extra });
  const confirm = (code: string, message: string, extra: Partial<WaiverPreviewIssue> = {}) =>
    issues.push({ level: "CONFIRM", code, message, ...extra });
  const info = (code: string, message: string, extra: Partial<WaiverPreviewIssue> = {}) =>
    issues.push({ level: "INFO", code, message, ...extra });

  if (parse.error === "EMPTY") blocker("INPUT_EMPTY", "The paste contains no player rows");
  if (parse.error === "TOO_LARGE") blocker("INPUT_TOO_LARGE", "The paste exceeds the size limit");
  if (parse.error === "TOO_MANY_ROWS") blocker("INPUT_TOO_MANY_ROWS", "The paste exceeds the row limit");
  if (!sourceLabel) blocker("SOURCE_LABEL_MISSING", "Source label is required");
  if (!form.observedAt) blocker("OBSERVED_AT_MISSING", "Official observation time is required");
  else if (form.observedAt.getTime() > context.now.getTime()) blocker("OBSERVED_AT_FUTURE", "Official observation time is in the future");
  if (context.currentSnapshot) {
    blocker("SNAPSHOT_EXISTS", `Version ${context.currentSnapshot.version} is already frozen for this week; use a correction`);
  }
  if (!firstKickoff) blocker("NO_SCHEDULE", "The week has no scheduled NFL games");
  for (const state of Object.keys(ROW_STATE_BLOCKERS) as Array<keyof typeof ROW_STATE_BLOCKERS>) {
    const offending = rows.filter((row) => row.state === state);
    if (offending.length > 0) blocker(`ROWS_${state}`, ROW_STATE_BLOCKERS[state], { lineNumbers: lines(offending) });
  }
  if (ambiguousGameLines.length > 0) {
    blocker("AMBIGUOUS_GAME", "A player's team appears in more than one game this week", { lineNumbers: ambiguousGameLines });
  }

  confirm(
    "SOURCE_COMPLETE_ATTESTATION",
    "I attest the paste is the source's complete under-threshold list for all five positions at the stated observation time",
  );
  if (!sourceUrl) confirm("SOURCE_URL_MISSING", "No source URL was provided");
  const conflicts = entries.filter((entry) => entry.teamConflict);
  if (conflicts.length > 0) {
    confirm(
      "TEAM_CONFLICT",
      "Source team differs from the canonical RankEyeQ team; canonical team and game facts are used and the source input is preserved",
      { lineNumbers: lines(conflicts.map((entry) => ({ lineNumber: entry.inputLineNumber }))), rankableEntryIds: conflicts.map((e) => e.rankableEntryId) },
    );
  }
  for (const evidence of completeness.byPosition) {
    if (evidence.eligible === 0) {
      confirm(`ZERO_ELIGIBLE:${evidence.position}`, `${evidence.position} has no eligible players; its Waiver contest will be refused`);
    } else if (evidence.eligible < evidence.maxCalls) {
      confirm(
        `REDUCED_DEPTH:${evidence.position}`,
        `${evidence.position} has ${evidence.eligible} eligible players; board depth is reduced to ${evidence.effectiveMaxCalls}`,
      );
    }
  }
  const missingFollowUps = completeness.trackedMissing;
  if (missingFollowUps.length > 0) {
    confirm("MISSING_FOLLOW_UP", "Tracked players have no observation in this paste; each needs an acknowledgment and reason", {
      rankableEntryIds: missingFollowUps.map((player) => player.rankableEntryId),
    });
  }
  if (lock && !lock.ok) {
    confirm("LOCK_UNRESOLVABLE", "Tuesday 7:00 PM CT is not before the first kickoff; this snapshot is evidence only and contests cannot open");
  } else if (lock && !contestsCanOpen) {
    confirm("AFTER_LOCK", "This week's Waiver lock has passed; this snapshot is evidence only and cannot open contests");
  }
  if (!context.rosterSyncedAt || context.now.getTime() - context.rosterSyncedAt.getTime() > WAIVER_ROSTER_STALE_AFTER_MS) {
    confirm("STALE_ROSTER_SYNC", "Season roster sync is missing or stale; roster facts may be out of date");
  }

  if (headerObservedAt) {
    const ageMinutes = Math.max(0, Math.round((context.now.getTime() - headerObservedAt.getTime()) / 60_000));
    info("OBSERVATION_AGE", `Latest observation is ${ageMinutes} minutes old`);
  }
  const untrackedHigh = entries.filter((entry) => entry.exclusionReason === "AT_OR_ABOVE_THRESHOLD");
  if (untrackedHigh.length > 0) {
    info("AT_OR_ABOVE_THRESHOLD_ROWS", `${untrackedHigh.length} rows at or above the threshold are kept as excluded evidence`, {
      lineNumbers: lines(untrackedHigh.map((entry) => ({ lineNumber: entry.inputLineNumber }))),
    });
  }
  const disclosures = entries.filter(
    (entry) =>
      entry.eligibility === "ELIGIBLE" &&
      (entry.availabilityDesignationAtFreeze === "QUESTIONABLE" || entry.availabilityDesignationAtFreeze === "DOUBTFUL"),
  );
  if (disclosures.length > 0) {
    info("QD_DISCLOSURES", `${disclosures.length} eligible players are Questionable or Doubtful`, {
      lineNumbers: lines(disclosures.map((entry) => ({ lineNumber: entry.inputLineNumber }))),
    });
  }
  if (parse.ignoredLines > 0) info("IGNORED_LINES", `${parse.ignoredLines} blank or comment lines ignored`);

  const exclusionCounts: Partial<Record<WaiverExclusionReason, number>> = {};
  for (const entry of entries) {
    if (entry.exclusionReason) exclusionCounts[entry.exclusionReason] = (exclusionCounts[entry.exclusionReason] ?? 0) + 1;
  }
  const rowStateCounts = Object.fromEntries(
    (["MATCHED", "AMBIGUOUS", "UNMATCHED", "POSITION_MISMATCH", "ID_MISMATCH", "DUPLICATE", "INVALID"] as const).map((state) => [
      state,
      rows.filter((row) => row.state === state).length,
    ]),
  ) as Record<WaiverPreviewRowState, number>;

  const blockers = issues.filter((issue) => issue.level === "BLOCKER");
  const requiredAcknowledgments = issues
    .filter((issue) => issue.level === "CONFIRM")
    .map((issue) => issue.code)
    .sort();
  const header = { sourceLabel, sourceUrl, observedAt: headerObservedAt, thresholdBps };
  const entriesFingerprint = waiverEntriesFingerprint(entries);
  const previewFingerprint = sha256({
    v: 1,
    weekId: form.weekId,
    header: { ...header, observedAt: iso(headerObservedAt), formObservedAt: iso(form.observedAt) },
    rawInputSha256: parse.rawInputSha256,
    currentSnapshotId: context.currentSnapshot?.id ?? null,
    rows: rows.map((row) => ({
      lineNumber: row.lineNumber,
      state: row.state,
      issues: row.issues,
      candidates: row.candidates.map((candidate) => candidate.id),
      entry: row.entry ? { ...serializeWaiverEntryEvidence(row.entry), context: waiverEntryContext(row.entry) } : null,
    })),
    entriesFingerprint,
    blockers: blockers.map((issue) => [issue.code, issue.lineNumbers ?? []]),
    requiredAcknowledgments,
    missingFollowUpIds: missingFollowUps.map((player) => player.rankableEntryId),
  });

  return {
    weekId: form.weekId,
    header,
    rawInputSha256: parse.rawInputSha256,
    inputError: parse.error,
    headerSkipped: parse.headerSkipped,
    ignoredLines: parse.ignoredLines,
    rows,
    entries,
    counts,
    rowStateCounts,
    exclusionCounts,
    completeness,
    issues,
    blockers,
    requiredAcknowledgments,
    missingFollowUps,
    firstKickoff,
    locksAt: lock?.locksAt ?? null,
    contestsCanOpen,
    currentSnapshotId: context.currentSnapshot?.id ?? null,
    previewFingerprint,
    entriesFingerprint,
  };
}

export type WaiverAcknowledgmentError =
  | { code: "UNACKNOWLEDGED"; items: string[] }
  | { code: "UNEXPECTED_ACKNOWLEDGMENT"; items: string[] }
  | { code: "FOLLOW_UP_ACK_MISSING"; rankableEntryIds: string[] }
  | { code: "FOLLOW_UP_ACK_UNEXPECTED"; rankableEntryIds: string[] }
  | { code: "FOLLOW_UP_ACK_INVALID"; rankableEntryIds: string[] };

/**
 * Acknowledged CONFIRM codes must equal the required set exactly, and
 * follow-up acknowledgments must cover the missing tracked players exactly,
 * each with a listed reason (OTHER requires a note).
 */
export function validateWaiverAcknowledgments(
  preview: Pick<WaiverSnapshotPreview, "requiredAcknowledgments" | "missingFollowUps">,
  acknowledged: ReadonlyArray<string>,
  followUpAcks: ReadonlyArray<WaiverFollowUpAck>,
): WaiverAcknowledgmentError[] {
  const errors: WaiverAcknowledgmentError[] = [];
  const required = new Set(preview.requiredAcknowledgments);
  const given = new Set(acknowledged);
  const missing = [...required].filter((code) => !given.has(code)).sort();
  const extra = [...given].filter((code) => !required.has(code)).sort();
  if (missing.length > 0) errors.push({ code: "UNACKNOWLEDGED", items: missing });
  if (extra.length > 0) errors.push({ code: "UNEXPECTED_ACKNOWLEDGMENT", items: extra });

  const expectedIds = new Set(preview.missingFollowUps.map((player) => player.rankableEntryId));
  const ackIds = followUpAcks.map((ack) => ack.rankableEntryId);
  const ackSet = new Set(ackIds);
  const ackMissing = [...expectedIds].filter((id) => !ackSet.has(id)).sort();
  const ackExtra = [...new Set(ackIds.filter((id) => !expectedIds.has(id)))].sort();
  const invalid = followUpAcks
    .filter(
      (ack) =>
        !(WAIVER_FOLLOW_UP_ACK_REASONS as readonly string[]).includes(ack.reason) ||
        (ack.reason === "OTHER" && !ack.note?.trim()) ||
        ackIds.filter((id) => id === ack.rankableEntryId).length > 1,
    )
    .map((ack) => ack.rankableEntryId);
  if (ackMissing.length > 0) errors.push({ code: "FOLLOW_UP_ACK_MISSING", rankableEntryIds: ackMissing });
  if (ackExtra.length > 0) errors.push({ code: "FOLLOW_UP_ACK_UNEXPECTED", rankableEntryIds: ackExtra });
  if (invalid.length > 0) errors.push({ code: "FOLLOW_UP_ACK_INVALID", rankableEntryIds: [...new Set(invalid)].sort() });
  return errors;
}