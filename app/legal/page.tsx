import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { NO_WAGERING_DISCLAIMER } from "@/lib/company";
import {
  formatPolicyLastUpdated,
  POLICY_DEFINITIONS,
  policyRoute,
} from "@/lib/legal/policies";
import { PUBLIC_INDEX, canonicalMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Legal & Policies",
  description:
    "RankEyeQ terms, privacy, eligibility, responsible play, and AI disclosure policies.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/legal"),
};

export default function LegalIndexPage() {
  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Legal"
        title="Policy center"
        description="RankEyeQ is operated by SNG LABS LLC. Review the policies that govern accounts, contests, and community features."
      />
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
        {NO_WAGERING_DISCLAIMER}
      </p>
      <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-surface-elevated">
        {POLICY_DEFINITIONS.map((policy) => (
          <li key={policy.slug}>
            <Link
              href={policyRoute(policy.slug)}
              className="block px-5 py-4 hover:bg-surface"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium text-ink">{policy.title}</span>
                <span className="text-xs text-muted">
                  Last updated {formatPolicyLastUpdated(policy.lastUpdated)}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{policy.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
