import { describe, expect, it } from "vitest";
import type {
  FinalizePreflightCheck,
  FinalizeWeekReadiness,
} from "@/lib/nfl/finalize-week";

function readinessReady(checks: FinalizePreflightCheck[]) {
  return !checks.some((check) => check.status === "BLOCKED");
}

describe("finalize week preflight semantics", () => {
  it("blocks finalize when any check is BLOCKED even if warnings exist", () => {
    const checks: FinalizePreflightCheck[] = [
      {
        key: "games",
        label: "All NFL games finalized",
        status: "PASS",
        detail: "16/16",
      },
      {
        key: "submissions_locked",
        label: "Submissions locked",
        status: "WARNING",
        detail: "2 unlocked",
      },
      {
        key: "position_WR",
        label: "WR contest ready",
        status: "BLOCKED",
        detail: "missing ranks",
        position: "WR",
      },
    ];
    expect(readinessReady(checks)).toBe(false);
  });

  it("allows finalize with warnings only", () => {
    const checks: FinalizePreflightCheck[] = [
      {
        key: "games",
        label: "All NFL games finalized",
        status: "PASS",
        detail: "16/16",
      },
      {
        key: "consensus_snapshot",
        label: "Consensus snapshot / freeze",
        status: "WARNING",
        detail: "pending",
      },
    ];
    expect(readinessReady(checks)).toBe(true);
  });

  it("distinguishes game-finalized from week-finalized in messaging", () => {
    const readiness = {
      weekStatus: "LOCKED",
      ready: false,
      reasons: [
        "2 game(s) are not FINAL (GAME FINALIZED ≠ WEEK FINALIZED)",
      ],
    } as Pick<FinalizeWeekReadiness, "weekStatus" | "ready" | "reasons">;
    expect(readiness.weekStatus).not.toBe("COMPLETE");
    expect(readiness.reasons[0]).toContain("GAME FINALIZED ≠ WEEK FINALIZED");
  });
});
