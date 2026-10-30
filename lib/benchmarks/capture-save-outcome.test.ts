import { describe, expect, it } from "vitest";
import {
  CAPTURE_UNKNOWN_RESULT_MESSAGE,
  classifyCaptureSaveFailure,
  classifyCaptureSaveResult,
  isCaptureTransportAmbiguityError,
} from "@/lib/benchmarks/capture-save-outcome";

describe("capture save outcome classification", () => {
  it("SUCCESS includes confirmation and snapshot ID", () => {
    const outcome = classifyCaptureSaveResult({
      ok: true,
      message: "Official benchmark board locked and eligible for RankEYEQ scoring",
      snapshotId: "snap_123",
      warnings: ["note A"],
      official: true,
    });
    expect(outcome.kind).toBe("success");
    expect(outcome.snapshotId).toBe("snap_123");
    expect(outcome.message).toContain("Saved.");
    expect(outcome.message).toContain("snap_123");
    expect(outcome.message).toContain("note A");
  });

  it("VALIDATION ERROR surfaces structured server error and does not invent failure wording", () => {
    const outcome = classifyCaptureSaveResult({
      ok: false,
      error:
        "Josh Jacobs kicked off Thursday and was absent from the pre-kickoff snapshot — cannot be added.",
    });
    expect(outcome.kind).toBe("validation_error");
    expect(outcome.message).toContain("Josh Jacobs");
    expect(outcome.message).not.toContain(CAPTURE_UNKNOWN_RESULT_MESSAGE);
  });

  it("UNKNOWN RESULT for unexpected Server Action response after possible commit", () => {
    const outcome = classifyCaptureSaveFailure(
      new Error("An unexpected response was received from the server."),
    );
    expect(outcome.kind).toBe("unknown_result");
    expect(outcome.message).toBe(CAPTURE_UNKNOWN_RESULT_MESSAGE);
    expect(outcome.message).not.toMatch(/failed to save|save failed/i);
  });

  it("UNKNOWN RESULT for network failure before/during response", () => {
    const outcome = classifyCaptureSaveFailure(new TypeError("Failed to fetch"));
    expect(outcome.kind).toBe("unknown_result");
    expect(outcome.message).toBe(CAPTURE_UNKNOWN_RESULT_MESSAGE);
  });

  it("does not auto-classify validation returns as unknown", () => {
    expect(
      classifyCaptureSaveResult({
        ok: false,
        error: "Ranking failed validation",
      }).kind,
    ).toBe("validation_error");
  });

  it("detects transport ambiguity errors used for operator messaging", () => {
    expect(
      isCaptureTransportAmbiguityError(
        new Error("An unexpected response was received from the server."),
      ),
    ).toBe(true);
    expect(isCaptureTransportAmbiguityError(new Error("Failed to fetch"))).toBe(
      true,
    );
    expect(
      isCaptureTransportAmbiguityError(
        new Error("Ranking failed validation"),
      ),
    ).toBe(false);
  });
});
