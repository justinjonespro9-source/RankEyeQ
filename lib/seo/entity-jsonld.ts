import {
  BRAND_LOGO_PATH,
  PUBLIC_BRAND_ALTERNATE_NAMES,
  PUBLIC_BRAND_DEFINITION,
  PUBLIC_BRAND_NAME,
  PUBLIC_BRAND_SPOKEN_NAME,
} from "@/lib/brand";
import {
  CANONICAL_COMPANY_ORIGIN,
  COMPANY_LEGAL_NAME,
  COMPANY_NAME,
  getCompanyWebsiteUrl,
} from "@/lib/company";
import { communityLinkHrefs } from "@/lib/community-links";
import { getCanonicalSiteOrigin } from "@/lib/seo";

export type JsonLdGraph = {
  "@context": "https://schema.org";
  "@graph": Record<string, unknown>[];
};

/**
 * RankEyeQ entity graph for crawlers.
 * Brand sameAs = RankEyeQ socials only; Organization sameAs stays company-scoped.
 */
export function buildRankEyeQEntityGraph(input?: {
  origin?: string;
  companyUrl?: string;
  brandSameAs?: string[];
}): JsonLdGraph {
  const origin = (input?.origin ?? getCanonicalSiteOrigin()).replace(/\/$/, "");
  const companyUrl = (
    input?.companyUrl ?? getCompanyWebsiteUrl()
  ).replace(/\/$/, "");
  const brandSameAs = input?.brandSameAs ?? communityLinkHrefs();
  const logoPath = BRAND_LOGO_PATH.startsWith("/")
    ? BRAND_LOGO_PATH
    : `/${BRAND_LOGO_PATH}`;
  const logoUrl = `${origin}${logoPath}`;

  const websiteId = `${origin}/#website`;
  const brandId = `${origin}/#brand`;
  const appId = `${origin}/#app`;
  const organizationId = `${CANONICAL_COMPANY_ORIGIN}/#organization`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: PUBLIC_BRAND_NAME,
        alternateName: [...PUBLIC_BRAND_ALTERNATE_NAMES],
        url: `${origin}/`,
        description: PUBLIC_BRAND_DEFINITION,
        about: { "@id": brandId },
        publisher: { "@id": organizationId },
        inLanguage: "en-US",
      },
      {
        "@type": "Brand",
        "@id": brandId,
        name: PUBLIC_BRAND_NAME,
        alternateName: PUBLIC_BRAND_SPOKEN_NAME,
        description: PUBLIC_BRAND_DEFINITION,
        url: `${origin}/`,
        logo: logoUrl,
        sameAs: brandSameAs,
      },
      {
        "@type": "WebApplication",
        "@id": appId,
        name: PUBLIC_BRAND_NAME,
        alternateName: [...PUBLIC_BRAND_ALTERNATE_NAMES],
        url: `${origin}/`,
        applicationCategory: "GameApplication",
        operatingSystem: "Web",
        description: PUBLIC_BRAND_DEFINITION,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        brand: { "@id": brandId },
        publisher: { "@id": organizationId },
        isPartOf: { "@id": websiteId },
      },
      {
        "@type": "Organization",
        "@id": organizationId,
        name: COMPANY_LEGAL_NAME,
        alternateName: COMPANY_NAME,
        url: `${companyUrl}/`,
        brand: { "@id": brandId },
        // Do not attach RankEyeQ social profiles here.
      },
    ],
  };
}

export type AboutFaqItem = {
  question: string;
  answer: string;
};

export function buildFaqPageJsonLd(input: {
  pageUrl: string;
  items: AboutFaqItem[];
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: input.pageUrl,
    mainEntity: input.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
