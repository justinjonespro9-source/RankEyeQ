import { beforeEach, describe, expect, it, vi } from "vitest";

const authState: { admin: unknown } = { admin: null };
vi.mock("@/lib/auth/session", () => ({
  assertAdmin: async () => {
    if (!authState.admin) throw new Error("Admin access required");
    return authState.admin;
  },
}));
vi.mock("@/lib/request-ip", () => ({
  rateLimitKey: async (scope: string, subject?: string | null) => `${scope}:${subject ?? "test"}`,
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const importAiWaiverBoard = vi.fn();
const previewWaiverAiResponse = vi.fn();
vi.mock("@/lib/waivers/ai/submissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/waivers/ai/submissions")>();
  return {
    ...actual,
    importAiWaiverBoard: (...args: unknown[]) => importAiWaiverBoard(...args),
    previewWaiverAiResponse: (...args: unknown[]) => previewWaiverAiResponse(...args),
  };
});
const previewWaiverAiEvidence = vi.fn();
const recordWaiverAiEvidence = vi.fn();
const reviewWaiverAiEvidence = vi.fn();
vi.mock("@/lib/waivers/ai/evidence", () => ({
  previewWaiverAiEvidence: (...args: unknown[]) => previewWaiverAiEvidence(...args),
  recordWaiverAiEvidence: (...args: unknown[]) => recordWaiverAiEvidence(...args),
  reviewWaiverAiEvidence: (...args: unknown[]) => reviewWaiverAiEvidence(...args),
}));

import {
  previewWaiverAiEvidenceAction,
  previewWaiverAiResponseAction,
  recordWaiverAiEvidenceAction,
  reviewWaiverAiEvidenceAction,
  submitWaiverAiBoardAction,
} from "@/lib/waivers/ai/actions";
import { WaiverAiError } from "@/lib/waivers/ai/submissions";

const SHA = "a".repeat(64);
let seq = 0;
function signIn() {
  seq += 1;
  const admin = { user: { id: `admin-${seq}` } };
  authState.admin = admin;
  return admin.user.id;
}

const submitInput = (overrides: Record<string, unknown> = {}) => ({
  contestId: "c1",
  profileId: "ai1",
  responseText: "1. Player",
  expectedResponseSha256: SHA,
  expectedPromptSha256: SHA,
  confirmedRankableEntryIds: ["re1"],
  modelLabel: "Model",
  statedGeneratedAt: "",
  sourceReference: "",
  sourceNote: "",
  ...overrides,
});

beforeEach(() => {
  authState.admin = null;
  for (const mock of [importAiWaiverBoard, previewWaiverAiResponse, previewWaiverAiEvidence, recordWaiverAiEvidence, reviewWaiverAiEvidence, revalidatePath]) {
    mock.mockReset();
  }
});

describe("AI Waiver admin actions", () => {
  it("every action requires an admin and calls nothing otherwise", async () => {
    const results = await Promise.all([
      previewWaiverAiResponseAction({ contestId: "c1", responseText: "x" }),
      submitWaiverAiBoardAction(submitInput()),
      previewWaiverAiEvidenceAction({ contestId: "c1", responseText: "x" }),
      recordWaiverAiEvidenceAction({}),
      reviewWaiverAiEvidenceAction({}),
    ]);
    for (const result of results) expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    for (const mock of [importAiWaiverBoard, previewWaiverAiResponse, previewWaiverAiEvidence, recordWaiverAiEvidence, reviewWaiverAiEvidence]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("submits as the session admin, parses the stated time as Chicago local, and revalidates both pages", async () => {
    const adminId = signIn();
    importAiWaiverBoard.mockResolvedValue({ submissionId: "s1", revisionNumber: 1, callCount: 1, noCalls: false, responseSha256: SHA, changed: true, submittedAt: new Date("2026-10-06T20:00:00Z") });
    const result = await submitWaiverAiBoardAction(submitInput({ adminUserId: "someone-else", statedGeneratedAt: "2026-10-06T14:30" }));
    expect(result).toMatchObject({ ok: true, revisionNumber: 1, changed: true, submittedAt: "2026-10-06T20:00:00.000Z" });
    expect(importAiWaiverBoard).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: adminId, universalProfileId: "ai1", statedGeneratedAt: new Date("2026-10-06T19:30:00Z") }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/ai");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/waivers/ai/ai1/c1");
  });

  it("validates input shape before calling the service", async () => {
    signIn();
    for (const bad of [
      submitInput({ expectedResponseSha256: "nope" }),
      submitInput({ confirmedRankableEntryIds: ["1", "2", "3", "4", "5", "6"] }),
      submitInput({ confirmedRankableEntryIds: "re1" }),
      submitInput({ modelLabel: " " }),
      submitInput({ statedGeneratedAt: "yesterday" }),
      submitInput({ responseText: 42 }),
      submitInput({ profileId: "" }),
    ]) {
      expect(await submitWaiverAiBoardAction(bad)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect(importAiWaiverBoard).not.toHaveBeenCalled();
  });

  it("maps service errors with their parse issues, and hides unexpected errors", async () => {
    signIn();
    const issues = [{ code: "UNKNOWN_PLAYER" as const, lineNumber: 1, message: "Line 1: nope" }];
    importAiWaiverBoard.mockRejectedValueOnce(new WaiverAiError("INVALID_RESPONSE", "The AI response is invalid; nothing was saved", issues));
    expect(await submitWaiverAiBoardAction(submitInput())).toEqual({ ok: false, code: "INVALID_RESPONSE", error: "The AI response is invalid; nothing was saved", issues });
    importAiWaiverBoard.mockRejectedValueOnce(new Error("connection reset with secret details"));
    expect(await submitWaiverAiBoardAction(submitInput())).toMatchObject({ ok: false, code: "UNKNOWN", error: "Unexpected error; nothing was saved" });
  });

  it("records evidence as the session admin with an optional note and stated time", async () => {
    const adminId = signIn();
    recordWaiverAiEvidence.mockResolvedValue({ evidenceId: "e1", recordedAt: new Date("2026-10-08T00:00:00Z"), recordedAfterLock: true, responseSha256: SHA });
    const result = await recordWaiverAiEvidenceAction({
      contestId: "c1",
      profileId: "ai1",
      responseText: "NO CALLS",
      expectedResponseSha256: SHA,
      modelLabel: "Model",
      statedSourceAt: "",
      evidenceSource: "CHAT_EXPORT",
      evidenceReference: "file",
      note: "",
    });
    expect(result).toMatchObject({ ok: true, recordedAfterLock: true });
    expect(recordWaiverAiEvidence).toHaveBeenCalledWith(expect.objectContaining({ adminUserId: adminId, statedSourceAt: null, note: null }));
  });

  it("reviews require a non-negative integer sequence", async () => {
    signIn();
    for (const expectedSequence of [-1, 1.5, "1"]) {
      expect(await reviewWaiverAiEvidenceAction({ evidenceId: "e1", profileId: "ai1", contestId: "c1", expectedSequence, status: "REJECTED", note: "x" })).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
    reviewWaiverAiEvidence.mockResolvedValue({ sequence: 1, reviewedAt: new Date("2026-10-08T00:00:00Z") });
    expect(await reviewWaiverAiEvidenceAction({ evidenceId: "e1", profileId: "ai1", contestId: "c1", expectedSequence: 0, status: "REJECTED", note: "x" })).toMatchObject({
      ok: true,
      sequence: 1,
    });
  });
});
