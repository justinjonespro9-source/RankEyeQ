import Link from "next/link";
import { Container } from "./Container";
import { CommunityLinks } from "./CommunityLinks";
import { BrandWordmark } from "@/components/brand/BrandWordmark";
import {
  COMPANY_PRODUCT_TAGLINE,
  COPYRIGHT_NOTICE,
  getCompanyWebsiteUrl,
  NO_WAGERING_DISCLAIMER,
  THIRD_PARTY_MARKS_NOTICE,
} from "@/lib/company";
import {
  FOOTER_PRIMARY_LINKS,
  FOOTER_SECONDARY_LINKS,
} from "@/lib/legal/footer-links";
import { getSessionSnapshot } from "@/lib/auth/session";

function FooterLinkRow({
  links,
}: {
  links: typeof FOOTER_PRIMARY_LINKS;
}) {
  return (
    <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2.5 text-sm leading-snug">
      {links.map((link) =>
        link.external ? (
          <a
            key={link.href}
            href={link.href}
            className="text-muted hover:text-ink"
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        ) : (
          <Link
            key={link.href}
            href={link.href}
            className={
              link.href === "/how-it-works" || link.href === "/about"
                ? "font-medium text-ink hover:text-accent-ink"
                : "text-muted hover:text-ink"
            }
          >
            {link.label}
          </Link>
        ),
      )}
    </nav>
  );
}

export async function SiteFooter() {
  const user = await getSessionSnapshot();
  const isAdmin = user?.role === "ADMIN";
  const signedIn = Boolean(user);
  const companyUrl = getCompanyWebsiteUrl();

  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <Container className="flex flex-col gap-5 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <BrandWordmark size="sm" variant="light" />
            <p className="mt-1 text-sm text-muted">
              <a
                href={companyUrl}
                className="hover:text-ink"
                target="_blank"
                rel="noopener noreferrer"
              >
                {COMPANY_PRODUCT_TAGLINE}
              </a>
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <CommunityLinks />
            {signedIn ? null : (
              <Link href="/signin" className="text-sm text-muted hover:text-ink">
                Sign In
              </Link>
            )}
          </div>
        </div>

        <FooterLinkRow links={FOOTER_PRIMARY_LINKS} />
        <FooterLinkRow links={FOOTER_SECONDARY_LINKS} />

        {isAdmin ? (
          <p className="text-sm">
            <Link href="/admin" className="text-muted hover:text-ink">
              Admin
            </Link>
          </p>
        ) : null}

        <div className="space-y-2 border-t border-border pt-4 text-[11px] leading-relaxed text-muted sm:text-xs">
          <p>{NO_WAGERING_DISCLAIMER}</p>
          <p>{COPYRIGHT_NOTICE}</p>
          <p>{THIRD_PARTY_MARKS_NOTICE}</p>
        </div>
      </Container>
    </footer>
  );
}
