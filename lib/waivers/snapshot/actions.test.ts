import { beforeEach, describe, expect, it, vi } from "vitest";

const authState: { admin: unknown } = { admin: null };
vi.mock("@/lib/auth/session", () => ({
  assertAdmin: async () => {
    if (!authState.admin) throw new Error("Admin access required");
    return authState.admin;
  },
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const previewWaiverSnapshot = vi.fn();
vi.mock("@/lib/waivers/snapshot/preview", () => ({ previewWaiverSnapshot: (...args: unknown[]) => previewWaiverSnapshot(...args) }));
const freezeWaiverSnapshot = vi.fn();
vi.mock("@/lib/waivers/snapshot/freeze", () => ({ freezeWaiverSnapshot: (...args: unknown[]) => freezeWaiverSnapshot(...args) }));
const previewWaiverCorrection = vi.fn();
const applyWaiverCorrection = vi.fn();
vi.mock("@/lib/waivers/snapshot/correct", () => ({
  previewWaiverCorrection: (...args: unknown[]) => previewWaiverCorrection(...args),
  applyWaiverCorrection: (...args: unknown[]) => applyWaiverCorrection(...args),
}));

import {
  applyWaiverCorrectionAction,
  freezeWaiverSnapshotAction,
  previewWaiverCorrectionAction,
  previewWaiverSnapshotAction,
} from "@/lib/waivers/snapshot/actions";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";

const form = {
  weekId: "w1",
  rawText: "A | WR | SF | 10",
  sourceLabel: "Sleeper",
  sourceUrl: "https://sleeper.example",
  observedAt: "2026-10-06T09:30",
};

beforeEach(() => {
  authState.admin = null;
  for (const mock of [revalidatePath, previewWaiverSnapshot, freezeWaiverSnapshot, previewWaiverCorrection, applyWaiverCorrection]) mock.mockReset();
});

describe("snapshot admin actions", () => {
  it("refuse non-admins before touching any service", async () => {
    expect(await previewWaiverSnapshotAction(form)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await freezeWaiverSnapshotAction({ ...form, previewFingerprint: "fp", acknowledged: [] })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await previewWaiverCorrectionAction({ snapshotId: "s1", reason: "r", ops: [] })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await applyWaiverCorrectionAction({ snapshotId: "s1", reason: "r", ops: [], correctionFingerprint: "fp", acknowledged: [] })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(previewWaiverSnapshot).not.toHaveBeenCalled();
    expect(freezeWaiverSnapshot).not.toHaveBeenCalled();
    expect(previewWaiverCorrection).not.toHaveBeenCalled();
    expect(applyWaiverCorrection).not.toHaveBeenCalled();
  });

  it("validates input shape and size", async () => {
    authState.admin = { user: { id: "admin-1" } };
    expect(await previewWaiverSnapshotAction(null)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await previewWaiverSnapshotAction({ ...form, rawText: "x".repeat(200_001) })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await previewWaiverSnapshotAction({ ...form, observedAt: "next tuesday" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await previewWaiverSnapshotAction({ ...form, sourceUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await freezeWaiverSnapshotAction({ ...form, previewFingerprint: "fp", acknowledged: "all" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      await freezeWaiverSnapshotAction({ ...form, previewFingerprint: "fp", acknowledged: [], followUpAcks: [{ rankableEntryId: "p", reason: "MADE_UP" }] }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await previewWaiverCorrectionAction({ snapshotId: "s1", reason: "r", ops: [{ kind: "DELETE_ALL" }] })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(previewWaiverSnapshot).not.toHaveBeenCalled();
    expect(freezeWaiverSnapshot).not.toHaveBeenCalled();
    expect(previewWaiverCorrection).not.toHaveBeenCalled();
  });

  it("freezes as the session admin (never a client-supplied id), parses Chicago local time and revalidates", async () => {
    authState.admin = { user: { id: "admin-1" } };
    freezeWaiverSnapshot.mockResolvedValue({
      snapshotId: "s1",
      version: 1,
      alreadyFrozen: false,
      frozenAt: new Date("2026-10-06T15:00:00.000Z"),
      counts: { candidateCount: 1, eligibleCount: 1, excludedCount: 0, followUpCount: 0 },
      contestsCanOpen: true,
      locksAt: null,
    });
    const result = await freezeWaiverSnapshotAction({
      ...form,
      adminUserId: "attacker",
      previewFingerprint: "fp",
      acknowledged: ["SOURCE_COMPLETE_ATTESTATION"],
      followUpAcks: [{ rankableEntryId: "p9", reason: "OTHER", note: " not listed " }],
    });
    expect(result).toMatchObject({ ok: true, snapshotId: "s1", frozenAt: "2026-10-06T15:00:00.000Z" });
    expect(freezeWaiverSnapshot).toHaveBeenCalledWith({
      weekId: "w1",
      rawText: form.rawText,
      sourceLabel: "Sleeper",
      sourceUrl: "https://sleeper.example",
      observedAt: new Date("2026-10-06T14:30:00.000Z"),
      adminUserId: "admin-1",
      previewFingerprint: "fp",
      acknowledged: ["SOURCE_COMPLETE_ATTESTATION"],
      followUpAcks: [{ rankableEntryId: "p9", reason: "OTHER", note: "not listed" }],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/waivers");
  });

  it("maps domain errors to codes and hides unexpected errors", async () => {
    authState.admin = { user: { id: "admin-1" } };
    freezeWaiverSnapshot.mockRejectedValueOnce(new WaiverSnapshotError("STALE_PREVIEW", "preview again"));
    expect(await freezeWaiverSnapshotAction({ ...form, previewFingerprint: "fp", acknowledged: [] })).toMatchObject({
      ok: false,
      code: "STALE_PREVIEW",
      error: "preview again",
    });
    applyWaiverCorrection.mockRejectedValueOnce(new Error("postgres://secret@host"));
    const hidden = await applyWaiverCorrectionAction({
      snapshotId: "s1",
      reason: "r",
      ops: [{ kind: "REMOVE", rankableEntryId: "p1" }],
      correctionFingerprint: "fp",
      acknowledged: [],
    });
    expect(hidden).toEqual({ ok: false, error: "Unexpected error; nothing was saved", code: "UNKNOWN" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes typed correction operations through and applies as the session admin", async () => {
    authState.admin = { user: { id: "admin-2" } };
    applyWaiverCorrection.mockResolvedValue({
      snapshotId: "s2",
      version: 2,
      supersededSnapshotId: "s1",
      frozenAt: new Date("2026-10-06T16:00:00.000Z"),
      correctionCase: "PRE_SUBMISSION",
      changeCount: 1,
      repin: [],
    });
    const ops = [
      { kind: "SET_AVAILABILITY", rankableEntryId: "p1", designation: "OUT", hardUnavailable: true, evidence: "ruled out" },
      { kind: "ADD_ROWS", rawText: "B | RB | SEA | 4", reason: "missed" },
    ];
    const result = await applyWaiverCorrectionAction({ snapshotId: "s1", reason: "fix", ops, correctionFingerprint: "cf", acknowledged: ["X"] });
    expect(result).toMatchObject({ ok: true, snapshotId: "s2", version: 2, frozenAt: "2026-10-06T16:00:00.000Z" });
    expect(applyWaiverCorrection).toHaveBeenCalledWith({
      snapshotId: "s1",
      reason: "fix",
      ops: [
        { ...ops[0], reason: null },
        { ...ops[1], reason: "missed" },
      ],
      adminUserId: "admin-2",
      correctionFingerprint: "cf",
      acknowledged: ["X"],
    });
  });
});
