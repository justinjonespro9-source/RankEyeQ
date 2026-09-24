"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ADMIN_DEVELOPER_LINKS,
  ADMIN_PRIMARY_LINKS,
  resolveAdminNav,
  type AdminNavGroup,
  type AdminNavLink,
} from "@/lib/admin/admin-nav";

function pillClass(active: boolean, muted = false) {
  if (active) {
    return "bg-accent text-ink border border-transparent";
  }
  if (muted) {
    return "border border-border/70 bg-surface text-muted hover:border-ink/20 hover:text-ink";
  }
  return "border border-border bg-surface-elevated text-ink hover:border-ink/30";
}

function NavPills({
  links,
  activeHref,
  muted = false,
}: {
  links: readonly AdminNavLink[];
  activeHref: string | null;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {links.map((link) => {
        const active = activeHref === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${pillClass(active, muted)}`}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}

function SecondaryNav({
  groups,
  activeHref,
}: {
  groups: readonly AdminNavGroup[];
  activeHref: string | null;
}) {
  return (
    <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
      {groups.map((group) => (
        <div key={group.label} className="min-w-0">
          <p className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted">
            {group.label}
          </p>
          <NavPills links={group.links} activeHref={activeHref} />
        </div>
      ))}
    </div>
  );
}

/**
 * Shared admin chrome. Primary destinations + contextual secondary by route family.
 * `current` is accepted for call-site compatibility but pathname drives active state.
 */
export function AdminNav({ current: _current }: { current?: string } = {}) {
  void _current;
  const pathname = usePathname() || "/admin";
  const resolved = resolveAdminNav(pathname);
  const developerOpen = resolved.family === "developer";

  return (
    <nav className="mb-8" aria-label="Admin">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <NavPills
          links={ADMIN_PRIMARY_LINKS}
          activeHref={resolved.primaryHref}
        />

        <details
          className="group shrink-0 rounded-md border border-dashed border-border/80 bg-surface px-2 py-1 text-sm text-muted open:border-border open:bg-surface-elevated open:text-ink"
          open={developerOpen ? true : undefined}
          data-testid="admin-developer-tools"
        >
          <summary className="cursor-pointer list-none px-1 py-1 font-medium marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1">
              Developer Tools
              <span aria-hidden className="text-xs opacity-70 group-open:rotate-90">
                ▸
              </span>
            </span>
          </summary>
          <div className="mt-2 pb-1">
            <NavPills
              links={ADMIN_DEVELOPER_LINKS}
              activeHref={resolved.secondaryHref}
              muted
            />
          </div>
        </details>
      </div>

      {resolved.secondaryGroups ? (
        <SecondaryNav
          groups={resolved.secondaryGroups}
          activeHref={resolved.secondaryHref}
        />
      ) : null}
    </nav>
  );
}
