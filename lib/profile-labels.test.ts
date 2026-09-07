import { describe, expect, it } from "vitest";
import {
  competitorClassLabel,
  competitorIdentityChip,
} from "@/lib/profile-labels";

describe("competitor identity chips", () => {
  it("labels PUBLIC humans distinctly from Expert/Creator/AI", () => {
    expect(competitorIdentityChip({ profileType: "HUMAN" })).toEqual({
      label: "PUBLIC",
      tone: "success",
    });
    expect(competitorClassLabel("HUMAN")).toBe("Human");
  });

  it("formats EXPERT · publisher and CREATOR · brand", () => {
    expect(
      competitorIdentityChip({
        profileType: "BENCHMARK",
        expertPublisher: "Yahoo Fantasy",
      }).label,
    ).toBe("EXPERT · Yahoo Fantasy");
    expect(
      competitorIdentityChip({
        profileType: "CREATOR",
        creatorBrand: "TCO Fantasy Show",
      }).label,
    ).toBe("CREATOR · TCO Fantasy Show");
  });

  it("formats AI · model without merging Creator into Expert", () => {
    expect(
      competitorIdentityChip({
        profileType: "AI",
        aiModel: "Claude",
      }).label,
    ).toBe("AI · Claude");
    expect(
      competitorIdentityChip({ profileType: "CREATOR" }).label,
    ).toBe("CREATOR");
    expect(
      competitorIdentityChip({ profileType: "BENCHMARK" }).label,
    ).toBe("EXPERT");
  });
});
