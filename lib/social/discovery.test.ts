import { describe, expect, it } from "vitest";
import {
  DISCOVERY_MIN_CONTESTS,
  filterDiscoveryByProfileType,
  parseDiscoveryPosition,
} from "@/lib/social/discovery";

describe("ranker discovery filters", () => {
  it("keeps a prominent minimum sample size above one contest", () => {
    expect(DISCOVERY_MIN_CONTESTS).toBeGreaterThan(1);
  });

  it("parses overall vs position and human/ai filters", () => {
    expect(parseDiscoveryPosition(undefined)).toBeUndefined();
    expect(parseDiscoveryPosition("qb")).toBe("QB");
    expect(parseDiscoveryPosition("DEF")).toBe("DEF");
    expect(parseDiscoveryPosition("overall")).toBeUndefined();
    expect(filterDiscoveryByProfileType("HUMAN")).toBe("HUMAN");
    expect(filterDiscoveryByProfileType("EXPERT")).toBe("EXPERT");
    expect(filterDiscoveryByProfileType("ALL")).toBe("ALL");
    expect(filterDiscoveryByProfileType("nope")).toBe("ALL");
  });
});
