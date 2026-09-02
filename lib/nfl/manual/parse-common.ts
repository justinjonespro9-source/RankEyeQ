import { parseChicagoDateTimeLocal, zonedLocalToUtc } from "@/lib/timing/chicago";
import type { ContestPosition } from "@/lib/generated/prisma/client";

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "DEF"]);

export function splitDelimitedLine(line: string): string[] {
  if (line.includes("|")) {
    return line.split("|").map((part) => part.trim()).filter(Boolean);
  }
  if (line.includes("\t")) {
    return line.split("\t").map((part) => part.trim()).filter(Boolean);
  }
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function isHeaderRow(cols: string[]) {
  const joined = cols.map((col) => col.toLowerCase()).join(" ");
  const first = (cols[0] ?? "").toLowerCase();
  return (
    first === "player" ||
    first === "player name" ||
    first === "name" ||
    first === "away" ||
    first === "away team" ||
    joined === "player position team opponent kickoff" ||
    joined.startsWith("away home") ||
    joined.startsWith("player name") ||
    (first.includes("fantasy") && joined.includes("point"))
  );
}

/** Parse kickoffs like `2026-09-13 12:00 CT` or datetime-local. */
export function parseManualKickoff(raw: string): Date | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return null;

  if (value.includes("T")) {
    const chicagoLocal = parseChicagoDateTimeLocal(value.slice(0, 16));
    if (chicagoLocal) return chicagoLocal;
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?:\s*(?:CT|CDT|CST|America\/Chicago))?$/i,
  );
  if (match) {
    return zonedLocalToUtc(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    );
  }

  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) return asDate;
  return null;
}

export function parseContestPosition(raw: string): ContestPosition | null {
  const upper = raw.trim().toUpperCase();
  if (upper === "DST" || upper === "D/ST" || upper === "D") return "DEF";
  if (POSITIONS.has(upper)) return upper as ContestPosition;
  return null;
}

export function normalizeTeamAbbr(raw: string) {
  return raw.trim().toUpperCase().replace(/\./g, "");
}

export function isMissingTeam(team: string) {
  const t = team.trim().toUpperCase();
  return (
    !t ||
    t === "FA" ||
    t === "FREE AGENT" ||
    t === "NONE" ||
    t === "N/A" ||
    t === "TBD"
  );
}

export function slugifyExternalId(name: string, team: string, position: string) {
  const base = `${name}-${team}-${position}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `manual-${base || "entry"}`;
}

export function shortNameFromFull(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}
