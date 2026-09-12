import { NFL_TEAMS } from "@/lib/nfl-schedule";
import { NFL_COM_TEAM_SLUGS } from "@/lib/providers/nfl/nflcom/teams";
import type { ContestPosition, EntryAvailability } from "@/lib/generated/prisma/client";

export const NFL_COM_INJURIES_URL = "https://www.nfl.com/injuries/";

export const INJURY_SYNC_FANTASY_POSITIONS = new Set<ContestPosition>([
  "QB",
  "RB",
  "WR",
  "TE",
]);

export type ParsedInjuryGameStatus =
  | "QUESTIONABLE"
  | "DOUBTFUL"
  | "OUT"
  | null;

export type ParsedInjuryRow = {
  name: string;
  team: string;
  position: string;
  injury: string;
  practiceStatus: string;
  gameStatusRaw: string;
  gameStatus: ParsedInjuryGameStatus;
  externalId: string | null;
  source: "nfl.com" | "cbs";
};

function decodeHtmlText(value: string) {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(tdHtml: string) {
  return decodeHtmlText(tdHtml.replace(/<[^>]+>/g, " "));
}

/** Map NFL.com Game Status cell → RankableEntry.availability (or null = blank). */
export function mapGameStatusToAvailability(
  raw: string | null | undefined,
): ParsedInjuryGameStatus {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "out" || value === "o") return "OUT";
  if (value.startsWith("doubt")) return "DOUBTFUL";
  if (value.startsWith("question")) return "QUESTIONABLE";
  // Treat IR listed as game status as OUT for weekly ranking purposes.
  if (value === "ir" || value.includes("injured reserve")) return "OUT";
  return null;
}

const NICKNAME_TO_ABBR: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const team of NFL_TEAMS) {
    map[team.abbr.toLowerCase()] = team.abbr;
    map[team.name.toLowerCase()] = team.abbr;
    const parts = team.name.split(/\s+/);
    const nick = parts[parts.length - 1]!.toLowerCase();
    map[nick] = team.abbr;
    // 49ers nickname
    if (team.abbr === "SF") map["49ers"] = "SF";
    if (team.abbr === "WAS") {
      map["commanders"] = "WAS";
      map["football team"] = "WAS";
    }
  }
  for (const [slug, abbr] of Object.entries(NFL_COM_TEAM_SLUGS)) {
    map[slug] = abbr;
    map[slug.replace(/-/g, " ")] = abbr;
  }
  return map;
})();

export function teamAbbrFromInjuryLabel(label: string): string | null {
  const cleaned = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (NICKNAME_TO_ABBR[cleaned]) return NICKNAME_TO_ABBR[cleaned];
  // "NE Patriots" / "SEA Seahawks"
  const tokens = cleaned.split(" ");
  for (let i = tokens.length; i >= 1; i -= 1) {
    const slice = tokens.slice(-i).join(" ");
    if (NICKNAME_TO_ABBR[slice]) return NICKNAME_TO_ABBR[slice];
  }
  if (tokens[0] && /^[a-z]{2,3}$/.test(tokens[0]) && NICKNAME_TO_ABBR[tokens[0]]) {
    return NICKNAME_TO_ABBR[tokens[0]];
  }
  return null;
}

export function isInjuryFantasyPosition(position: string): boolean {
  const pos = position.trim().toUpperCase();
  if (pos === "FB") return true;
  return INJURY_SYNC_FANTASY_POSITIONS.has(pos as ContestPosition);
}

export function mapInjurySourcePosition(
  position: string,
): ContestPosition | null {
  const pos = position.trim().toUpperCase();
  if (pos === "FB") return "RB";
  if (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE") return pos;
  return null;
}

/**
 * Parse NFL.com /injuries HTML tables.
 * Throws when no injury tables/rows are found (caller must not mass-reset).
 */
export function parseNflComInjuriesHtml(html: string): ParsedInjuryRow[] {
  if (!html || html.length < 200) {
    throw new Error("NFL.com injuries HTML was empty or too short");
  }

  const sections = [
    ...html.matchAll(
      /d3-o-section-sub-title[^>]*>\s*<span>([^<]+)<\/span>[\s\S]*?<table[^>]*class="[^"]*d3-o-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi,
    ),
  ];

  if (sections.length === 0) {
    // Fallback: any detailed report tables without requiring class order.
    const alt = [
      ...html.matchAll(
        /d3-o-section-sub-title[^>]*>\s*<span>([^<]+)<\/span>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/gi,
      ),
    ];
    if (alt.length === 0) {
      throw new Error(
        "NFL.com injuries page structure not recognized — no team tables found",
      );
    }
    return parseSections(alt.map((m) => [m[1]!, m[2]!]));
  }

  return parseSections(sections.map((m) => [m[1]!, m[2]!]));
}

function parseSections(sections: Array<[string, string]>): ParsedInjuryRow[] {
  const rows: ParsedInjuryRow[] = [];
  for (const [teamLabel, tableHtml] of sections) {
    const team = teamAbbrFromInjuryLabel(teamLabel);
    if (!team) continue;
    const trs = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const trMatch of trs) {
      const tr = trMatch[1] ?? "";
      if (/<th[\s>]/i.test(tr)) continue;
      const tds = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
        (m) => m[1] ?? "",
      );
      if (tds.length < 5) continue;

      const playerCell = tds[0] ?? "";
      const link = playerCell.match(
        /href="\/players\/([^"/]+)\/?"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const name = link
        ? decodeHtmlText(link[2] ?? "")
        : cellText(playerCell);
      if (!name) continue;
      const externalId = link ? link[1]!.trim() : null;
      const position = cellText(tds[1] ?? "").toUpperCase();
      const injury = cellText(tds[2] ?? "");
      const practiceStatus = cellText(tds[3] ?? "");
      const gameStatusRaw = cellText(tds[4] ?? "");
      rows.push({
        name,
        team,
        position,
        injury,
        practiceStatus,
        gameStatusRaw,
        gameStatus: mapGameStatusToAvailability(gameStatusRaw),
        externalId,
        source: "nfl.com",
      });
    }
  }

  if (rows.length === 0) {
    throw new Error("NFL.com injuries parsed zero player rows");
  }
  return rows;
}

/** Roster-protected statuses that blank game status must not overwrite. */
export const PRESERVED_ROSTER_AVAILABILITY = new Set<EntryAvailability>([
  "IR",
  "PUP",
  "SUSPENDED",
  "FREE_AGENT",
  "INACTIVE",
]);

/**
 * Decide next availability given parsed game status + current value.
 * Blank game status does not wipe IR/PUP/SUSPENDED; otherwise → ACTIVE.
 */
export function nextAvailabilityFromInjuryRow(input: {
  gameStatus: ParsedInjuryGameStatus;
  current: EntryAvailability;
}): EntryAvailability {
  if (input.gameStatus) return input.gameStatus;
  if (PRESERVED_ROSTER_AVAILABILITY.has(input.current)) return input.current;
  return "ACTIVE";
}
