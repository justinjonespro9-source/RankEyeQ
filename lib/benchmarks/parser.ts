import {
  findNameMatches,
  parseRankingPaste,
  type EligibleParserEntry,
  type ParsedRankLine,
  type ParserIssue,
} from "@/lib/admin/ai-parser";

export type SourceExtractRow = {
  sourceRank: number;
  rawName: string;
  matchedEntryId: string | null;
  matchedName: string | null;
  issue: ParserIssue | null;
  candidates: Array<{ id: string; name: string }>;
  selected: boolean;
  rankIqRank: number | null;
  excluded: boolean;
  exclusionReason: string | null;
  extra: boolean;
};

export type TopNExtractResult = {
  rows: SourceExtractRow[];
  selected: SourceExtractRow[];
  rankedEntryIds: (string | null)[];
  ready: boolean;
  blockingIssues: string[];
};

function classifyName(input: {
  rawName: string;
  eligible: EligibleParserEntry[];
  universe?: EligibleParserEntry[];
  otherPositions?: EligibleParserEntry[];
}): {
  matchedEntryId: string | null;
  matchedName: string | null;
  issue: ParserIssue | null;
  candidates: Array<{ id: string; name: string }>;
} {
  const matches = findNameMatches(input.rawName, input.eligible);
  const universeMatches = input.universe
    ? findNameMatches(input.rawName, input.universe)
    : [];
  const otherPositionMatches = input.otherPositions
    ? findNameMatches(input.rawName, input.otherPositions)
    : [];

  if (matches.length === 1) {
    return {
      matchedEntryId: matches[0].id,
      matchedName: matches[0].name,
      issue: null,
      candidates: matches.map((entry) => ({ id: entry.id, name: entry.name })),
    };
  }
  if (matches.length > 1) {
    return {
      matchedEntryId: null,
      matchedName: null,
      issue: "ambiguous",
      candidates: matches.map((entry) => ({ id: entry.id, name: entry.name })),
    };
  }
  if (otherPositionMatches.length > 0) {
    return {
      matchedEntryId: null,
      matchedName: otherPositionMatches[0]?.name ?? null,
      issue: "wrong_position",
      candidates: otherPositionMatches.map((entry) => ({
        id: entry.id,
        name: entry.name,
      })),
    };
  }
  if (universeMatches.length > 0) {
    return {
      matchedEntryId: null,
      matchedName: universeMatches[0]?.name ?? null,
      issue: "ineligible",
      candidates: universeMatches.map((entry) => ({
        id: entry.id,
        name: entry.name,
      })),
    };
  }
  return {
    matchedEntryId: null,
    matchedName: null,
    issue: "unknown",
    candidates: [],
  };
}

/**
 * Walk a (possibly deep) source ranking in published order and extract the first
 * eligible RankIQ Top N. Ineligible early names are flagged — never silently skipped.
 */
export function extractTopNFromSourceOrder(input: {
  lines: ParsedRankLine[];
  eligible: EligibleParserEntry[];
  rankingDepth: number;
  universe?: EligibleParserEntry[];
  otherPositions?: EligibleParserEntry[];
  /** Source ranks admin confirmed should be skipped (ineligible/wrong-position). */
  confirmedExclusions?: Array<{ sourceRank: number; reason?: string }>;
}): TopNExtractResult {
  const exclusionByRank = new Map(
    (input.confirmedExclusions ?? []).map((item) => [
      item.sourceRank,
      item.reason ?? "Admin confirmed exclusion",
    ]),
  );
  const seenPlayers = new Map<string, number>();
  const seenRanks = new Map<number, number>();
  const rows: SourceExtractRow[] = [];
  let nextRankIq = 1;
  const blockingIssues: string[] = [];

  const ordered = [...input.lines].sort((a, b) => a.rank - b.rank);

  for (const line of ordered) {
    const classified = classifyName({
      rawName: line.rawName,
      eligible: input.eligible,
      universe: input.universe,
      otherPositions: input.otherPositions,
    });
    let issue = classified.issue;
    if (seenRanks.has(line.rank)) issue = issue ?? "duplicate_rank";
    else seenRanks.set(line.rank, 1);

    if (classified.matchedEntryId) {
      if (seenPlayers.has(classified.matchedEntryId)) {
        issue = issue ?? "duplicate_player";
      } else {
        seenPlayers.set(classified.matchedEntryId, line.rank);
      }
    }

    const excluded = exclusionByRank.has(line.rank);
    const exclusionReason = exclusionByRank.get(line.rank) ?? null;
    const stillNeedSlots = nextRankIq <= input.rankingDepth;
    const canSelect =
      !excluded &&
      !issue &&
      Boolean(classified.matchedEntryId) &&
      stillNeedSlots;

    const selected = canSelect;
    const extra =
      !excluded &&
      !issue &&
      Boolean(classified.matchedEntryId) &&
      !stillNeedSlots;

    if (!excluded && issue && stillNeedSlots) {
      if (issue === "unknown") {
        blockingIssues.push(
          `Source rank ${line.rank}: unknown player "${line.rawName}"`,
        );
      } else if (issue === "ambiguous") {
        blockingIssues.push(
          `Source rank ${line.rank}: ambiguous name "${line.rawName}" — never silently guessed`,
        );
      } else if (issue === "ineligible" || issue === "wrong_position") {
        blockingIssues.push(
          `Source rank ${line.rank}: "${line.rawName}" is not eligible for this contest (${issue}). Confirm exclusion to continue extracting Top ${input.rankingDepth}.`,
        );
      } else if (issue === "duplicate_player" || issue === "duplicate_rank") {
        blockingIssues.push(
          `Source rank ${line.rank}: ${issue.replaceAll("_", " ")}`,
        );
      }
    }

    rows.push({
      sourceRank: line.rank,
      rawName: line.rawName,
      matchedEntryId: classified.matchedEntryId,
      matchedName: classified.matchedName,
      issue: excluded ? null : issue,
      candidates: classified.candidates,
      selected,
      rankIqRank: selected ? nextRankIq : null,
      excluded,
      exclusionReason,
      extra,
    });

    if (selected) nextRankIq += 1;
  }

  const selected = rows.filter((row) => row.selected);
  const rankedEntryIds: (string | null)[] = Array.from(
    { length: input.rankingDepth },
    () => null,
  );
  for (const row of selected) {
    if (row.rankIqRank && row.matchedEntryId) {
      rankedEntryIds[row.rankIqRank - 1] = row.matchedEntryId;
    }
  }

  if (selected.length < input.rankingDepth) {
    blockingIssues.push(
      `Only ${selected.length} of ${input.rankingDepth} RankIQ slots filled from eligible source order.`,
    );
  }

  const ready =
    blockingIssues.length === 0 &&
    selected.length === input.rankingDepth &&
    rankedEntryIds.every((id): id is string => Boolean(id));

  return { rows, selected, rankedEntryIds, ready, blockingIssues };
}

export function extractTopNFromPastedText(input: {
  text: string;
  eligible: EligibleParserEntry[];
  rankingDepth: number;
  universe?: EligibleParserEntry[];
  otherPositions?: EligibleParserEntry[];
  confirmedExclusions?: Array<{ sourceRank: number; reason?: string }>;
}) {
  return extractTopNFromSourceOrder({
    lines: parseRankingPaste(input.text),
    eligible: input.eligible,
    rankingDepth: input.rankingDepth,
    universe: input.universe,
    otherPositions: input.otherPositions,
    confirmedExclusions: input.confirmedExclusions,
  });
}
