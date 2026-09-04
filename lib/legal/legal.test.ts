import { describe, expect, it } from "vitest";
import {
  COMPANY_PRODUCT_TAGLINE,
  COPYRIGHT_NOTICE,
  NO_WAGERING_DISCLAIMER,
} from "@/lib/company";
import { ELIGIBILITY_AGE_STANDARD } from "@/lib/legal/eligibility";
import {
  FOOTER_PRIMARY_LINKS,
  FOOTER_SECONDARY_LINKS,
} from "@/lib/legal/footer-links";
import {
  CURRENT_POLICY_VERSION,
  getSignupPolicyLinks,
  POLICY_DEFINITIONS,
  POLICY_SLUGS,
  policyRoute,
  REQUIRED_SIGNUP_POLICY_SLUGS,
} from "@/lib/legal/policies";
import { parsePolicyMarkdown } from "@/components/legal/LegalPolicyLayout";
import { PRIMARY_NAV } from "@/lib/navigation";

describe("company attribution", () => {
  it("uses SNG LABS product tagline", () => {
    expect(COMPANY_PRODUCT_TAGLINE).toContain("SNG LABS");
  });

  it("includes copyright for SNG LABS LLC", () => {
    expect(COPYRIGHT_NOTICE).toContain("SNG LABS LLC");
    expect(COPYRIGHT_NOTICE).toContain("2026");
  });

  it("includes no-wagering disclaimer", () => {
    expect(NO_WAGERING_DISCLAIMER).toMatch(/free-to-play/i);
    expect(NO_WAGERING_DISCLAIMER).toMatch(/No wagers/i);
    expect(NO_WAGERING_DISCLAIMER).toContain("RankEyeQ");
  });
});

describe("footer links", () => {
  it("includes required primary legal links", () => {
    const labels = FOOTER_PRIMARY_LINKS.map((link) => link.label);
    expect(labels).toEqual([
      "How It Works",
      "Terms",
      "Privacy",
      "Eligibility",
      "Responsible Play",
      "Community Guidelines",
      "AI Disclosure",
    ]);
  });

  it("resolves footer legal routes", () => {
    for (const slug of [
      "terms",
      "privacy",
      "eligibility",
      "responsible-play",
      "community",
      "ai-disclosure",
    ] as const) {
      expect(
        FOOTER_PRIMARY_LINKS.some((link) => link.href === policyRoute(slug)),
      ).toBe(true);
    }
  });

  it("includes secondary cookies and archive links", () => {
    const labels = FOOTER_SECONDARY_LINKS.map((link) => link.label);
    expect(labels).toContain("Cookies");
    expect(labels).toContain("Archive");
    expect(labels).toContain("Rankers");
  });

  it("hides Sign In for authenticated viewers", () => {
    const signedIn = true;
    const showSignIn = !signedIn;
    expect(showSignIn).toBe(false);
  });
});

describe("policy configuration", () => {
  it("defines all intended policy slugs", () => {
    expect(POLICY_SLUGS).toEqual([
      "terms",
      "privacy",
      "eligibility",
      "responsible-play",
      "community",
      "ai-disclosure",
      "cookies",
    ]);
  });

  it("uses a single canonical version for signup policies", () => {
    const links = getSignupPolicyLinks();
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.version === CURRENT_POLICY_VERSION)).toBe(
      true,
    );
    expect(REQUIRED_SIGNUP_POLICY_SLUGS).toEqual(["terms", "privacy"]);
  });

  it("includes AI disclosure and responsible play content sections", () => {
    const ai = POLICY_DEFINITIONS.find((row) => row.slug === "ai-disclosure");
    const responsible = POLICY_DEFINITIONS.find(
      (row) => row.slug === "responsible-play",
    );
    expect(ai?.sections.some((row) => /automated participants/i.test(row.body))).toBe(
      true,
    );
    expect(
      responsible?.sections.some((row) => /no wagering/i.test(row.heading)),
    ).toBe(true);
  });

  it("parses markdown policy sections", () => {
    const parsed = parsePolicyMarkdown("## One\n\nBody one.\n\n## Two\n\nBody two.");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.heading).toBe("One");
    expect(parsed[0]?.body).toBe("Body one.");
  });

  it("uses canonical eligibility age standard", () => {
    expect(ELIGIBILITY_AGE_STANDARD).toMatch(/18\+/);
  });
});

describe("primary navigation unchanged", () => {
  it("keeps five core destinations without legal clutter", () => {
    expect(PRIMARY_NAV.map((link) => link.label)).toEqual([
      "Rank",
      "Consensus",
      "Results",
      "Leaderboards",
      "Player Performance",
    ]);
    const labels = PRIMARY_NAV.map((link) => link.label);
    expect(labels).not.toContain("Legal");
    expect(labels).not.toContain("Terms");
  });
});

describe("public brand terminology", () => {
  it("avoids legacy RankIQ spellings in policy definitions", () => {
    const blob = JSON.stringify(POLICY_DEFINITIONS);
    expect(blob).not.toMatch(/\bRankIQ\b/);
    expect(blob).not.toMatch(/\bRankEYEQ\b/);
    expect(blob).not.toMatch(/\bRANKEQ\b/);
    expect(blob).toContain("RankEyeQ");
  });
});
