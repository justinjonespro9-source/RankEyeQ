import {
  parseNumberedRankingLines,
  parseRankingPaste,
  type ParsedRankLine,
} from "@/lib/admin/ai-parser";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

export type TierParseResult =
  | {
      ok: true;
      mode: "ordered_tiers" | "flat";
      lines: ParsedRankLine[];
      tierCount: number;
    }
  | {
      ok: false;
      mode: "ambiguous_tiers";
      error: string;
      lines: ParsedRankLine[];
      tierCount: number;
    };

const TIER_HEADER =
  /^(?:tier|group)\s*#?\s*(\d+)\s*(?:\((ordered|unordered|ambiguous)\))?\s*[:.\-]?$/i;
const UNORDERED_HINT =
  /\b(unordered|no\s*order|tie|tied|equal|same\s*tier|any\s*order|ambiguous)\b/i;

/**
 * Flatten ordered creator tiers into a single ranking.
 *
 * Rules:
 * - Explicit numbered names inside a tier keep relative order.
 * - Unnumbered names inside a tier are treated as document order (ordered).
 * - If a tier is marked unordered/ambiguous (header or inline note), refuse import.
 *
 * Document clearly: never invent order within an unordered tier.
 */
export function parseOrderedTierOrFlat(text: string): TierParseResult {
  const rawLines = text.split(/\r?\n/);
  const hasTier = rawLines.some((line) => TIER_HEADER.test(line.trim()));
  if (!hasTier) {
    return {
      ok: true,
      mode: "flat",
      lines: parseRankingPaste(text),
      tierCount: 0,
    };
  }

  const tiers: Array<{
    index: number;
    ordered: boolean;
    body: string[];
  }> = [];
  let current: { index: number; ordered: boolean; body: string[] } | null =
    null;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(TIER_HEADER);
    if (header) {
      const flag = (header[2] ?? "").toLowerCase();
      const unordered =
        flag === "unordered" ||
        flag === "ambiguous" ||
        UNORDERED_HINT.test(line);
      current = {
        index: Number(header[1]),
        ordered: !unordered,
        body: [],
      };
      tiers.push(current);
      continue;
    }
    if (!current) {
      // Leading prose before first tier — ignore for tier mode
      continue;
    }
    if (UNORDERED_HINT.test(line) && !/^[A-Za-z].+\s+[A-Za-z]/.test(line)) {
      current.ordered = false;
      continue;
    }
    current.body.push(line);
  }

  if (tiers.length === 0) {
    return {
      ok: true,
      mode: "flat",
      lines: parseRankingPaste(text),
      tierCount: 0,
    };
  }

  const ambiguous = tiers.filter((tier) => !tier.ordered);
  if (ambiguous.length > 0) {
    return {
      ok: false,
      mode: "ambiguous_tiers",
      tierCount: tiers.length,
      lines: [],
      error:
        `Tier ${ambiguous.map((tier) => tier.index).join(", ")} is unordered/ambiguous. ` +
        "Do not invent order within a tier. Number players inside the tier, mark the tier ordered, " +
        "or resolve order from the source before importing for competition.",
    };
  }

  const flattened: ParsedRankLine[] = [];
  let nextRank = 1;
  for (const tier of tiers.sort((a, b) => a.index - b.index)) {
    const bodyText = tier.body.join("\n");
    const numbered = parseNumberedRankingLines(bodyText);
    const ordered =
      numbered.length > 0
        ? numbered.sort((a, b) => a.rank - b.rank)
        : parseRankingPaste(bodyText);
    for (const row of ordered) {
      flattened.push({ rank: nextRank, rawName: row.rawName });
      nextRank += 1;
    }
  }

  return {
    ok: true,
    mode: "ordered_tiers",
    lines: flattened,
    tierCount: tiers.length,
  };
}

export type MultiPositionPasteSection = {
  position: ContestPosition;
  text: string;
  lines: ParsedRankLine[];
};

/**
 * Optional bulk paste:
 * QB
 * 1. ...
 * RB
 * 1. ...
 */
export function parseMultiPositionCreatorPaste(text: string): {
  sections: MultiPositionPasteSection[];
  residual: string;
} {
  const lines = text.split(/\r?\n/);
  const sections: MultiPositionPasteSection[] = [];
  let currentPos: ContestPosition | null = null;
  let buffer: string[] = [];
  const residual: string[] = [];

  function flush() {
    if (!currentPos) return;
    const body = buffer.join("\n").trim();
    if (!body) {
      buffer = [];
      return;
    }
    const tiered = parseOrderedTierOrFlat(body);
    sections.push({
      position: currentPos,
      text: body,
      lines: tiered.ok ? tiered.lines : [],
    });
    buffer = [];
  }

  for (const raw of lines) {
    const trimmed = raw.trim();
    const posMatch = trimmed.match(/^(QB|RB|WR|TE|DEF)\s*$/i);
    if (posMatch) {
      flush();
      currentPos = posMatch[1].toUpperCase() as ContestPosition;
      continue;
    }
    if (currentPos) buffer.push(raw);
    else if (trimmed) residual.push(raw);
  }
  flush();

  // Preserve CONTEST_POSITIONS order when present
  sections.sort(
    (a, b) =>
      CONTEST_POSITIONS.indexOf(a.position) -
      CONTEST_POSITIONS.indexOf(b.position),
  );

  return { sections, residual: residual.join("\n") };
}

/** Creator import paste entrypoint: tiers first, else flat paste formats. */
export function parseCreatorRankingPaste(text: string): TierParseResult {
  return parseOrderedTierOrFlat(text);
}
