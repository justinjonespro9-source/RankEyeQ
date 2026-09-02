import type { ContestPosition } from "@/lib/generated/prisma/client";

export type ParsedNflComRosterRow = {
  externalId: string;
  name: string;
  jerseyNumber: string;
  sourcePosition: string;
  sourceStatus: string;
  height: string;
  weight: string;
  experience: string;
  college: string;
};

const FANTASY_SOURCE_POSITIONS = new Set(["QB", "RB", "FB", "WR", "TE"]);

export function isFantasySourcePosition(position: string) {
  return FANTASY_SOURCE_POSITIONS.has(position.trim().toUpperCase());
}

export function mapSourcePositionToFantasy(
  sourcePosition: string,
): ContestPosition | null {
  const pos = sourcePosition.trim().toUpperCase();
  if (pos === "FB") return "RB";
  if (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE") return pos;
  return null;
}

function decodeHtmlText(value: string) {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(tdHtml: string) {
  const stripped = tdHtml.replace(/<[^>]+>/g, " ");
  return decodeHtmlText(stripped);
}

/** Parse NFL.com team roster HTML into normalized rows. */
export function parseNflComRosterHtml(html: string): ParsedNflComRosterRow[] {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const players: ParsedNflComRosterRow[] = [];

  for (const rowMatch of rows) {
    const row = rowMatch[1] ?? "";
    if (!row.includes("nfl-o-roster__player-name")) continue;

    const link = row.match(/href="\/players\/([^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (!link) continue;

    const externalId = link[1]!.trim().replace(/\/$/, "");
    const name = decodeHtmlText(link[2] ?? "");
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    const dataCells = tds.slice(1).map((match) => cellText(match[1] ?? ""));
    if (dataCells.length < 3) continue;

    players.push({
      externalId,
      name,
      jerseyNumber: dataCells[0] ?? "",
      sourcePosition: (dataCells[1] ?? "").toUpperCase(),
      sourceStatus: (dataCells[2] ?? "").toUpperCase(),
      height: dataCells[3] ?? "",
      weight: dataCells[4] ?? "",
      experience: dataCells[5] ?? "",
      college: dataCells[6] ?? "",
    });
  }

  return players;
}
