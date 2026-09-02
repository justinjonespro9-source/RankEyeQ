/** Official RankIQ NFL timezone — never hardcode CST/CDT. */
export const RANKIQ_TIMEZONE = "America/Chicago";

export type ChicagoDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

export function getZonedParts(
  date: Date,
  timeZone = RANKIQ_TIMEZONE,
): ChicagoDateParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday),
  };
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date.
 * DST-safe via offset iteration (Chicago included).
 */
export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  timeZone = RANKIQ_TIMEZONE,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const mapped = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = wanted - mapped;
    utc += diff;
    if (diff === 0) break;
  }
  return new Date(utc);
}

export function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
) {
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function chicagoCalendarDate(date: Date) {
  const parts = getZonedParts(date);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function chicagoWeekday(date: Date) {
  return getZonedParts(date).weekday;
}

export function formatInChicago(date: Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: RANKIQ_TIMEZONE,
    ...options,
  }).format(date);
}

/** `datetime-local` value representing America/Chicago wall clock. */
export function toChicagoDateTimeLocal(date: Date) {
  const parts = getZonedParts(date);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Parse a `datetime-local` string as America/Chicago wall clock. */
export function parseChicagoDateTimeLocal(value: string): Date | null {
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!match) return null;
  return zonedLocalToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
}
