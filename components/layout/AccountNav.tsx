"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/lib/auth-actions";

export type AccountNavUser = {
  email: string | null;
  username: string | null;
  displayName: string | null;
  image: string | null;
  isAdmin: boolean;
};

function initials(name: string) {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function AccountNav({ user }: { user: AccountNavUser | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <Link
        href="/signin"
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Sign In
      </Link>
    );
  }

  const label = user.displayName || user.username || user.email || "Account";
  const profileHref = user.username ? `/profile/${user.username}` : "/account/setup";

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          aria-hidden
          className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-[10px] font-semibold text-accent"
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(label)
          )}
        </span>
        <span className="hidden max-w-[8rem] truncate font-medium text-ink sm:inline">
          {user.username ? `@${user.username}` : label}
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-52 rounded-md border border-border bg-surface-elevated p-2 shadow-lg">
          <p className="truncate px-2 py-1 text-xs text-muted">{user.email}</p>
          <Link
            href={profileHref}
            className={`block rounded-md px-2 py-2 text-sm hover:bg-surface ${
              pathname === profileHref ? "bg-accent-soft text-accent" : "text-ink"
            }`}
            onClick={() => setOpen(false)}
          >
            My Profile
          </Link>
          <Link
            href="/following"
            className={`block rounded-md px-2 py-2 text-sm hover:bg-surface ${
              pathname === "/following" ? "bg-accent-soft text-accent" : "text-ink"
            }`}
            onClick={() => setOpen(false)}
          >
            Following
          </Link>
          <Link
            href="/account"
            className={`block rounded-md px-2 py-2 text-sm hover:bg-surface ${
              pathname === "/account" ? "bg-accent-soft text-accent" : "text-ink"
            }`}
            onClick={() => setOpen(false)}
          >
            Account
          </Link>
          {user.isAdmin ? (
            <Link
              href="/admin"
              className="block rounded-md px-2 py-2 text-sm text-ink hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Admin
            </Link>
          ) : null}
          <form action={signOutAction}>
            <button
              type="submit"
              className="mt-1 w-full rounded-md px-2 py-2 text-left text-sm text-ink hover:bg-surface"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
