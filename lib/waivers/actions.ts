"use server";

import { assertClientProfileMatchesSession, canSubmitFromRankingWorkspace } from "@/lib/auth/participation";
import { assertAdmin, getAuthContext } from "@/lib/auth/session";
import { logServerEvent } from "@/lib/log";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import { WAIVER_MAX_CALLS } from "@/lib/waivers/constants";
import { openWaiverContestsForWeek, WaiverContestError } from "@/lib/waivers/contests";
import {
  saveWaiverDraft,
  submitWaiverBoard,
  WaiverSubmissionError,
  type WaiverBoardWriteResult,
} from "@/lib/waivers/submissions";

const MAX_ID_LENGTH = 64;
const MAX_SLOTS = Math.max(...Object.values(WAIVER_MAX_CALLS));

type ActionError = { ok: false; error: string; code?: string };

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function parseBoardInput(input: unknown):
  | { ok: true; contestId: string; playerIds: (string | null)[]; clientProfileId: string | undefined }
  | ActionError {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Invalid request", code: "INVALID_INPUT" };
  const raw = input as { contestId?: unknown; playerIds?: unknown; universalProfileId?: unknown };
  if (!isId(raw.contestId)) return { ok: false, error: "Invalid contest", code: "INVALID_INPUT" };
  if (!Array.isArray(raw.playerIds) || raw.playerIds.length > MAX_SLOTS) {
    return { ok: false, error: "Invalid Waiver board", code: "INVALID_INPUT" };
  }
  const playerIds: (string | null)[] = [];
  for (const value of raw.playerIds) {
    if (value === null || value === undefined || value === "") playerIds.push(null);
    else if (isId(value)) playerIds.push(value);
    else return { ok: false, error: "Invalid Waiver board", code: "INVALID_INPUT" };
  }
  if (raw.universalProfileId !== undefined && raw.universalProfileId !== null && typeof raw.universalProfileId !== "string") {
    return { ok: false, error: "Invalid request", code: "INVALID_INPUT" };
  }
  return {
    ok: true,
    contestId: raw.contestId,
    playerIds,
    clientProfileId: (raw.universalProfileId as string | null | undefined) ?? undefined,
  };
}

async function resolveWaiverParticipant() {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: "Sign in to enter Waiver boards", code: "SIGNED_OUT" };
  if (!ctx.universalProfile) {
    return { ok: false as const, error: "Finish profile setup to participate", code: "NEEDS_SETUP" };
  }
  if (!canSubmitFromRankingWorkspace(ctx.universalProfile.profileType)) {
    return { ok: false as const, error: "This profile cannot enter Waiver boards", code: "FORBIDDEN" };
  }
  if (ctx.universalProfile.status === "SUSPENDED") {
    return { ok: false as const, error: "This profile is suspended and cannot enter Waiver boards", code: "SUSPENDED" };
  }
  return { ok: true as const, userId: ctx.user.id, universalProfileId: ctx.universalProfile.id };
}

function shapeResult(result: WaiverBoardWriteResult) {
  return {
    ok: true as const,
    status: result.status,
    revisionNumber: result.revisionNumber,
    callCount: result.callCount,
    changed: result.changed,
    submittedAt: result.submittedAt?.toISOString() ?? null,
  };
}

async function runBoardWrite(input: unknown, mode: "draft" | "submit") {
  const parsed = parseBoardInput(input);
  if (!parsed.ok) return parsed;

  const participant = await resolveWaiverParticipant();
  if (!participant.ok) return { ok: false as const, error: participant.error, code: participant.code };

  const spoof = assertClientProfileMatchesSession(participant.universalProfileId, parsed.clientProfileId);
  if (!spoof.ok) {
    logServerEvent("auth.profile_spoof", { action: `waiver_${mode}` }, "warn");
    return { ok: false as const, error: spoof.error, code: "FORBIDDEN" };
  }

  const limited = rateLimit({
    key: await rateLimitKey(mode === "draft" ? "waiver-draft" : "waiver-submit", participant.universalProfileId),
    ...(mode === "draft" ? RATE_LIMITS.draftSave : RATE_LIMITS.submit),
  });
  if (!limited.ok) return { ok: false as const, error: rateLimitErrorMessage(limited), code: "RATE_LIMITED" };

  const write = mode === "draft" ? saveWaiverDraft : submitWaiverBoard;
  try {
    const result = await write({
      contestId: parsed.contestId,
      universalProfileId: participant.universalProfileId,
      userId: participant.userId,
      playerIds: parsed.playerIds,
    });
    return shapeResult(result);
  } catch (error) {
    if (error instanceof WaiverSubmissionError) {
      return { ok: false as const, error: error.message, code: error.code };
    }
    logServerEvent("waivers.board_write_failed", { mode }, "error");
    return { ok: false as const, error: "Unable to save Waiver board", code: "UNKNOWN" };
  }
}

/** Saves a noncompetitive draft. Refused once the board has been submitted. */
export async function saveWaiverDraftAction(input: {
  contestId: string;
  playerIds: (string | null)[];
  /** Ignored — the profile is derived from the authenticated session. */
  universalProfileId?: string;
}) {
  return runBoardWrite(input, "draft");
}

/** Submits or re-submits a board (0..effective max calls; zero = explicit abstention). */
export async function submitWaiverBoardAction(input: {
  contestId: string;
  playerIds: (string | null)[];
  /** Ignored — the profile is derived from the authenticated session. */
  universalProfileId?: string;
}) {
  return runBoardWrite(input, "submit");
}

/** Admin-only manual opening of the week's Waiver Podiums. */
export async function openWaiverContestsAction(input: { weekId: string; snapshotId: string }) {
  let adminUserId: string;
  try {
    adminUserId = (await assertAdmin()).user.id;
  } catch {
    return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  }
  if (typeof input !== "object" || input === null || !isId(input.weekId) || !isId(input.snapshotId)) {
    return { ok: false as const, error: "Invalid request", code: "INVALID_INPUT" };
  }
  try {
    const result = await openWaiverContestsForWeek({
      adminUserId,
      weekId: input.weekId,
      snapshotId: input.snapshotId,
    });
    return {
      ok: true as const,
      locksAt: result.locksAt.toISOString(),
      opened: result.opened,
      existing: result.existing,
      refused: result.refused,
    };
  } catch (error) {
    if (error instanceof WaiverContestError) {
      return { ok: false as const, error: error.message, code: error.code };
    }
    logServerEvent("waivers.open_contests_failed", {}, "error");
    return { ok: false as const, error: "Unable to open Waiver contests", code: "UNKNOWN" };
  }
}
