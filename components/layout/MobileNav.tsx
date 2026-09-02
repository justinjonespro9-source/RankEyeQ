"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LEADERBOARDS_SUBNAV,
  PRIMARY_NAV,
  RESULTS_SUBNAV,
  isPrimaryNavActive,
} from "@/lib/navigation";

function nestedActive(pathname: string, href: string) {
  const [path] = href.split("?");
  if (path === "/results") return pathname === "/results";
  if (path === "/leaderboards") {
    return pathname === "/leaderboards" && !pathname.startsWith("/leaderboards/live");
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-ink"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Close" : "Menu"}
      </button>
      {open ? (
        <div
          id="mobile-nav"
          className="absolute left-0 right-0 top-16 border-b border-border bg-surface-elevated"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 sm:px-6">
            {PRIMARY_NAV.map((link) => {
              const active = isPrimaryNavActive(pathname, link);
              const isResults = link.label === "Results";
              const isLeaderboards = link.label === "Leaderboards";

              return (
                <div key={link.href} className="flex flex-col gap-1">
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`rounded-md px-3 py-2.5 text-sm font-medium ${
                      active
                        ? "bg-accent-soft text-accent"
                        : "text-ink hover:bg-surface"
                    }`}
                  >
                    {link.label}
                  </Link>
                  {isResults ? (
                    <div className="ml-3 flex flex-col gap-1 border-l border-border pl-3">
                      {RESULTS_SUBNAV.map((subLink) => {
                        const subActive = nestedActive(pathname, subLink.href);
                        return (
                          <Link
                            key={subLink.href}
                            href={subLink.href}
                            onClick={() => setOpen(false)}
                            className={`rounded-md px-3 py-2.5 text-sm ${
                              subActive
                                ? "font-medium text-accent"
                                : "text-muted hover:text-ink"
                            }`}
                          >
                            {subLink.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                  {isLeaderboards ? (
                    <div className="ml-3 flex flex-col gap-1 border-l border-border pl-3">
                      {LEADERBOARDS_SUBNAV.map((subLink) => {
                        const [path] = subLink.href.split("?");
                        const subActive =
                          path === "/rankers"
                            ? pathname === "/rankers"
                            : nestedActive(pathname, subLink.href);
                        return (
                          <Link
                            key={subLink.href}
                            href={subLink.href}
                            onClick={() => setOpen(false)}
                            className={`rounded-md px-3 py-2.5 text-sm ${
                              subActive
                                ? "font-medium text-accent"
                                : "text-muted hover:text-ink"
                            }`}
                          >
                            {subLink.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
