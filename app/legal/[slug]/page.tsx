import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  LegalPolicyLayout,
  LegalPolicySection,
  parsePolicyMarkdown,
} from "@/components/legal/LegalPolicyLayout";
import {
  getPolicyDefinitionOrFallback,
  POLICY_SLUGS,
  type PolicySlug,
} from "@/lib/legal/policies";
import { getPublishedPolicy } from "@/lib/legal/policy-acceptance";
import { PUBLIC_INDEX, canonicalMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

const VALID_SLUGS = new Set<string>(POLICY_SLUGS);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const definition = getPolicyDefinitionOrFallback(slug);
  return {
    title: definition?.title ?? "Legal",
    description: definition?.description ?? "RankEyeQ legal policy",
    ...PUBLIC_INDEX,
    ...canonicalMetadata(`/legal/${slug}`),
  };
}

export default async function LegalPolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!VALID_SLUGS.has(slug)) notFound();

  const document = await getPublishedPolicy(slug as PolicySlug);
  const fallback = getPolicyDefinitionOrFallback(slug);
  const title = document?.title ?? fallback?.title ?? "Policy";
  const lastUpdated = fallback?.lastUpdated ?? "2026-09-01";
  const sections = document?.content
    ? parsePolicyMarkdown(document.content)
    : (fallback?.sections ?? []);

  return (
    <LegalPolicyLayout title={title} lastUpdated={lastUpdated}>
      {sections.map((section) => (
        <LegalPolicySection
          key={section.heading}
          heading={section.heading}
          body={section.body}
        />
      ))}
    </LegalPolicyLayout>
  );
}
