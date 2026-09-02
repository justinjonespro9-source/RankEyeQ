"use client";

import Link from "next/link";
import { useState } from "react";
import type { SelectableProfile } from "@/components/rank/ProfileSelector";

/**
 * Local debug aid only. Does not affect ranking mutations or sessions.
 */
export function DevProfileSelector({
  profiles,
}: {
  profiles: SelectableProfile[];
  activeProfileId?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-3 right-3 z-40 max-w-[16rem]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-md border border-warning/40 bg-warning-soft/95 px-3 py-2 text-left text-xs shadow-sm backdrop-blur"
      >
        <span className="font-semibold uppercase tracking-wide text-warning">
          Dev debug
        </span>
        <span className="mt-0.5 block truncate text-muted">
          Profile links only — use Sign In for auth
        </span>
      </button>
      {open ? (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-surface-elevated p-3 shadow-lg">
          <p className="text-[11px] text-muted">
            RANKIQ_DEV_PROFILE_SWITCHER=1. Mutations use the Auth.js session
            UniversalProfile, never this list.
          </p>
          <ul className="mt-2 space-y-1">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <Link
                  href={`/profile/${profile.username}`}
                  className="block truncate text-xs text-accent hover:underline"
                >
                  {profile.displayName} · {profile.profileType}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
