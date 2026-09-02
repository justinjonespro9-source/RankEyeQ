/** Legal policy slugs and canonical configuration. */

import { NO_WAGERING_DISCLAIMER } from "@/lib/company";
import {
  POLICY_DEFINITIONS_CONTENT,
  POLICY_LAST_UPDATED,
} from "@/lib/legal/policy-content";

export type PolicySlug =
  | "terms"
  | "privacy"
  | "eligibility"
  | "responsible-play"
  | "community"
  | "ai-disclosure"
  | "cookies";

export const POLICY_SLUGS: PolicySlug[] = [
  "terms",
  "privacy",
  "eligibility",
  "responsible-play",
  "community",
  "ai-disclosure",
  "cookies",
];

/** Public policy version identifier — must match signup acceptance records. */
export const CURRENT_POLICY_VERSION = POLICY_LAST_UPDATED;

export type PolicyDefinition = {
  slug: PolicySlug;
  title: string;
  description: string;
  requiresReview: boolean;
  requiresAcceptance: boolean;
  effectiveDate: string;
  lastUpdated: string;
  sections: { heading: string; body: string }[];
};

export const POLICY_DEFINITIONS: PolicyDefinition[] = POLICY_DEFINITIONS_CONTENT.map(
  (policy, index) => ({
    slug: POLICY_SLUGS[index]!,
    ...policy,
  }),
);

export function getPolicyDefinition(slug: string) {
  return POLICY_DEFINITIONS.find((policy) => policy.slug === slug) ?? null;
}

export function getPolicyDefinitionOrFallback(slug: string) {
  return getPolicyDefinition(slug);
}

export const REQUIRED_SIGNUP_POLICY_SLUGS: PolicySlug[] = ["terms", "privacy"];

export const ELIGIBILITY_NOTICE = NO_WAGERING_DISCLAIMER;

export function policyRoute(slug: PolicySlug) {
  return `/legal/${slug}`;
}

export function formatPolicyLastUpdated(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function getSignupPolicyLinks() {
  return REQUIRED_SIGNUP_POLICY_SLUGS.map((slug) => {
    const policy = getPolicyDefinition(slug);
    return {
      slug,
      title: policy?.title ?? slug,
      href: policyRoute(slug),
      version: CURRENT_POLICY_VERSION,
      lastUpdated: policy?.lastUpdated ?? CURRENT_POLICY_VERSION,
    };
  });
}

export function policiesContentToMarkdown(
  sections: PolicyDefinition["sections"],
) {
  return sections
    .map((section) => `## ${section.heading}\n\n${section.body}`)
    .join("\n\n");
}
