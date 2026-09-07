import { describe, expect, it } from "vitest";
import { isPosition, parsePositionParam } from "@/lib/contest";

describe("parsePositionParam", () => {
  it("accepts canonical lowercase route segments", () => {
    expect(parsePositionParam("qb")).toBe("qb");
    expect(parsePositionParam("wr")).toBe("wr");
    expect(parsePositionParam("def")).toBe("def");
  });

  it("normalizes uppercase / mixed-case segments used in typed or shared URLs", () => {
    expect(parsePositionParam("QB")).toBe("qb");
    expect(parsePositionParam("Rb")).toBe("rb");
    expect(parsePositionParam("TE")).toBe("te");
    expect(parsePositionParam("DEF")).toBe("def");
  });

  it("rejects unknown segments so callers can notFound() instead of hanging", () => {
    expect(parsePositionParam("kicker")).toBeNull();
    expect(parsePositionParam("")).toBeNull();
    expect(parsePositionParam(null)).toBeNull();
    expect(parsePositionParam(undefined)).toBeNull();
  });

  it("keeps isPosition strict to canonical lowercase Position values", () => {
    expect(isPosition("qb")).toBe(true);
    expect(isPosition("QB")).toBe(false);
  });
});
