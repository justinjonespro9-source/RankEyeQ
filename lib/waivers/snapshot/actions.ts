"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import { logServerEvent } from "@/lib/log";
import { applyWaiverCorrection, previewWaiverCorrection } from "@/lib/waivers/snapshot/correct";
import { WAIVER_CORRECTION_MAX_OPS, type WaiverCorrectionOp, type WaiverCorrectionPreview, type WaiverCorrectionRequest } from "@/lib/waivers/snapshot/correct-model";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";
import { freezeWaiverSnapshot } from "@/lib/waivers/snapshot/freeze";
import { parseWaiverObservedAt, WAIVER_INPUT_MAX_CHARS } from "@/lib/waivers/snapshot/input";
import { previewWaiverSnapshot, type WaiverSnapshotPreviewInput } from "@/lib/waivers/snapshot/preview";
import {
  serializeWaiverEntryEvidence,
  WAIVER_FOLLOW_UP_ACK_REASONS,
  type WaiverFollowUpAck,
  type WaiverPreviewEntry,
  type WaiverSnapshotPreview,
} from "@/lib/waivers/snapshot/preview-model";

const MAX_ID = 64;
const MAX_LABEL = 120;
const MAX_URL = 500;
const MAX_REASON = 1000;
const MAX_ACKS = 64;
const MAX_FOLLOW_UP_ACKS = 500;
const DESIGNATIONS = ["AVAILABLE", "QUESTIONABLE", "DOUBTFUL", "OUT", "INACTIVE", "UNKNOWN"] as const;

type ActionError = { ok: false; error: string; code: string; details?: unknown };
const invalid = (error = "Invalid request"): ActionError => ({ ok: false, error, code: "INVALID_INPUT" });

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function adminUserId(): Promise<string | null> {
  try {
    return (await assertAdmin()).user.id;
  } catch {
    return null;
  }
}

function failure(error: unknown, event: string): ActionError {
  if (error instanceof WaiverSnapshotError) return { ok: false, error: error.message, code: error.code, details: error.details ?? null };
  logServerEvent(event, {}, "error");
  return { ok: false, error: "Unexpected error; nothing was saved", code: "UNKNOWN" };
}

function parseSnapshotForm(input: unknown): { ok: true; value: WaiverSnapshotPreviewInput } | ActionError {
  if (!isObject(input)) return invalid();
  const { weekId, rawText, sourceLabel, sourceUrl, observedAt } = input;
  if (!isId(weekId)) return invalid("Invalid week");
  if (!isText(rawText, WAIVER_INPUT_MAX_CHARS)) return invalid("The paste exceeds the size limit");
  if (!isText(sourceLabel, MAX_LABEL)) return invalid("Invalid source label");
  if (sourceUrl !== null && sourceUrl !== undefined && !isText(sourceUrl, MAX_URL)) return invalid("Invalid source URL");
  if (typeof sourceUrl === "string" && sourceUrl.trim() && !/^https?:\/\//i.test(sourceUrl.trim())) return invalid("Source URL must start with http(s)://");
  if (!isText(observedAt, 64)) return invalid("Invalid observation time");
  const parsedObservedAt = observedAt.trim() ? parseWaiverObservedAt(observedAt) : null;
  if (observedAt.trim() && !parsedObservedAt) return invalid("Observation time must be Chicago local (YYYY-MM-DDTHH:MM) or ISO with a zone");
  return {
    ok: true,
    value: { weekId, rawText, sourceLabel, sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null, observedAt: parsedObservedAt },
  };
}

function parseAcknowledged(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ACKS) return null;
  return value.every((code) => isText(code, 64)) ? (value as string[]) : null;
}

function parseFollowUpAcks(value: unknown): WaiverFollowUpAck[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FOLLOW_UP_ACKS) return null;
  const acks: WaiverFollowUpAck[] = [];
  for (const raw of value) {
    if (!isObject(raw) || !isId(raw.rankableEntryId)) return null;
    if (!(WAIVER_FOLLOW_UP_ACK_REASONS as readonly unknown[]).includes(raw.reason)) return null;
    if (raw.note !== null && raw.note !== undefined && !isText(raw.note, MAX_REASON)) return null;
    acks.push({ rankableEntryId: raw.rankableEntryId, reason: raw.reason as WaiverFollowUpAck["reason"], note: (raw.note as string | null | undefined)?.trim() || null });
  }
  return acks;
}

function parseCorrectionOp(raw: unknown): WaiverCorrectionOp | null {
  if (!isObject(raw)) return null;
  const reason = raw.reason === undefined || raw.reason === null ? null : isText(raw.reason, MAX_REASON) ? raw.reason : undefined;
  if (reason === undefined) return null;
  switch (raw.kind) {
    case "SET_ROSTERED":
      return isId(raw.rankableEntryId) && isText(raw.percent, 16) ? { kind: raw.kind, rankableEntryId: raw.rankableEntryId, percent: raw.percent, reason } : null;
    case "REMATCH":
      return isId(raw.rankableEntryId) && isId(raw.toRankableEntryId)
        ? { kind: raw.kind, rankableEntryId: raw.rankableEntryId, toRankableEntryId: raw.toRankableEntryId, reason }
        : null;
    case "SET_TEAM_GAME":
      return isId(raw.rankableEntryId) && isText(raw.team, 8) ? { kind: raw.kind, rankableEntryId: raw.rankableEntryId, team: raw.team, reason } : null;
    case "SET_AVAILABILITY":
      return isId(raw.rankableEntryId) &&
        (DESIGNATIONS as readonly unknown[]).includes(raw.designation) &&
        typeof raw.hardUnavailable === "boolean" &&
        isText(raw.evidence, MAX_REASON)
        ? {
            kind: raw.kind,
            rankableEntryId: raw.rankableEntryId,
            designation: raw.designation as (typeof DESIGNATIONS)[number],
            hardUnavailable: raw.hardUnavailable,
            evidence: raw.evidence,
            reason,
          }
        : null;
    case "ADD_ROWS":
      return isText(raw.rawText, WAIVER_INPUT_MAX_CHARS) ? { kind: raw.kind, rawText: raw.rawText, reason } : null;
    case "REMOVE":
      return isId(raw.rankableEntryId) ? { kind: raw.kind, rankableEntryId: raw.rankableEntryId, reason } : null;
    default:
      return null;
  }
}

function parseCorrectionRequest(input: unknown): { ok: true; value: WaiverCorrectionRequest } | ActionError {
  if (!isObject(input) || !isId(input.snapshotId) || !isText(input.reason, MAX_REASON)) return invalid();
  if (!Array.isArray(input.ops) || input.ops.length > WAIVER_CORRECTION_MAX_OPS) return invalid("Invalid corrections");
  const ops: WaiverCorrectionOp[] = [];
  for (const raw of input.ops) {
    const op = parseCorrectionOp(raw);
    if (!op) return invalid("Invalid correction");
    ops.push(op);
  }
  return { ok: true, value: { snapshotId: input.snapshotId, reason: input.reason, ops } };
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

function shapeEntry(entry: WaiverPreviewEntry) {
  return { ...serializeWaiverEntryEvidence(entry), sourceTeam: entry.sourceTeam, teamConflict: entry.teamConflict, tracked: entry.tracked };
}

export type WaiverSnapshotPreviewView = ReturnType<typeof shapeSnapshotPreview>;

function shapeSnapshotPreview(preview: WaiverSnapshotPreview) {
  return {
    weekId: preview.weekId,
    header: { ...preview.header, observedAt: iso(preview.header.observedAt) },
    rawInputSha256: preview.rawInputSha256,
    inputError: preview.inputError,
    headerSkipped: preview.headerSkipped,
    ignoredLines: preview.ignoredLines,
    rows: preview.rows.map((row) => ({
      lineNumber: row.lineNumber,
      line: row.line,
      playerName: row.playerName,
      positionRaw: row.positionRaw,
      teamRaw: row.teamRaw,
      percentRaw: row.percentRaw,
      state: row.state,
      issues: row.issues,
      candidates: row.candidates,
      entry: row.entry ? shapeEntry(row.entry) : null,
    })),
    counts: preview.counts,
    rowStateCounts: preview.rowStateCounts,
    exclusionCounts: preview.exclusionCounts,
    completeness: preview.completeness,
    issues: preview.issues,
    blockers: preview.blockers,
    requiredAcknowledgments: preview.requiredAcknowledgments,
    missingFollowUps: preview.missingFollowUps,
    firstKickoff: iso(preview.firstKickoff),
    locksAt: iso(preview.locksAt),
    contestsCanOpen: preview.contestsCanOpen,
    currentSnapshotId: preview.currentSnapshotId,
    previewFingerprint: preview.previewFingerprint,
  };
}

export type WaiverCorrectionPreviewView = ReturnType<typeof shapeCorrectionPreview>;

function shapeCorrectionPreview(preview: WaiverCorrectionPreview) {
  const changedIds = new Set(preview.changes.map((change) => change.rankableEntryId));
  return {
    snapshotId: preview.snapshotId,
    weekId: preview.weekId,
    fromVersion: preview.fromVersion,
    toVersion: preview.toVersion,
    reason: preview.reason,
    observedAt: preview.observedAt.toISOString(),
    counts: preview.counts,
    eligibleByPosition: preview.eligibleByPosition,
    changes: preview.changes,
    changedEntries: preview.entries.filter((entry) => changedIds.has(entry.rankableEntryId)).map(shapeEntry),
    contests: preview.contests,
    correctionCase: preview.correctionCase,
    issues: preview.issues,
    blockers: preview.blockers,
    requiredAcknowledgments: preview.requiredAcknowledgments,
    correctionFingerprint: preview.correctionFingerprint,
  };
}

/** Read-only snapshot preview (admin only). Writes nothing. */
export async function previewWaiverSnapshotAction(input: unknown) {
  if (!(await adminUserId())) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  const parsed = parseSnapshotForm(input);
  if (!parsed.ok) return parsed;
  try {
    return { ok: true as const, preview: shapeSnapshotPreview(await previewWaiverSnapshot(parsed.value)) };
  } catch (error) {
    return failure(error, "waivers.snapshot_preview_failed");
  }
}

/** Freezes version 1 after a server-side preview rebuild. Never opens contests. */
export async function freezeWaiverSnapshotAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  const parsed = parseSnapshotForm(input);
  if (!parsed.ok) return parsed;
  const raw = input as Record<string, unknown>;
  const acknowledged = parseAcknowledged(raw.acknowledged);
  const followUpAcks = parseFollowUpAcks(raw.followUpAcks);
  if (!isText(raw.previewFingerprint, 128) || !acknowledged || !followUpAcks) return invalid();
  try {
    const result = await freezeWaiverSnapshot({
      ...parsed.value,
      adminUserId: userId,
      previewFingerprint: raw.previewFingerprint,
      acknowledged,
      followUpAcks,
    });
    revalidatePath("/admin/waivers");
    return {
      ok: true as const,
      snapshotId: result.snapshotId,
      version: result.version,
      alreadyFrozen: result.alreadyFrozen,
      frozenAt: result.frozenAt.toISOString(),
      counts: result.counts,
      contestsCanOpen: result.contestsCanOpen,
    };
  } catch (error) {
    return failure(error, "waivers.snapshot_freeze_failed");
  }
}

/** Read-only correction preview against the current version. */
export async function previewWaiverCorrectionAction(input: unknown) {
  if (!(await adminUserId())) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  const parsed = parseCorrectionRequest(input);
  if (!parsed.ok) return parsed;
  try {
    return { ok: true as const, preview: shapeCorrectionPreview(await previewWaiverCorrection(parsed.value)) };
  } catch (error) {
    return failure(error, "waivers.correction_preview_failed");
  }
}

/** Applies a correction as version n+1 (re-pins open contests only; never grades). */
export async function applyWaiverCorrectionAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  const parsed = parseCorrectionRequest(input);
  if (!parsed.ok) return parsed;
  const raw = input as Record<string, unknown>;
  const acknowledged = parseAcknowledged(raw.acknowledged);
  if (!isText(raw.correctionFingerprint, 128) || !acknowledged) return invalid();
  try {
    const result = await applyWaiverCorrection({ ...parsed.value, adminUserId: userId, correctionFingerprint: raw.correctionFingerprint, acknowledged });
    revalidatePath("/admin/waivers");
    return {
      ok: true as const,
      snapshotId: result.snapshotId,
      version: result.version,
      supersededSnapshotId: result.supersededSnapshotId,
      frozenAt: result.frozenAt.toISOString(),
      correctionCase: result.correctionCase,
      changeCount: result.changeCount,
      repin: result.repin.map((outcome) => ({ contestId: outcome.contestId, position: outcome.position, outcome: outcome.outcome, policy: outcome.policy })),
    };
  } catch (error) {
    return failure(error, "waivers.correction_apply_failed");
  }
}
