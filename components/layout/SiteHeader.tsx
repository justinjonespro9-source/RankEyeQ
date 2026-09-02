import Link from "next/link";
import { Container } from "./Container";
import { AccountNav } from "./AccountNav";
import { MobileNav } from "./MobileNav";
import { PrimaryNav } from "./PrimaryNav";
import { BrandName } from "@/components/ui/BrandName";
import { getSessionSnapshot } from "@/lib/auth/session";

export async function SiteHeader() {
  const sessionUser = await getSessionSnapshot();
  const accountUser = sessionUser
    ? {
        email: sessionUser.email,
        username: sessionUser.username,
        displayName: sessionUser.displayName,
        image: sessionUser.image,
        isAdmin: sessionUser.role === "ADMIN",
      }
    : null;

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-surface/90 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="font-display text-xl font-semibold tracking-tight text-ink"
        >
          <BrandName />
        </Link>

        <PrimaryNav className="hidden items-center gap-1 md:flex" />

        <div className="flex items-center gap-2">
          <AccountNav user={accountUser} />
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
