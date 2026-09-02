import { prisma } from "@/lib/db";
import {
  CURRENT_POLICY_VERSION,
  getSignupPolicyLinks,
  policiesContentToMarkdown,
  POLICY_DEFINITIONS,
  REQUIRED_SIGNUP_POLICY_SLUGS,
  type PolicySlug,
} from "@/lib/legal/policies";

export async function ensurePolicyDocumentsSeeded() {
  for (const definition of POLICY_DEFINITIONS) {
    const content = policiesContentToMarkdown(definition.sections);

    await prisma.policyDocument.upsert({
      where: {
        slug_version: {
          slug: definition.slug,
          version: CURRENT_POLICY_VERSION,
        },
      },
      update: {
        title: definition.title,
        content,
        requiresReview: definition.requiresReview,
        publishedAt: new Date(`${definition.lastUpdated}T12:00:00.000Z`),
      },
      create: {
        slug: definition.slug,
        version: CURRENT_POLICY_VERSION,
        title: definition.title,
        content,
        requiresReview: definition.requiresReview,
        publishedAt: new Date(`${definition.lastUpdated}T12:00:00.000Z`),
      },
    });
  }
}

export async function getPublishedPolicy(slug: PolicySlug) {
  await ensurePolicyDocumentsSeeded();
  return prisma.policyDocument.findFirst({
    where: { slug, publishedAt: { not: null } },
    orderBy: [{ version: "desc" }, { publishedAt: "desc" }],
  });
}

export async function getSignupPolicyMetadata() {
  await ensurePolicyDocumentsSeeded();
  const links = getSignupPolicyLinks();
  const documents = await prisma.policyDocument.findMany({
    where: {
      slug: { in: REQUIRED_SIGNUP_POLICY_SLUGS },
      version: CURRENT_POLICY_VERSION,
    },
  });
  return links.map((link) => {
    const document = documents.find((row) => row.slug === link.slug);
    return {
      ...link,
      documentId: document?.id ?? null,
      publishedVersion: document?.version ?? link.version,
    };
  });
}

export async function userHasAcceptedRequiredPolicies(userId: string) {
  await ensurePolicyDocumentsSeeded();
  const required = await prisma.policyDocument.findMany({
    where: {
      slug: { in: REQUIRED_SIGNUP_POLICY_SLUGS },
      version: CURRENT_POLICY_VERSION,
    },
  });

  if (required.length === 0) return false;

  const acceptances = await prisma.policyAcceptance.count({
    where: {
      userId,
      policyDocumentId: { in: required.map((doc) => doc.id) },
    },
  });

  return acceptances >= required.length;
}

export async function recordPolicyAcceptances(userId: string, slugs: PolicySlug[]) {
  await ensurePolicyDocumentsSeeded();
  const documents = await prisma.policyDocument.findMany({
    where: {
      slug: { in: slugs },
      version: CURRENT_POLICY_VERSION,
    },
  });

  const acceptedAt = new Date();
  for (const document of documents) {
    await prisma.policyAcceptance.upsert({
      where: {
        userId_policyDocumentId: {
          userId,
          policyDocumentId: document.id,
        },
      },
      update: { acceptedAt },
      create: {
        userId,
        policyDocumentId: document.id,
        acceptedAt,
      },
    });
  }
}
