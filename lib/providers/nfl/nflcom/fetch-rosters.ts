import {
  abbreviationForTeamSlug,
  allNflComRosterUrls,
  NFL_COM_ROSTER_SITEMAP_URL,
  rosterUrlForTeamSlug,
} from "@/lib/providers/nfl/nflcom/teams";
import {
  isFantasySourcePosition,
  mapSourcePositionToFantasy,
  parseNflComRosterHtml,
  type ParsedNflComRosterRow,
} from "@/lib/providers/nfl/nflcom/parse-roster";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export const NFL_COM_BOOTSTRAP_PROVIDER = "nflcom-bootstrap";

export type NormalizedRosterPlayer = ParsedNflComRosterRow & {
  team: string;
  fantasyPosition: ContestPosition;
  rosterUrl: string;
};

export type NormalizedRosterBundle = {
  source: string;
  syncedAt: Date;
  teamCount: number;
  teams: string[];
  players: NormalizedRosterPlayer[];
  skippedNonFantasy: number;
  fetchErrors: Array<{ team: string; url: string; error: string }>;
};

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; text: () => Promise<string>; status: number }>;

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

async function fetchText(url: string, fetchFn: FetchLike) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "RankEyeQ-RosterBootstrap/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

/** Resolve team roster URLs from sitemap when available; otherwise use known slugs. */
export async function resolveNflComRosterUrls(fetchFn: FetchLike = fetch) {
  try {
    const xml = await fetchText(NFL_COM_ROSTER_SITEMAP_URL, fetchFn);
    const urls = [
      ...xml.matchAll(
        /<loc>(https:\/\/www\.nfl\.com\/teams\/[a-z0-9-]+\/roster\/?)<\/loc>/gi,
      ),
    ].map((match) => match[1]!);
    const unique = [...new Set(urls)];
    if (unique.length >= 32) {
      return unique;
    }
  } catch {
    // Fall back to static slug list.
  }
  return allNflComRosterUrls();
}

function teamFromRosterUrl(url: string) {
  const match = url.match(/\/teams\/([a-z0-9-]+)\/roster\/?$/i);
  if (!match) return null;
  return abbreviationForTeamSlug(match[1]!);
}

export async function fetchNormalizedNflComRosters(input?: {
  fetchFn?: FetchLike;
  rosterUrls?: string[];
  htmlByUrl?: Record<string, string>;
}): Promise<NormalizedRosterBundle> {
  const fetchFn = input?.fetchFn ?? fetch;
  const urls =
    input?.rosterUrls ??
    (input?.htmlByUrl ? Object.keys(input.htmlByUrl) : await resolveNflComRosterUrls(fetchFn));

  const syncedAt = new Date();
  const players: NormalizedRosterPlayer[] = [];
  const teams = new Set<string>();
  const fetchErrors: NormalizedRosterBundle["fetchErrors"] = [];
  let skippedNonFantasy = 0;

  for (const url of urls) {
    const team = teamFromRosterUrl(url);
    if (!team) {
      fetchErrors.push({ team: "?", url, error: "Unrecognized roster URL" });
      continue;
    }

    try {
      const html =
        input?.htmlByUrl?.[url] ?? (await fetchText(url, fetchFn));
      const rows = parseNflComRosterHtml(html);
      teams.add(team);

      for (const row of rows) {
        if (!isFantasySourcePosition(row.sourcePosition)) {
          skippedNonFantasy += 1;
          continue;
        }
        const fantasyPosition = mapSourcePositionToFantasy(row.sourcePosition);
        if (!fantasyPosition) continue;

        players.push({
          ...row,
          team,
          fantasyPosition,
          rosterUrl: url,
        });
      }
    } catch (error) {
      fetchErrors.push({
        team,
        url,
        error: error instanceof Error ? error.message : "Fetch failed",
      });
    }
  }

  return {
    source: "nfl.com/teams/*/roster",
    syncedAt,
    teamCount: teams.size,
    teams: [...teams].sort(),
    players,
    skippedNonFantasy,
    fetchErrors,
  };
}

export function bundleFromFixtureHtml(input: {
  team: string;
  slug: string;
  html: string;
}): NormalizedRosterBundle {
  const url = rosterUrlForTeamSlug(input.slug);
  const rows = parseNflComRosterHtml(input.html);
  const players: NormalizedRosterPlayer[] = [];

  for (const row of rows) {
    if (!isFantasySourcePosition(row.sourcePosition)) continue;
    const fantasyPosition = mapSourcePositionToFantasy(row.sourcePosition);
    if (!fantasyPosition) continue;
    players.push({
      ...row,
      team: input.team,
      fantasyPosition,
      rosterUrl: url,
    });
  }

  return {
    source: "fixture",
    syncedAt: new Date("2026-08-31T00:00:00.000Z"),
    teamCount: 1,
    teams: [input.team],
    players,
    skippedNonFantasy: 0,
    fetchErrors: [],
  };
}
