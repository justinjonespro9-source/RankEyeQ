"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, isPrimaryNavActive } from "@/lib/navigation";

export function PrimaryNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav className={className} aria-label="Primary">
      {PRIMARY_NAV.map((link) => {
        const active = isPrimaryNavActive(pathname, link);
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
