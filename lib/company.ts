import { PUBLIC_BRAND_NAME } from "@/lib/brand";

/** Operator of RankEyeQ. */
export const COMPANY_NAME = "SNG LABS";

export const COMPANY_LEGAL_NAME = "SNG LABS LLC";

/** Canonical public company origin for structured data and footer. */
export const CANONICAL_COMPANY_ORIGIN = "https://www.snglabs.com";

export const COMPANY_PRODUCT_TAGLINE = `A product of ${COMPANY_LEGAL_NAME}`;

export const COPYRIGHT_NOTICE = `© ${2026} ${COMPANY_LEGAL_NAME}. All rights reserved.`;

export const NO_WAGERING_DISCLAIMER =
  `${PUBLIC_BRAND_NAME} is a free-to-play fantasy sports ranking and skill-comparison platform. No wagers are accepted or placed through ${PUBLIC_BRAND_NAME}.`;

export const THIRD_PARTY_MARKS_NOTICE =
  "NFL, team, and player names, logos, and related marks are property of their respective owners. " +
  `${PUBLIC_BRAND_NAME} and ${COMPANY_NAME} are not affiliated with, endorsed by, or sponsored by the NFL or its teams unless expressly stated.`;

/**
 * Short homepage disambiguation (no competitor name). Keep Rank Equity naming
 * on About / FAQ via NOT_INVESTMENT_DISCLAIMER — do not repeat site-wide.
 */
export const HOMEPAGE_NOT_INVESTMENT_NOTE =
  `${PUBLIC_BRAND_NAME} is unrelated to stock rankings, investment research, or financial advice.`;

/**
 * Full clarification for About / FAQ only — do not repeat site-wide.
 * Distinguishes RankEyeQ from similarly named investment products.
 */
export const NOT_INVESTMENT_DISCLAIMER =
  `${PUBLIC_BRAND_NAME} is unrelated to Rank Equity or any stock-ranking, investment-research, or financial-advice service. ` +
  `${PUBLIC_BRAND_NAME} is a fantasy-football skill competition only and does not provide investment advice.`;

/** Canonical public company website — prefers SNG_LABS_URL, else www.snglabs.com. */
export function getCompanyWebsiteUrl(): string {
  const url = process.env.SNG_LABS_URL?.trim().replace(/\/$/, "");
  return url || CANONICAL_COMPANY_ORIGIN;
}

/** Support or legal contact email — set SUPPORT_EMAIL or LEGAL_CONTACT_EMAIL. */
export function getSupportContactEmail(): string | null {
  return (
    process.env.SUPPORT_EMAIL?.trim() ||
    process.env.LEGAL_CONTACT_EMAIL?.trim() ||
    null
  );
}

export function formatContactLine(): string {
  const email = getSupportContactEmail();
  if (email) {
    return `Contact: ${email}`;
  }
  return `Contact us through ${getCompanyWebsiteUrl()}.`;
}
