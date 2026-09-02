import type {
  ProviderWeekResults,
  WeeklyEligibleBundle,
} from "@/lib/providers/nfl/types";
import { findDuplicateExternalIds } from "@/lib/nfl/import";

export type ImportValidationIssue = {
  code: string;
  message: string;
  blocking: boolean;
};

export type ImportValidationResult = {
  ok: boolean;
  issues: ImportValidationIssue[];
};

function issue(
  code: string,
  message: string,
  blocking = true,
): ImportValidationIssue {
  return { code, message, blocking };
}

export function validateWeeklyImportBundle(
  bundle: WeeklyEligibleBundle,
  expected: { seasonYear: number; weekNumber: number },
): ImportValidationResult {
  const issues: ImportValidationIssue[] = [];

  if (bundle.seasonYear !== expected.seasonYear) {
    issues.push(
      issue(
        "season_mismatch",
        `Provider season ${bundle.seasonYear} does not match selected ${expected.seasonYear}`,
      ),
    );
  }
  if (bundle.weekNumber !== expected.weekNumber) {
    issues.push(
      issue(
        "week_mismatch",
        `Provider week ${bundle.weekNumber} does not match selected ${expected.weekNumber}`,
      ),
    );
  }

  if (bundle.games.length === 0) {
    issues.push(issue("empty_schedule", "Provider returned no games for this week"));
  }
  if (bundle.players.length === 0) {
    issues.push(issue("empty_players", "Provider returned no offensive players"));
  }
  if (bundle.defenses.length === 0) {
    issues.push(issue("empty_defenses", "Provider returned no D/ST rows"));
  }

  const duplicateIds = findDuplicateExternalIds([
    ...bundle.games.map((row) => row.externalId),
    ...bundle.players.map((row) => row.externalId),
    ...bundle.defenses.map((row) => row.externalId),
  ]);
  if (duplicateIds.length > 0) {
    issues.push(
      issue(
        "duplicate_provider_ids",
        `Duplicate provider IDs: ${duplicateIds.slice(0, 8).join(", ")}`,
      ),
    );
  }

  for (const game of bundle.games) {
    if (!game.homeTeam?.trim() || !game.awayTeam?.trim()) {
      issues.push(
        issue("missing_team", `Game ${game.externalId} is missing home/away team`),
      );
    }
    if (!(game.startsAt instanceof Date) || Number.isNaN(game.startsAt.getTime())) {
      issues.push(
        issue("malformed_kickoff", `Game ${game.externalId} has an invalid kickoff time`),
      );
    }
    if (game.weekNumber !== expected.weekNumber || game.seasonYear !== expected.seasonYear) {
      issues.push(
        issue(
          "game_outside_week",
          `Game ${game.externalId} is week ${game.weekNumber}/${game.seasonYear}, expected ${expected.weekNumber}/${expected.seasonYear}`,
        ),
      );
    }
  }

  const gameIds = new Set(bundle.games.map((game) => game.externalId));
  for (const player of bundle.players) {
    if (!player.team?.trim() || !player.opponent?.trim()) {
      issues.push(
        issue(
          "missing_opponent",
          `Player ${player.externalId} is missing team/opponent`,
        ),
      );
    }
    if (!player.gameExternalId || !gameIds.has(player.gameExternalId)) {
      issues.push(
        issue(
          "missing_player_mapping",
          `Player ${player.externalId} is not mapped to a week game`,
        ),
      );
    }
    if (!(player.gameStartsAt instanceof Date) || Number.isNaN(player.gameStartsAt.getTime())) {
      issues.push(
        issue(
          "malformed_kickoff",
          `Player ${player.externalId} has an invalid kickoff time`,
        ),
      );
    }
  }

  for (const defense of bundle.defenses) {
    if (!defense.team?.trim() || !defense.opponent?.trim()) {
      issues.push(
        issue("def_gap", `D/ST ${defense.externalId} is missing team/opponent`),
      );
    }
    if (!defense.gameExternalId || !gameIds.has(defense.gameExternalId)) {
      issues.push(
        issue("def_gap", `D/ST ${defense.externalId} is not mapped to a week game`),
      );
    }
  }

  const teamsWithGames = new Set(
    bundle.games.flatMap((game) => [game.homeTeam, game.awayTeam]),
  );
  for (const team of teamsWithGames) {
    const hasDef = bundle.defenses.some((row) => row.team === team);
    if (!hasDef) {
      issues.push(
        issue("def_gap", `No D/ST row for team ${team}`, false),
      );
    }
  }

  return {
    ok: !issues.some((item) => item.blocking),
    issues,
  };
}

export function validateProviderWeekResults(
  results: ProviderWeekResults,
  options?: { requireFinal?: boolean },
): ImportValidationResult {
  const issues: ImportValidationIssue[] = [];
  if (results.playerStats.length === 0 && results.defenseStats.length === 0) {
    issues.push(issue("empty_stats", "Provider returned no player or D/ST stats"));
  }
  if (results.defenseStats.length === 0) {
    issues.push(issue("def_gap", "Provider returned no D/ST stats"));
  }

  for (const game of results.games) {
    if (options?.requireFinal && game.status !== "FINAL") {
      issues.push(
        issue(
          "game_not_final",
          `Game ${game.externalId} status is ${game.status}, not FINAL`,
        ),
      );
    }
  }

  for (const row of results.playerStats) {
    const game = results.games.find((item) => item.externalId === row.gameExternalId);
    if (row.isGameFinal && game && game.status !== "FINAL") {
      issues.push(
        issue(
          "provisional_marked_final",
          `Player ${row.externalPlayerId} marked final but game ${row.gameExternalId} is ${game.status}`,
        ),
      );
    }
    if (!row.isGameFinal && game?.status === "FINAL" && options?.requireFinal) {
      issues.push(
        issue(
          "partial_final_mismatch",
          `Player ${row.externalPlayerId} still provisional while game is FINAL`,
          false,
        ),
      );
    }
  }

  return {
    ok: !issues.some((item) => item.blocking),
    issues,
  };
}

export class ImportValidationError extends Error {
  issues: ImportValidationIssue[];
  constructor(issues: ImportValidationIssue[]) {
    super(issues.map((item) => item.message).join("; "));
    this.name = "ImportValidationError";
    this.issues = issues;
  }
}
