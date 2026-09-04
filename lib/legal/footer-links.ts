import { getCompanyWebsiteUrl } from "@/lib/company";
import { policyRoute, type PolicySlug } from "@/lib/legal/policies";

export type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

export const FOOTER_PRIMARY_LINKS: FooterLink[] = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Terms", href: policyRoute("terms") },
  { label: "Privacy", href: policyRoute("privacy") },
  { label: "Eligibility", href: policyRoute("eligibility") },
  { label: "Responsible Play", href: policyRoute("responsible-play") },
  { label: "Community Guidelines", href: policyRoute("community") },
  { label: "AI Disclosure", href: policyRoute("ai-disclosure") },
];

export const FOOTER_SECONDARY_LINKS: FooterLink[] = [
  { label: "Cookies", href: policyRoute("cookies") },
  { label: "Archive", href: "/archive" },
  { label: "Rankers", href: "/rankers" },
  {
    label: "SNG LABS",
    href: getCompanyWebsiteUrl() ?? "#",
    external: Boolean(getCompanyWebsiteUrl()),
  },
];

export function footerPolicySlugs(): PolicySlug[] {
  return FOOTER_PRIMARY_LINKS.filter((link) => link.href.startsWith("/legal/")).map(
    (link) => link.href.replace("/legal/", "") as PolicySlug,
  );
}
