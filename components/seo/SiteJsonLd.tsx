import { PUBLIC_BRAND_NAME } from "@/lib/brand";
import { COMPANY_LEGAL_NAME, COMPANY_NAME } from "@/lib/company";
import { communityLinkHrefs } from "@/lib/community-links";
import { absoluteUrl, getCanonicalSiteOrigin } from "@/lib/seo";

/** Minimal WebSite + Organization JSON-LD. No invented ratings or credentials. */
export function SiteJsonLd() {
  const origin = getCanonicalSiteOrigin();
  const payload = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: absoluteUrl("/"),
        name: PUBLIC_BRAND_NAME,
        description:
          "Fantasy football rankings finally have a scoreboard. Weekly contests for the Public, Experts, Creators, and AI.",
        publisher: { "@id": `${origin}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: COMPANY_LEGAL_NAME,
        alternateName: COMPANY_NAME,
        url: absoluteUrl("/"),
        sameAs: communityLinkHrefs(),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}
