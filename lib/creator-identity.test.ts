import { describe, expect, it } from "vitest";
import {
  formatCreatorAffiliationBadge,
  formatCreatorPrimaryName,
  isCreatorCompetitorProfile,
  slugifyCreatorUsername,
} from "@/lib/creator-identity";

describe("creator identity display", () => {
  it("uses person as primary and brand on the CREATOR badge", () => {
    expect(
      formatCreatorPrimaryName({
        displayName: "Tyler Cohen",
        personName: "Tyler Cohen",
        brandName: "TCO Fantasy Show",
      }),
    ).toBe("Tyler Cohen");
    expect(
      formatCreatorAffiliationBadge({
        displayName: "Tyler Cohen",
        personName: "Tyler Cohen",
        brandName: "TCO Fantasy Show",
      }),
    ).toBe("CREATOR · TCO Fantasy Show");
  });

  it("falls back to CREATOR when brand is missing", () => {
    expect(
      formatCreatorAffiliationBadge({
        displayName: "Sal Vetri",
        personName: "Sal Vetri",
        brandName: null,
      }),
    ).toBe("CREATOR");
  });

  it("recognizes CREATOR profile type and slugifies usernames", () => {
    expect(isCreatorCompetitorProfile("CREATOR")).toBe(true);
    expect(isCreatorCompetitorProfile("BENCHMARK")).toBe(false);
    expect(slugifyCreatorUsername("Tyler Cohen")).toBe("tyler_cohen");
  });
});
