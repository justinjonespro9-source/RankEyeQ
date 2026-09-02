"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { NavLink } from "@/lib/navigation";
import { subnavHrefActive } from "@/lib/navigation";

export function SectionSubnav({
  links,
  ariaLabel,
}: {
  links: NavLink[];
  ariaLabel: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav
      aria-label={ariaLabel}
      className="mb-6 flex flex-wrap gap-2 border-b border-border pb-3"
    >
      {links.map((link) => {
        const active = subnavHrefActive(pathname, searchParams, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-surface-elevated hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
