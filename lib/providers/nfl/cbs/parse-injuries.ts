import {
  mapGameStatusToAvailability,
  teamAbbrFromInjuryLabel,
  type ParsedInjuryRow,
} from "@/lib/providers/nfl/nflcom/parse-injuries";

export const CBS_INJURIES_URL =
  "https://www.cbssports.com/nfl/injuries/daily/";

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

/**
 * Best-effort CBS daily injuries parser.
 * CBS layouts vary; returns [] (does not throw) when structure is unrecognized
 * so NFL.com remains authoritative.
 */
export function parseCbsInjuriesHtml(html: string): ParsedInjuryRow[] {
  if (!html || html.length < 200) return [];

  const rows: ParsedInjuryRow[] = [];

  // Common pattern: team header then TableBase rows with player / pos / status.
  const blocks = [
    ...html.matchAll(
      /(?:TeamLogoNameLockup-name|TableBase-title|team-name)[^>]*>([\s\S]*?)<\/(?:a|span|div)>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/gi,
    ),
  ];

  for (const block of blocks) {
    const teamLabel = decodeHtmlText(block[1] ?? "");
    const team = teamAbbrFromInjuryLabel(teamLabel);
    if (!team) continue;
    const tbody = block[2] ?? "";
    const trs = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const trMatch of trs) {
      const tr = trMatch[1] ?? "";
      const tds = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
        (m) => m[1] ?? "",
      );
      if (tds.length < 3) continue;
      const nameLink = tds[0]?.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      const name = nameLink
        ? decodeHtmlText(nameLink[1] ?? "")
        : cellText(tds[0] ?? "");
      if (!name || /player/i.test(name)) continue;
      const position = cellText(tds[1] ?? "").toUpperCase();
      // Status often last cell
      const gameStatusRaw = cellText(tds[tds.length - 1] ?? "");
      rows.push({
        name,
        team,
        position,
        injury: tds.length > 3 ? cellText(tds[2] ?? "") : "",
        practiceStatus: "",
        gameStatusRaw,
        gameStatus: mapGameStatusToAvailability(gameStatusRaw),
        externalId: null,
        source: "cbs",
      });
    }
  }

  // Markdown-ish fallback for test fixtures / converted pages
  if (rows.length === 0) {
    const mdRows = [
      ...html.matchAll(
        /^\|\s*([^|]+?)\s*\|\s*([A-Z]{1,3})\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*(Out|Doubtful|Questionable|)\s*\|/gim,
      ),
    ];
    for (const match of mdRows) {
      const name = match[1]!.trim();
      if (/^player$/i.test(name)) continue;
      const position = match[2]!.trim().toUpperCase();
      const gameStatusRaw = (match[5] ?? "").trim();
      rows.push({
        name,
        team: "UNK",
        position,
        injury: (match[3] ?? "").trim(),
        practiceStatus: (match[4] ?? "").trim(),
        gameStatusRaw,
        gameStatus: mapGameStatusToAvailability(gameStatusRaw),
        externalId: null,
        source: "cbs",
      });
    }
  }

  return rows;
}
