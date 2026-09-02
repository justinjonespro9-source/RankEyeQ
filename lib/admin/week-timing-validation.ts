import { RANKIQ_TIMEZONE } from "@/lib/timing/chicago";
import type { ContestStatus } from "@/lib/generated/prisma/client";

export type WeekTimingWarning = {
  code:
    | "open_before_rankings_open"
    | "rankings_open_after_lock"
    | "reveal_before_lock"
    | "public_before_reveal"
    | "lock_before_rankings_open";
  message: string;
};

export type WeekTimingDisplay = {
  timeZone: typeof RANKIQ_TIMEZONE;
  rankingsOpenAt: Date | null;
  fullLockAt: Date | null;
  revealStartsAt: Date | null;
  publicReleaseAt: Date | null;
  warnings: WeekTimingWarning[];
};

export function getWeekTimingWarnings(input: {
  rankingsOpenAt?: Date | null;
  fullLockAt?: Date | null;
  revealStartsAt?: Date | null;
  publicReleaseAt?: Date | null;
  contestStatuses?: ContestStatus[];
  now?: Date;
}): WeekTimingWarning[] {
  const now = input.now ?? new Date();
  const warnings: WeekTimingWarning[] = [];
  const {
    rankingsOpenAt,
    fullLockAt,
    revealStartsAt,
    publicReleaseAt,
  } = input;

  const anyContestOpen = input.contestStatuses?.some(
    (status) => status === "OPEN",
  );

  if (
    anyContestOpen &&
    rankingsOpenAt &&
    rankingsOpenAt > now
  ) {
    warnings.push({
      code: "open_before_rankings_open",
      message:
        "One or more contests are OPEN but rankings do not open until later — users cannot submit yet.",
    });
  }

  if (rankingsOpenAt && fullLockAt && rankingsOpenAt >= fullLockAt) {
    warnings.push({
      code: "rankings_open_after_lock",
      message:
        "Rankings open time is on or after Sunday full lock — adjust timing before opening the week.",
    });
  }

  if (fullLockAt && rankingsOpenAt && fullLockAt <= rankingsOpenAt) {
    warnings.push({
      code: "lock_before_rankings_open",
      message: "Sunday full lock is before rankings open — submissions would never be allowed.",
    });
  }

  const reveal = revealStartsAt ?? fullLockAt;
  if (reveal && fullLockAt && reveal < fullLockAt) {
    warnings.push({
      code: "reveal_before_lock",
      message: "Reveal start is before Sunday full lock.",
    });
  }

  if (publicReleaseAt && reveal && publicReleaseAt < reveal) {
    warnings.push({
      code: "public_before_reveal",
      message: "Public release is before the reveal window starts.",
    });
  }

  return warnings;
}

export function buildWeekTimingDisplay(input: {
  rankingsOpenAt?: Date | null;
  fullLockAt?: Date | null;
  revealStartsAt?: Date | null;
  publicReleaseAt?: Date | null;
  contestStatuses?: ContestStatus[];
  now?: Date;
}): WeekTimingDisplay {
  return {
    timeZone: RANKIQ_TIMEZONE,
    rankingsOpenAt: input.rankingsOpenAt ?? null,
    fullLockAt: input.fullLockAt ?? null,
    revealStartsAt: input.revealStartsAt ?? input.fullLockAt ?? null,
    publicReleaseAt: input.publicReleaseAt ?? null,
    warnings: getWeekTimingWarnings(input),
  };
}
