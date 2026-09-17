import {
  PUBLIC_BRAND_DEFINITION,
  PUBLIC_BRAND_NAME,
} from "@/lib/brand";
import {
  COMPANY_LEGAL_NAME,
  COMPANY_PRODUCT_TAGLINE,
  HOMEPAGE_NOT_INVESTMENT_NOTE,
} from "@/lib/company";
import { Container } from "@/components/layout/Container";

/**
 * Static, crawlable homepage entity intro.
 * Must render without client JS, Suspense, or database waits.
 */
export function HomeEntityIntro() {
  return (
    <section
      aria-label={`${PUBLIC_BRAND_NAME} overview`}
      className="border-b border-border bg-surface"
    >
      <Container className="py-8 sm:py-10">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {PUBLIC_BRAND_NAME}
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-ink sm:text-lg">
          {PUBLIC_BRAND_DEFINITION}
        </p>
        <div className="mt-4 max-w-3xl space-y-3 text-sm leading-relaxed text-muted sm:text-base">
          <p>
            Each week, players rank NFL quarterbacks, running backs, wide
            receivers, tight ends, and defenses for that specific slate.
          </p>
          <p>
            Rankings are graded against actual fantasy-point finishes — the same
            results for the Public, Experts, Creators, and AI.
          </p>
          <p className="font-medium text-ink">{COMPANY_PRODUCT_TAGLINE}.</p>
          <p className="text-xs text-muted/80 sm:text-sm">
            {HOMEPAGE_NOT_INVESTMENT_NOTE}
          </p>
          <p className="sr-only">
            {PUBLIC_BRAND_NAME} is operated by {COMPANY_LEGAL_NAME}.
          </p>
        </div>
      </Container>
    </section>
  );
}
