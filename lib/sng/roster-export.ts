import { parsePlayerAliases } from "@/lib/nfl/player-aliases";

export const SNG_ROSTER_EXPORT_VERSION = "sng-sports-roster-v1";

type ExportableSeasonPlayer = {
  displayName: string;
  team: string;
  position: "QB" | "RB" | "WR" | "TE" | "DEF";
  nflStatus: string;
  activeOnNFLRoster: boolean;
  sourcePosition: string | null;
  sourceNflStatus: string | null;
  rankableEntry: {
    provider: string;
    externalId: string;
    type: "PLAYER" | "DEFENSE";
    name: string;
    adminNotes: string | null;
  };
};

const supportedPositions = new Set(["QB", "RB", "WR", "TE"]);
const supportedStatuses = new Set([
  "ACTIVE",
  "PRACTICE_SQUAD",
  "INJURED_RESERVE",
  "PUP",
  "SUSPENDED",
  "INACTIVE",
  "FREE_AGENT",
]);

function mapStatus(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "IR") return "INJURED_RESERVE";
  if (normalized === "PS") return "PRACTICE_SQUAD";
  return supportedStatuses.has(normalized) ? normalized : "OTHER";
}

export function buildSngRosterExport(input: {
  seasonId: string;
  seasonYear: number;
  sourceSyncedAt: Date | null;
  exportedAt: Date;
  players: ExportableSeasonPlayer[];
}) {
  const rows = input.players
    .filter(
      (player) =>
        player.rankableEntry.type === "PLAYER" &&
        supportedPositions.has(player.position),
    )
    .map((player) => ({
      provider: player.rankableEntry.provider,
      externalId: player.rankableEntry.externalId,
      canonicalName: player.rankableEntry.name || player.displayName,
      aliases: parsePlayerAliases(player.rankableEntry.adminNotes),
      teamAbbreviation: player.team,
      fantasyPosition: player.position as "QB" | "RB" | "WR" | "TE",
      sourcePosition: player.sourcePosition ?? player.position,
      status: mapStatus(player.nflStatus),
      active: player.activeOnNFLRoster,
      sourceStatus: player.sourceNflStatus,
    }))
    .sort((a, b) =>
      a.teamAbbreviation.localeCompare(b.teamAbbreviation) ||
      a.fantasyPosition.localeCompare(b.fantasyPosition) ||
      a.canonicalName.localeCompare(b.canonicalName),
    );

  const externalKeys = rows.map((row) => `${row.provider}:${row.externalId}`);
  const duplicateExternalKeys = [...new Set(externalKeys.filter((key, index) => externalKeys.indexOf(key) !== index))];
  if (duplicateExternalKeys.length > 0) {
    throw new Error(`Duplicate provider identities in export: ${duplicateExternalKeys.join(", ")}`);
  }

  return {
    contractVersion: SNG_ROSTER_EXPORT_VERSION,
    league: "NFL" as const,
    year: input.seasonYear,
    sourceLabel: "RankEyeQ canonical NFL 2026 season roster export",
    sourceReference: `rankeyeq://season/${input.seasonId}`,
    sourceSyncedAt: input.sourceSyncedAt?.toISOString() ?? null,
    exportedAt: input.exportedAt.toISOString(),
    rows,
  };
}
