import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { CommunityLinks } from "@/components/layout/CommunityLinks";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  PUBLIC_BRAND_DEFINITION,
  PUBLIC_BRAND_NAME,
  PUBLIC_BRAND_SPOKEN_NAME,
  EYEQ_SCORE_LABEL,
} from "@/lib/brand";
import {
  COMPANY_LEGAL_NAME,
  COMPANY_PRODUCT_TAGLINE,
  formatContactLine,
  getCompanyWebsiteUrl,
  NOT_INVESTMENT_DISCLAIMER,
  NO_WAGERING_DISCLAIMER,
} from "@/lib/company";
import {
  ABOUT_FAQS,
  ABOUT_PAGE_DESCRIPTION,
  ABOUT_PAGE_TITLE,
} from "@/lib/seo/about-content";
import {
  buildFaqPageJsonLd,
} from "@/lib/seo/entity-jsonld";
import { absoluteUrl, publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...publicPageMetadata({
    title: ABOUT_PAGE_TITLE,
    description: ABOUT_PAGE_DESCRIPTION,
    path: "/about",
  }),
  title: {
    absolute: ABOUT_PAGE_TITLE,
  },
};

export default function AboutPage() {
  const companyUrl = getCompanyWebsiteUrl();
  const faqJsonLd = buildFaqPageJsonLd({
    pageUrl: absoluteUrl("/about"),
    items: ABOUT_FAQS,
  });

  return (
    <Container className="py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <SectionHeading
        eyebrow="About"
        title={`About ${PUBLIC_BRAND_NAME}`}
        description={PUBLIC_BRAND_DEFINITION}
      />

      <div className="mt-8 max-w-3xl space-y-6 text-sm leading-relaxed text-muted sm:text-base">
        <p>
          {PUBLIC_BRAND_NAME} (also written{" "}
          <span className="text-ink">{PUBLIC_BRAND_SPOKEN_NAME}</span>) is a
          weekly fantasy-football player-ranking competition. Each NFL week,
          participants rank quarterbacks, running backs, wide receivers, tight
          ends, and defenses for that slate. Boards lock around kickoff, then
          get graded against actual fantasy-point finishes — not projections or
          season-long draft boards.
        </p>

        <section aria-labelledby="about-how">
          <h2
            id="about-how"
            className="font-display text-xl font-semibold text-ink"
          >
            How weekly ranking contests work
          </h2>
          <p className="mt-2">
            Pick a position board, order the players you think will finish
            highest that week, and lock before games start. Remaining unlocked
            slots stay editable until the Sunday full lock. After the week ends,
            everyone is scored on the same actual fantasy finishes.
          </p>
        </section>

        <section aria-labelledby="about-eyeq">
          <h2
            id="about-eyeq"
            className="font-display text-xl font-semibold text-ink"
          >
            What the {EYEQ_SCORE_LABEL} measures
          </h2>
          <p className="mt-2">
            The {EYEQ_SCORE_LABEL} measures how accurately your weekly rankings matched real
            fantasy production. It rewards calling the top of the board correctly
            and building a strong overall field — then rolls into season
            leaderboards.
          </p>
        </section>

        <section aria-labelledby="about-competitors">
          <h2
            id="about-competitors"
            className="font-display text-xl font-semibold text-ink"
          >
            Public, Experts, Creators, and AI
          </h2>
          <p className="mt-2">
            RankEyeQ puts the Public, Experts, Creators, and AI on one scoreboard
            under the same rules. You can compare how different ranking styles
            performed against the same weekly results.
          </p>
        </section>

        <section aria-labelledby="about-free">
          <h2
            id="about-free"
            className="font-display text-xl font-semibold text-ink"
          >
            Free to play — no wagering
          </h2>
          <p className="mt-2">{NO_WAGERING_DISCLAIMER}</p>
        </section>

        <section aria-labelledby="about-company">
          <h2
            id="about-company"
            className="font-display text-xl font-semibold text-ink"
          >
            {COMPANY_LEGAL_NAME}
          </h2>
          <p className="mt-2">
            {COMPANY_PRODUCT_TAGLINE}. Visit{" "}
            <a
              href={companyUrl}
              className="font-medium text-ink underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {companyUrl.replace(/^https?:\/\//, "")}
            </a>
            . {formatContactLine()}
          </p>
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Official {PUBLIC_BRAND_NAME} social
            </p>
            <div className="mt-2">
              <CommunityLinks />
            </div>
          </div>
        </section>

        <section aria-labelledby="about-not-investment">
          <h2
            id="about-not-investment"
            className="font-display text-xl font-semibold text-ink"
          >
            Not investment analysis
          </h2>
          <p className="mt-2">{NOT_INVESTMENT_DISCLAIMER}</p>
        </section>
      </div>

      <section className="mt-12 max-w-3xl" aria-labelledby="about-faq">
        <h2
          id="about-faq"
          className="font-display text-2xl font-semibold text-ink"
        >
          Frequently asked questions
        </h2>
        <dl className="mt-6 space-y-6">
          {ABOUT_FAQS.map((item) => (
            <div key={item.question}>
              <dt className="font-display text-base font-semibold text-ink">
                {item.question}
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-10 text-sm text-muted">
        Learn more on{" "}
        <Link href="/how-it-works" className="font-medium text-ink hover:underline">
          How It Works
        </Link>{" "}
        or{" "}
        <Link href="/rank" className="font-medium text-ink hover:underline">
          rank this week&apos;s players
        </Link>
        .
      </p>
    </Container>
  );
}
