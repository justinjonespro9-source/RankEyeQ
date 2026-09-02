import { PUBLIC_BRAND_NAME } from "@/lib/brand";

/** Operator of RankEyeQ. */
export const COMPANY_NAME = "SNG LABS";

export const COMPANY_LEGAL_NAME = "SNG LABS LLC";

export const COMPANY_PRODUCT_TAGLINE = `A product of ${COMPANY_NAME}`;

export const COPYRIGHT_NOTICE = `© ${2026} ${COMPANY_LEGAL_NAME}. All rights reserved.`;

export const NO_WAGERING_DISCLAIMER =
  `${PUBLIC_BRAND_NAME} is a free-to-play fantasy sports ranking and skill-comparison platform. No wagers are accepted or placed through ${PUBLIC_BRAND_NAME}.`;

export const THIRD_PARTY_MARKS_NOTICE =
  "NFL, team, and player names, logos, and related marks are property of their respective owners. " +
  `${PUBLIC_BRAND_NAME} and ${COMPANY_NAME} are not affiliated with, endorsed by, or sponsored by the NFL or its teams unless expressly stated.`;

/** Canonical public company website — set SNG_LABS_URL in environment. */
export function getCompanyWebsiteUrl(): string | null {
  const url = process.env.SNG_LABS_URL?.trim();
  return url || null;
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
  const website = getCompanyWebsiteUrl();
  if (website) {
    return `Contact us through ${website}.`;
  }
  return "Contact information will be published before general availability.";
}
