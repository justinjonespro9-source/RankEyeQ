import { buildRankEyeQEntityGraph } from "@/lib/seo/entity-jsonld";

/** Site-wide RankEyeQ entity JSON-LD (WebSite, Brand, WebApplication, Organization). */
export function SiteJsonLd() {
  const payload = buildRankEyeQEntityGraph();

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}
