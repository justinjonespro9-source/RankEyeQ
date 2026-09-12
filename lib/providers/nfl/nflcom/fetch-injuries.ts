import {
  NFL_COM_INJURIES_URL,
  parseNflComInjuriesHtml,
  type ParsedInjuryRow,
} from "@/lib/providers/nfl/nflcom/parse-injuries";
import {
  CBS_INJURIES_URL,
  parseCbsInjuriesHtml,
} from "@/lib/providers/nfl/cbs/parse-injuries";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; text: () => Promise<string>; status: number }>;

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

async function fetchText(url: string, fetchFn: FetchLike) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DEFAULT_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "RankEyeQ-InjurySync/1.0",
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

export async function fetchNflComInjuryRows(input?: {
  fetchFn?: FetchLike;
  html?: string;
}): Promise<{ rows: ParsedInjuryRow[]; sourceUrl: string; fetchedAt: Date }> {
  const fetchedAt = new Date();
  const html =
    input?.html ??
    (await fetchText(NFL_COM_INJURIES_URL, input?.fetchFn ?? fetch));
  const rows = parseNflComInjuriesHtml(html);
  return { rows, sourceUrl: NFL_COM_INJURIES_URL, fetchedAt };
}

export async function fetchCbsInjuryRows(input?: {
  fetchFn?: FetchLike;
  html?: string;
}): Promise<{ rows: ParsedInjuryRow[]; sourceUrl: string; fetchedAt: Date }> {
  const fetchedAt = new Date();
  try {
    const html =
      input?.html ??
      (await fetchText(CBS_INJURIES_URL, input?.fetchFn ?? fetch));
    const rows = parseCbsInjuriesHtml(html);
    return { rows, sourceUrl: CBS_INJURIES_URL, fetchedAt };
  } catch {
    return { rows: [], sourceUrl: CBS_INJURIES_URL, fetchedAt };
  }
}
