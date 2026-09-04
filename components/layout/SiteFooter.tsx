import Link from "next/link";
import { Container } from "./Container";
import { BrandName } from "@/components/ui/BrandName";
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
    <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
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
              link.href === "/how-it-works"
                ? "font-medium text-ink hover:text-accent"
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

  const secondaryLinks = FOOTER_SECONDARY_LINKS.filter(
    (link) => link.label !== "SNG LABS" || companyUrl,
  );

  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <Container className="flex flex-col gap-5 py-8">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-lg font-semibold text-ink">
              <BrandName />
            </p>
            <p className="mt-1 text-sm text-muted">
              {companyUrl ? (
                <a
                  href={companyUrl}
                  className="hover:text-ink"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {COMPANY_PRODUCT_TAGLINE}
                </a>
              ) : (
                COMPANY_PRODUCT_TAGLINE
              )}
            </p>
          </div>
          {signedIn ? null : (
            <Link href="/signin" className="text-sm text-muted hover:text-ink">
              Sign In
            </Link>
          )}
        </div>

        <FooterLinkRow links={FOOTER_PRIMARY_LINKS} />
        <FooterLinkRow links={secondaryLinks} />

        {isAdmin ? (
          <p className="text-sm">
            <Link href="/admin" className="text-muted hover:text-ink">
              Admin
            </Link>
          </p>
        ) : null}

        <div className="space-y-2 border-t border-border pt-4 text-xs leading-relaxed text-muted">
          <p>{NO_WAGERING_DISCLAIMER}</p>
          <p>{COPYRIGHT_NOTICE}</p>
          <p>{THIRD_PARTY_MARKS_NOTICE}</p>
        </div>
      </Container>
    </footer>
  );
}
