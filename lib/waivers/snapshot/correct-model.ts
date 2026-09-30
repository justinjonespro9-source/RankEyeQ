import { createHash } from "node:crypto";
import type {
  ContestPosition,
  WaiverCorrectionCase,
  WaiverCorrectionPolicy,
  WaiverEligibility,
  WeeklyAvailabilityDesignation,
} from "@/lib/generated/prisma/client";
import { isCanonicalNflTeamAbbr, normalizeTeamAbbr } from "@/lib/nfl/manual/parse-common";
import { WAIVER_MAX_CALLS, WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";
import { resolveWaiverGame, type WaiverEntryFacts, type WaiverWeekGame } from "@/lib/waivers/snapshot/eligibility";
import { parseRosteredPercentToBps, type WaiverInputParse } from "@/lib/waivers/snapshot/input";
import {
  buildWaiverPreviewEntry,
  serializeWaiverEntryEvidence,
  waiverEntriesFingerprint,
  waiverEntryContext,
  waiverSnapshotCounts,
  type WaiverMatchedInputRow,
  type WaiverPreviewEntry,
  type WaiverPreviewIssue,
  type WaiverSnapshotCounts,
} from "@/lib/waivers/snapshot/preview-model";

export const WAIVER_CORRECTION_MAX_OPS = 200;
export const WAIVER_CORRECTION_ROW_ADDED = "ROW_ADDED";
export const WAIVER_CORRECTION_ROW_REMOVED = "ROW_REMOVED";

type OpReason = { reason?: string | null };
export type WaiverCorrectionOp =
  | ({ kind: "SET_ROSTERED"; rankableEntryId: string; percent: string } & OpReason)
  | ({ kind: "REMATCH"; rankableEntryId: string; toRankableEntryId: string } & OpReason)
  | ({ kind: "SET_TEAM_GAME"; rankableEntryId: string; team: string } & OpReason)
  | ({
      kind: "SET_AVAILABILITY";
      rankableEntryId: string;
      designation: WeeklyAvailabilityDesignation;
      hardUnavailable: boolean;
      evidence: string;
    } & OpReason)
  | ({ kind: "ADD_ROWS"; rawText: string } & OpReason)
  | ({ kind: "REMOVE"; rankableEntryId: string } & OpReason);

export type WaiverCorrectionRequest = { snapshotId: string; reason: string; ops: ReadonlyArray<WaiverCorrectionOp> };

export type WaiverCorrectionBase = {
  id: string;
  weekId: string;
  version: number;
  thresholdBps: number;
  sourceLabel: string;
  sourceUrl: string | null;
  observedAt: Date;
  /** frozenAt of version 1: added observations may not postdate the official freeze. */
  originalFrozenAt: Date;
  entries: WaiverPreviewEntry[];
  /** Entries whose frozen derivation context is missing (corrections cannot re-derive them). */
  missingContextIds: string[];
};

export type WaiverCorrectionContestBoards = {
  contestId: string;
  position: ContestPosition;
  locksAt: Date;
  snapshotId: string;
  submissionCount: number;
  /** Current revisions before lock; final (locked) revisions at or after lock. */
  boards: ReadonlyArray<{ submissionId: string; calls: ReadonlyArray<{ callId: string; rankableEntryId: string }> }>;
};

export type WaiverRematchTarget = { rankableEntryId: string; position: ContestPosition; facts: WaiverEntryFacts };

export type WaiverCorrectionContext = {
  now: Date;
  base: WaiverCorrectionBase;
  games: ReadonlyArray<WaiverWeekGame>;
  contests: ReadonlyArray<WaiverCorrectionContestBoards>;
  trackedIds: ReadonlySet<string>;
  rematchTargets: ReadonlyMap<string, WaiverRematchTarget | null>;
  addParse: WaiverInputParse | null;
  addMatched: ReadonlyArray<WaiverMatchedInputRow>;
  addFactsById: ReadonlyMap<string, WaiverEntryFacts>;
};

export type WaiverCorrectionChange = {
  rankableEntryId: string;
  position: ContestPosition;
  field: string;
  originalValue: unknown;
  correctedValue: unknown;
  reason: string;
  eligibilityBefore: WaiverEligibility | null;
  eligibilityAfter: WaiverEligibility | null;
  correctionCase: WaiverCorrectionCase;
  policy: WaiverCorrectionPolicy;
  affectedSubmissionIds: string[];
  affectedCallIds: string[];
};

export type WaiverCorrectionContestImpact = {
  contestId: string;
  position: ContestPosition;
  correctionCase: WaiverCorrectionCase;
  pinnedToBase: boolean;
  willRepin: boolean;
  affectedSubmissionIds: string[];
  affectedCallIds: string[];
};

export type WaiverCorrectionPreview = {
  snapshotId: string;
  weekId: string;
  fromVersion: number;
  toVersion: number;
  reason: string;
  observedAt: Date;
  entries: WaiverPreviewEntry[];
  counts: WaiverSnapshotCounts;
  eligibleByPosition: Array<{ position: WaiverPosition; before: number; after: number }>;
  changes: WaiverCorrectionChange[];
  contests: WaiverCorrectionContestImpact[];
  correctionCase: WaiverCorrectionCase;
  issues: WaiverPreviewIssue[];
  blockers: WaiverPreviewIssue[];
  requiredAcknowledgments: string[];
  inputSha256: string;
  entriesFingerprint: string;
  correctionFingerprint: string;
};

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const CASE_SEVERITY: Record<WaiverCorrectionCase, number> = { PRE_SUBMISSION: 0, OPEN_WITH_SUBMISSIONS: 1, POST_LOCK: 2, POST_GRADE: 3 };
const isPoolMember = (entry: WaiverPreviewEntry | null) => entry?.evidenceRole === "CANDIDATE" && entry.eligibility === "ELIGIBLE";

export function normalizeWaiverCorrectionRequest(request: WaiverCorrectionRequest) {
  return {
    snapshotId: request.snapshotId,
    reason: request.reason.trim(),
    ops: request.ops.map((op) => ({ ...op, reason: op.reason?.trim() || null })),
  };
}

export function waiverCorrectionInputSha256(request: WaiverCorrectionRequest): string {
  return sha256({ v: 1, ...normalizeWaiverCorrectionRequest(request) });
}

export function waiverCorrectionCaseFor(contest: Pick<WaiverCorrectionContestBoards, "locksAt" | "submissionCount">, now: Date): WaiverCorrectionCase {
  if (now.getTime() >= contest.locksAt.getTime()) return "POST_LOCK";
  return contest.submissionCount > 0 ? "OPEN_WITH_SUBMISSIONS" : "PRE_SUBMISSION";
}

/** Re-derives role and eligibility from (possibly corrected) frozen facts with the freeze's pure functions. */
function rederive(entry: WaiverPreviewEntry, patch: Partial<WaiverPreviewEntry>, thresholdBps: number): WaiverPreviewEntry {
  const next = { ...entry, ...patch };
  return buildWaiverPreviewEntry({
    rankableEntryId: next.rankableEntryId,
    position: next.position,
    rosteredBps: next.rosteredBps,
    sourceLabel: next.sourceLabel,
    sourceUrl: next.sourceUrl,
    observedAt: next.observedAt,
    inputLineNumber: next.inputLineNumber,
    inputLine: next.inputLine,
    matchMethod: next.matchMethod,
    sourceTeam: next.sourceTeam,
    teamConflict: next.teamConflict,
    tracked: next.tracked,
    thresholdBps,
    facts: next.facts,
  });
}

const teamConflictOf = (facts: WaiverEntryFacts, sourceTeam: string | null) => (facts.canonicalTeam ?? "FA") !== (sourceTeam ?? "FA");

/**
 * Pure correction assembly: applies targeted operations to the current
 * version's frozen entries, re-derives eligibility from frozen (or explicitly
 * corrected) facts, diffs field by field, and classifies contest impact.
 * Before lock, impact is current-revision calls; at or after lock it is
 * final-board calls and every eligibility change needs a policy decision.
 */
export function assembleWaiverCorrectionPreview(request: WaiverCorrectionRequest, context: WaiverCorrectionContext): WaiverCorrectionPreview {
  const { base, now } = context;
  const normalized = normalizeWaiverCorrectionRequest(request);
  const issues: WaiverPreviewIssue[] = [];
  const blocker = (code: string, message: string, extra: Partial<WaiverPreviewIssue> = {}) =>
    issues.push({ level: "BLOCKER", code, message, ...extra });
  const confirm = (code: string, message: string, extra: Partial<WaiverPreviewIssue> = {}) =>
    issues.push({ level: "CONFIRM", code, message, ...extra });
  const info = (code: string, message: string) => issues.push({ level: "INFO", code, message });

  if (!normalized.reason) blocker("REASON_MISSING", "A correction reason is required");
  if (normalized.ops.length === 0) blocker("NO_OPERATIONS", "Add at least one correction");
  if (normalized.ops.length > WAIVER_CORRECTION_MAX_OPS) blocker("TOO_MANY_OPERATIONS", `At most ${WAIVER_CORRECTION_MAX_OPS} corrections at once`);
  if (base.missingContextIds.length > 0) {
    blocker("FROZEN_FACTS_UNAVAILABLE", "This version has entries without frozen derivation facts; it cannot be corrected here", {
      rankableEntryIds: base.missingContextIds,
    });
  }

  const byId = new Map(base.entries.map((entry) => [entry.rankableEntryId, entry]));
  /** Keyed by the ORIGINAL identity (null key = added row). */
  const edits = new Map<string, { entry: WaiverPreviewEntry | null; reason: string }>();
  const added: Array<{ entry: WaiverPreviewEntry; reason: string }> = [];
  const touched = new Set<string>();
  const claimIdentity = (id: string, opIndex: number) => {
    if (touched.has(id)) {
      blocker("CONFLICTING_OPERATIONS", `Correction ${opIndex + 1} touches a player another correction already changes`, { rankableEntryIds: [id] });
      return false;
    }
    touched.add(id);
    return true;
  };

  normalized.ops.forEach((op, opIndex) => {
    const reason = op.reason ?? normalized.reason;
    if (op.kind === "ADD_ROWS") return;
    const current = byId.get(op.rankableEntryId);
    if (!current) {
      blocker("ENTRY_NOT_FOUND", `Correction ${opIndex + 1}: the player is not in version ${base.version}`, { rankableEntryIds: [op.rankableEntryId] });
      return;
    }
    if (!claimIdentity(op.rankableEntryId, opIndex)) return;
    switch (op.kind) {
      case "REMOVE":
        edits.set(op.rankableEntryId, { entry: null, reason });
        return;
      case "SET_ROSTERED": {
        const bps = parseRosteredPercentToBps(op.percent);
        if (bps === null) {
          blocker("INVALID_PERCENT", `Correction ${opIndex + 1}: "${op.percent}" is not a percentage between 0 and 100 with at most two decimals`);
          return;
        }
        edits.set(op.rankableEntryId, { entry: rederive(current, { rosteredBps: bps }, base.thresholdBps), reason });
        return;
      }
      case "SET_TEAM_GAME": {
        const team = normalizeTeamAbbr(op.team);
        if (!isCanonicalNflTeamAbbr(team)) {
          blocker("INVALID_TEAM", `Correction ${opIndex + 1}: "${op.team}" is not an NFL team`);
          return;
        }
        const game = resolveWaiverGame(team, context.games);
        if (game.kind === "AMBIGUOUS") {
          blocker("AMBIGUOUS_GAME", `Correction ${opIndex + 1}: ${team} appears in more than one game this week`);
          return;
        }
        const facts: WaiverEntryFacts = { ...current.facts, canonicalTeam: team, game };
        edits.set(op.rankableEntryId, {
          entry: rederive(current, { facts, teamConflict: teamConflictOf(facts, current.sourceTeam) }, base.thresholdBps),
          reason,
        });
        return;
      }
      case "SET_AVAILABILITY": {
        const evidence = op.evidence.trim();
        if (!evidence) {
          blocker("AVAILABILITY_EVIDENCE_MISSING", `Correction ${opIndex + 1}: an availability correction needs an evidence note`);
          return;
        }
        const facts: WaiverEntryFacts = {
          ...current.facts,
          availability: {
            designation: op.designation,
            selectable: !op.hardUnavailable,
            rosterStatus: current.facts.availability.rosterStatus,
            unavailableReason: op.hardUnavailable ? `Corrected: ${evidence}` : null,
            source: `SNAPSHOT_CORRECTION|${evidence}`,
          },
        };
        edits.set(op.rankableEntryId, { entry: rederive(current, { facts }, base.thresholdBps), reason });
        return;
      }
      case "REMATCH": {
        const target = context.rematchTargets.get(op.toRankableEntryId) ?? null;
        if (!target) {
          blocker("REMATCH_TARGET_NOT_FOUND", `Correction ${opIndex + 1}: the replacement player does not exist`);
          return;
        }
        if (target.position !== current.position) {
          blocker("REMATCH_POSITION_MISMATCH", `Correction ${opIndex + 1}: the replacement player is not a ${current.position}`);
          return;
        }
        if (op.toRankableEntryId === op.rankableEntryId || byId.has(op.toRankableEntryId)) {
          blocker("REMATCH_TARGET_IN_SNAPSHOT", `Correction ${opIndex + 1}: the replacement player already has a row in this version`);
          return;
        }
        if (!claimIdentity(op.toRankableEntryId, opIndex)) return;
        edits.set(op.rankableEntryId, {
          entry: rederive(
            current,
            {
              rankableEntryId: target.rankableEntryId,
              facts: target.facts,
              matchMethod: "ADMIN_CONFIRMED",
              tracked: context.trackedIds.has(target.rankableEntryId),
              teamConflict: teamConflictOf(target.facts, current.sourceTeam),
            },
            base.thresholdBps,
          ),
          reason,
        });
        return;
      }
    }
  });

  const addOps = normalized.ops.filter((op) => op.kind === "ADD_ROWS");
  if (addOps.length > 1) blocker("CONFLICTING_OPERATIONS", "Combine omitted rows into a single add-rows correction");
  const addOp = addOps[0];
  if (addOp && context.addParse) {
    const reason = addOp.reason ?? normalized.reason;
    if (context.addParse.error) blocker(`ADD_INPUT_${context.addParse.error}`, "The omitted-rows paste is empty or too large");
    let nextLine = Math.max(0, ...base.entries.map((entry) => entry.inputLineNumber));
    const badLines: Record<string, number[]> = {};
    const flag = (code: string, lineNumber: number) => (badLines[code] ??= []).push(lineNumber);
    for (const { input: row, match } of context.addMatched) {
      if (!match || row.issues.length > 0 || row.rosteredBps === null || !row.position) {
        flag("ADD_ROWS_INVALID", row.lineNumber);
        continue;
      }
      if (match.status !== "MATCHED") {
        flag(`ADD_ROWS_${match.status === "INVALID" ? match.reason : match.status}`, row.lineNumber);
        continue;
      }
      const facts = context.addFactsById.get(match.rankableEntryId);
      if (!facts) {
        flag("ADD_ROWS_INVALID", row.lineNumber);
        continue;
      }
      if (byId.has(match.rankableEntryId) || touched.has(match.rankableEntryId)) {
        flag("ADD_ROWS_ALREADY_PRESENT", row.lineNumber);
        continue;
      }
      touched.add(match.rankableEntryId);
      const observedAt = row.observedAt ?? base.observedAt;
      if (observedAt.getTime() > base.originalFrozenAt.getTime()) {
        flag("ADD_ROWS_OBSERVED_AFTER_FREEZE", row.lineNumber);
        continue;
      }
      if (facts.game.kind === "AMBIGUOUS") {
        flag("AMBIGUOUS_GAME", row.lineNumber);
        continue;
      }
      const overrideLabel = row.sourceLabel?.trim() || null;
      nextLine += 1;
      added.push({
        reason,
        entry: buildWaiverPreviewEntry({
          rankableEntryId: match.rankableEntryId,
          position: row.position,
          rosteredBps: row.rosteredBps,
          sourceLabel: overrideLabel ?? base.sourceLabel,
          sourceUrl: overrideLabel ? null : base.sourceUrl,
          observedAt,
          inputLineNumber: nextLine,
          inputLine: row.line,
          matchMethod: match.method,
          sourceTeam: row.team,
          teamConflict: match.teamConflict,
          tracked: context.trackedIds.has(match.rankableEntryId),
          thresholdBps: base.thresholdBps,
          facts,
        }),
      });
    }
    for (const [code, lineNumbers] of Object.entries(badLines)) {
      blocker(code, "Omitted rows must parse, match exactly one new player, and be observed no later than the original freeze", { lineNumbers });
    }
  }

  const entries: WaiverPreviewEntry[] = [];
  for (const entry of base.entries) {
    const edit = edits.get(entry.rankableEntryId);
    if (!edit) entries.push(entry);
    else if (edit.entry) entries.push(edit.entry);
  }
  entries.push(...added.map((row) => row.entry));

  const contestByPosition = new Map(context.contests.map((contest) => [contest.position, contest]));
  const newPool = new Map<ContestPosition, Set<string>>();
  for (const entry of entries) {
    if (!isPoolMember(entry)) continue;
    if (!newPool.has(entry.position)) newPool.set(entry.position, new Set());
    newPool.get(entry.position)!.add(entry.rankableEntryId);
  }
  const contests: WaiverCorrectionContestImpact[] = context.contests.map((contest) => {
    const correctionCase = waiverCorrectionCaseFor(contest, now);
    const pool = newPool.get(contest.position) ?? new Set<string>();
    const affectedSubmissionIds: string[] = [];
    const affectedCallIds: string[] = [];
    for (const board of contest.boards) {
      const calls = board.calls.filter((call) => !pool.has(call.rankableEntryId));
      if (calls.length === 0) continue;
      affectedSubmissionIds.push(board.submissionId);
      affectedCallIds.push(...calls.map((call) => call.callId));
    }
    const pinnedToBase = contest.snapshotId === base.id;
    return {
      contestId: contest.contestId,
      position: contest.position,
      correctionCase,
      pinnedToBase,
      willRepin: pinnedToBase && correctionCase !== "POST_LOCK",
      affectedSubmissionIds,
      affectedCallIds,
    };
  });
  const impactById = new Map(contests.map((contest) => [contest.contestId, contest]));
  const boardCallsOn = (position: ContestPosition, rankableEntryId: string) => {
    const contest = contestByPosition.get(position);
    if (!contest) return { submissionIds: [] as string[], callIds: [] as string[] };
    const impact = impactById.get(contest.contestId)!;
    const affected = new Set(impact.affectedCallIds);
    const submissionIds: string[] = [];
    const callIds: string[] = [];
    for (const board of contest.boards) {
      const calls = board.calls.filter((call) => call.rankableEntryId === rankableEntryId && affected.has(call.callId));
      if (calls.length === 0) continue;
      submissionIds.push(board.submissionId);
      callIds.push(...calls.map((call) => call.callId));
    }
    return { submissionIds, callIds };
  };

  const changes: WaiverCorrectionChange[] = [];
  const pushChanges = (before: WaiverPreviewEntry | null, after: WaiverPreviewEntry | null, reason: string) => {
    const subject = (after ?? before)!;
    const contest = contestByPosition.get(subject.position);
    const correctionCase = contest ? impactById.get(contest.contestId)!.correctionCase : "PRE_SUBMISSION";
    const poolEffect =
      isPoolMember(before) !== isPoolMember(after) ||
      (before !== null && after !== null && before.rankableEntryId !== after.rankableEntryId && (isPoolMember(before) || isPoolMember(after)));
    const affected = before ? boardCallsOn(subject.position, before.rankableEntryId) : { submissionIds: [], callIds: [] };
    const policy: WaiverCorrectionPolicy = !poolEffect
      ? "NO_BOARD_EFFECT"
      : correctionCase === "POST_LOCK"
        ? "POLICY_DECISION_REQUIRED"
        : affected.callIds.length > 0
          ? "AFFECTED_BOARDS_FLAGGED"
          : "NO_BOARD_EFFECT";
    const common = {
      rankableEntryId: subject.rankableEntryId,
      position: subject.position,
      reason,
      eligibilityBefore: before?.eligibility ?? null,
      eligibilityAfter: after?.eligibility ?? null,
      correctionCase,
      policy,
      affectedSubmissionIds: affected.submissionIds,
      affectedCallIds: affected.callIds,
    };
    if (!before || !after) {
      changes.push({
        ...common,
        field: before ? WAIVER_CORRECTION_ROW_REMOVED : WAIVER_CORRECTION_ROW_ADDED,
        originalValue: before ? serializeWaiverEntryEvidence(before) : null,
        correctedValue: after ? serializeWaiverEntryEvidence(after) : null,
      });
      return;
    }
    const a = { ...serializeWaiverEntryEvidence(before), teamConflict: before.teamConflict } as Record<string, unknown>;
    const b = { ...serializeWaiverEntryEvidence(after), teamConflict: after.teamConflict } as Record<string, unknown>;
    for (const field of Object.keys(b)) {
      if (JSON.stringify(a[field]) === JSON.stringify(b[field])) continue;
      changes.push({ ...common, field, originalValue: a[field], correctedValue: b[field] });
    }
    if (JSON.stringify(waiverEntryContext(before).facts) !== JSON.stringify(waiverEntryContext(after).facts)) {
      changes.push({ ...common, field: "facts", originalValue: waiverEntryContext(before).facts, correctedValue: waiverEntryContext(after).facts });
    }
  };
  for (const entry of base.entries) {
    const edit = edits.get(entry.rankableEntryId);
    if (edit) pushChanges(entry, edit.entry, edit.reason);
  }
  for (const row of added) pushChanges(null, row.entry, row.reason);
  if (normalized.ops.length > 0 && changes.length === 0 && !issues.some((issue) => issue.level === "BLOCKER")) {
    blocker("NO_CHANGES", "The corrections do not change any frozen evidence");
  }

  const eligibleByPosition = WAIVER_POSITIONS.map((position) => ({
    position,
    before: base.entries.filter((entry) => entry.position === position && isPoolMember(entry)).length,
    after: entries.filter((entry) => entry.position === position && isPoolMember(entry)).length,
  }));

  const kinds = new Set(normalized.ops.map((op) => op.kind));
  if (kinds.has("SET_ROSTERED") || kinds.has("ADD_ROWS")) {
    confirm(
      "OFFICIAL_OBSERVATION_EVIDENCE",
      "Every corrected or added percentage is the source's value at the official observation time (no later value is used)",
    );
  }
  if (kinds.has("REMATCH") || kinds.has("ADD_ROWS")) {
    confirm(
      "FACTS_CAPTURED_AT_CORRECTION",
      "Rematched and added players' team, game and availability facts are captured now, at correction time, not at the original freeze",
    );
  }
  if (kinds.has("SET_AVAILABILITY")) info("AVAILABILITY_EVIDENCE_ONLY", "Availability corrections change snapshot evidence only, never live weekly availability");
  const conflicts = entries.filter((entry) => entry.teamConflict && changes.some((change) => change.rankableEntryId === entry.rankableEntryId));
  if (conflicts.length > 0) {
    confirm("TEAM_CONFLICT", "A corrected row's source team differs from the canonical team; canonical team and game facts are used", {
      rankableEntryIds: conflicts.map((entry) => entry.rankableEntryId),
    });
  }
  for (const row of eligibleByPosition) {
    if (row.after === 0 && row.before > 0) {
      confirm(`ZERO_ELIGIBLE:${row.position}`, `${row.position} would have no eligible players`);
    } else if (row.after < WAIVER_MAX_CALLS[row.position] && row.after < row.before) {
      confirm(`REDUCED_DEPTH:${row.position}`, `${row.position} eligible players drop from ${row.before} to ${row.after}`);
    }
  }
  if (contests.some((contest) => contest.correctionCase === "POST_LOCK")) {
    confirm(
      "POST_LOCK_RECORD_ONLY",
      "A contest has locked: the new version is recorded as the factual record only; locked contests keep their pinned version and nothing is graded",
    );
  }
  if (changes.some((change) => change.policy === "AFFECTED_BOARDS_FLAGGED")) {
    confirm("AFFECTED_BOARDS", "Open boards call players who leave the eligible pool; they are flagged for review and are not rewritten");
  }
  if (changes.some((change) => change.policy === "POLICY_DECISION_REQUIRED")) {
    confirm("POLICY_DECISION_REQUIRED", "Eligibility changed after lock; treatment of locked boards requires a product decision");
  }

  const observedTimes = [base.observedAt, ...added.map((row) => row.entry.observedAt)];
  const observedAt = new Date(Math.max(...observedTimes.map((date) => date.getTime())));
  const correctionCase = contests.reduce<WaiverCorrectionCase>(
    (worst, contest) => (CASE_SEVERITY[contest.correctionCase] > CASE_SEVERITY[worst] ? contest.correctionCase : worst),
    "PRE_SUBMISSION",
  );
  const blockers = issues.filter((issue) => issue.level === "BLOCKER");
  const requiredAcknowledgments = issues
    .filter((issue) => issue.level === "CONFIRM")
    .map((issue) => issue.code)
    .sort();
  const inputSha256 = waiverCorrectionInputSha256(request);
  const entriesFingerprint = waiverEntriesFingerprint(entries);
  const correctionFingerprint = sha256({
    v: 1,
    snapshotId: base.id,
    inputSha256,
    entries: entries.map((entry) => ({ ...serializeWaiverEntryEvidence(entry), context: waiverEntryContext(entry) })),
    changes,
    contests,
    correctionCase,
    blockers: blockers.map((issue) => [issue.code, issue.lineNumbers ?? [], issue.rankableEntryIds ?? []]),
    requiredAcknowledgments,
  });

  return {
    snapshotId: base.id,
    weekId: base.weekId,
    fromVersion: base.version,
    toVersion: base.version + 1,
    reason: normalized.reason,
    observedAt,
    entries,
    counts: waiverSnapshotCounts(entries),
    eligibleByPosition,
    changes,
    contests,
    correctionCase,
    issues,
    blockers,
    requiredAcknowledgments,
    inputSha256,
    entriesFingerprint,
    correctionFingerprint,
  };
}
