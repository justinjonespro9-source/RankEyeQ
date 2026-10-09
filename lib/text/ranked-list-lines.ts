/**
 * Line-level extraction for pasted ordered lists ("1. Name", CSV / TSV rows).
 * Each helper reads one line or row; callers decide what an unparsed line
 * means (Rankings skips it, Waivers rejects the whole response).
 */

export const RANKED_LIST_HEADER_TOKENS: ReadonlySet<string> = new Set(["rank", "player", "name", "pos", "position", "team"]);

const NUMBERED_LINE = /^(?:#{1,6}\s*)?(?:\d+)\s*(?:[\.\)\:\-\]]\s+|\s+)(.+)$/;

/** Strips list bullets, bold/underline markers and a trailing parenthetical. */
export function cleanRankedListName(value: string) {
  return value
    .replace(/^[-*+]\s+/, "")
    .replace(/\*\*(.+)\*\*/, "$1")
    .replace(/__(.+)__/, "$1")
    .replace(/\s+\(.*\)$/, "")
    .trim();
}

/** Rank and the uncleaned name text of a numbered line, or null when the trimmed line is not numbered. */
export function matchNumberedRankedLine(line: string): { rank: number; rawName: string } | null {
  const match = line.match(NUMBERED_LINE);
  if (!match) return null;
  const rankMatch = line.match(/(\d+)/);
  if (!rankMatch) return null;
  const rank = Number(rankMatch[1]);
  if (!Number.isInteger(rank) || rank < 1) return null;
  return { rank, rawName: match[1] };
}

export function isRankedListHeaderRow(cols: ReadonlyArray<string>) {
  return cols.every((col) => RANKED_LIST_HEADER_TOKENS.has(col.toLowerCase()));
}

/**
 * The first all-digit column (rank) and the first name-like column of a
 * delimited row. Either is null when absent; the rank may be 0.
 */
export function pickRankedListColumns(cols: ReadonlyArray<string>): { rank: number | null; rawName: string | null } {
  const rankCol = cols.findIndex((col) => /^\d+$/.test(col));
  const nameCol = cols.find((col, index) => {
    if (index === rankCol) return false;
    if (/^\d+$/.test(col)) return false;
    if (RANKED_LIST_HEADER_TOKENS.has(col.toLowerCase())) return false;
    if (col.length < 2) return false;
    return /[a-zA-Z]/.test(col);
  });
  return { rank: rankCol >= 0 ? Number(cols[rankCol]) : null, rawName: nameCol ?? null };
}
