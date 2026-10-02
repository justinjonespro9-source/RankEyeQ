"use client";

import { useEffect, useRef, useState } from "react";

function remainingLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return mins > 0 ? `${mins}m` : "under a minute";
}

/**
 * Display-only countdown anchored to the server clock at render. Reaching zero
 * only asks the server to re-render; the server alone decides the lock.
 */
export function WaiverLockClock({
  locksAt,
  lockLabel,
  serverNow,
  onLockReached,
}: {
  locksAt: string;
  lockLabel: string;
  serverNow: string;
  onLockReached: () => void;
}) {
  const lockMs = new Date(locksAt).getTime();
  const [remaining, setRemaining] = useState(() => lockMs - new Date(serverNow).getTime());
  const fired = useRef(false);

  useEffect(() => {
    const offset = new Date(serverNow).getTime() - Date.now();
    const tick = () => {
      const left = lockMs - (Date.now() + offset);
      setRemaining(left);
      if (left <= 0 && !fired.current) {
        fired.current = true;
        onLockReached();
      }
    };
    tick();
    const timer = setInterval(tick, 15_000);
    const untilLock = lockMs - (Date.now() + offset);
    const atLock = untilLock > 0 && untilLock < 2 ** 31 - 1 ? setTimeout(tick, untilLock + 250) : null;
    return () => {
      clearInterval(timer);
      if (atLock) clearTimeout(atLock);
    };
  }, [lockMs, serverNow, onLockReached]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-4 py-3 text-sm">
      <p className="text-ink">
        <span className="font-semibold">Open</span> · Locks {lockLabel}
      </p>
      <p className="text-muted" aria-hidden="true">
        {remaining > 0 ? `${remainingLabel(remaining)} left` : "Locking…"}
      </p>
    </div>
  );
}
