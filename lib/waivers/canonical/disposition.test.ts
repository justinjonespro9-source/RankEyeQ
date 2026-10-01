import { describe, expect, it } from "vitest";
import {
  CanonicalDispositionError,
  classifyCanonicalParticipation,
  rankEyeQGameStatusForSngEvent,
  sngEventDispositionForRankEyeQGame,
} from "@/lib/waivers/canonical/disposition";

describe("SNG ↔ RankEyeQ game disposition mapping", () => {
  it("maps SNG CANCELLED ↔ RankEyeQ CANCELED and PLAYED ↔ FINAL", () => {
    expect(rankEyeQGameStatusForSngEvent("CANCELLED")).toBe("CANCELED");
    expect(rankEyeQGameStatusForSngEvent("PLAYED")).toBe("FINAL");
    expect(sngEventDispositionForRankEyeQGame("CANCELED")).toBe("CANCELLED");
    expect(sngEventDispositionForRankEyeQGame("FINAL")).toBe("PLAYED");
  });

  it("gives a moved game no RankEyeQ equivalent instead of guessing POSTPONED", () => {
    expect(rankEyeQGameStatusForSngEvent("MOVED_OUT_OF_WEEK")).toBeNull();
    expect(sngEventDispositionForRankEyeQGame("POSTPONED")).toBeNull();
    expect(sngEventDispositionForRankEyeQGame("SCHEDULED")).toBeNull();
  });

  it("fails closed on unknown or misspelled values", () => {
    expect(() => rankEyeQGameStatusForSngEvent("CANCELED")).toThrow(CanonicalDispositionError);
    expect(() => sngEventDispositionForRankEyeQGame("CANCELLED")).toThrow(CanonicalDispositionError);
    expect(() => rankEyeQGameStatusForSngEvent("FORFEIT")).toThrow(CanonicalDispositionError);
  });
});

describe("classifyCanonicalParticipation", () => {
  it("ranks PARTICIPATED_WITH_STATS and PARTICIPATED_ZERO (zero is a real score)", () => {
    expect(classifyCanonicalParticipation("PARTICIPATED_WITH_STATS", "PLAYED").cls).toBe("RANKED");
    expect(classifyCanonicalParticipation("PARTICIPATED_ZERO", "PLAYED").cls).toBe("RANKED");
  });

  it("D1: VERIFIED_NON_PARTICIPANT via DNP or NO_ROSTER_ASSIGNMENT is a non-participant, never PARTICIPATED_ZERO", () => {
    expect(classifyCanonicalParticipation("VERIFIED_NON_PARTICIPANT", "DNP").cls).toBe("NON_PARTICIPANT");
    expect(classifyCanonicalParticipation("VERIFIED_NON_PARTICIPANT", "NO_ROSTER_ASSIGNMENT").cls).toBe("NON_PARTICIPANT");
  });

  it("D2: cancelled and moved games are systemic neutralization", () => {
    expect(classifyCanonicalParticipation("VERIFIED_NON_PARTICIPANT", "CANCELLED_GAME").cls).toBe("SYSTEMIC_NEUTRALIZE");
    expect(classifyCanonicalParticipation("VERIFIED_NON_PARTICIPANT", "MOVED_OUT_OF_WEEK").cls).toBe("SYSTEMIC_NEUTRALIZE");
  });

  it("D3: BYE for a frozen pool member is a snapshot/canonical conflict", () => {
    expect(classifyCanonicalParticipation("VERIFIED_NON_PARTICIPANT", "BYE").cls).toBe("SNAPSHOT_CONFLICT");
  });

  it("blocks unresolved or incoherent combinations", () => {
    expect(classifyCanonicalParticipation("UNKNOWN_INCOMPLETE", "UNRESOLVED").cls).toBe("BLOCKED");
    expect(classifyCanonicalParticipation("ABSENT_UNRESOLVED", "UNRESOLVED").cls).toBe("BLOCKED");
    expect(classifyCanonicalParticipation("PARTICIPATED_ZERO", "DNP").cls).toBe("BLOCKED");
    expect(classifyCanonicalParticipation("VERIFIED_NON_PARTICIPANT", "PLAYED").cls).toBe("BLOCKED");
  });

  it("fails closed on unknown states or dispositions", () => {
    expect(() => classifyCanonicalParticipation("VERIFIED_NON_PARTICIPANT", "FORFEIT")).toThrow(CanonicalDispositionError);
    expect(() => classifyCanonicalParticipation("DID_NOT_PARTICIPATE", "DNP")).toThrow(CanonicalDispositionError);
  });
});
