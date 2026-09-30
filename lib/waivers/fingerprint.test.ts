import { describe, expect, it } from "vitest";
import { waiverBoardFingerprint } from "@/lib/waivers/fingerprint";

const base = { contestId: "c1", snapshotId: "s1", rankableEntryIds: ["a", "b", "c"] };

describe("waiverBoardFingerprint", () => {
  it("is a deterministic sha256 hex digest", () => {
    const value = waiverBoardFingerprint(base);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(waiverBoardFingerprint({ ...base, rankableEntryIds: [...base.rankableEntryIds] })).toBe(value);
  });

  it("depends on call order, content, contest and snapshot version", () => {
    const value = waiverBoardFingerprint(base);
    expect(waiverBoardFingerprint({ ...base, rankableEntryIds: ["b", "a", "c"] })).not.toBe(value);
    expect(waiverBoardFingerprint({ ...base, rankableEntryIds: ["a", "b"] })).not.toBe(value);
    expect(waiverBoardFingerprint({ ...base, contestId: "c2" })).not.toBe(value);
    expect(waiverBoardFingerprint({ ...base, snapshotId: "s2" })).not.toBe(value);
  });

  it("distinguishes an abstention from any board with calls", () => {
    expect(waiverBoardFingerprint({ ...base, rankableEntryIds: [] })).not.toBe(waiverBoardFingerprint(base));
  });
});
