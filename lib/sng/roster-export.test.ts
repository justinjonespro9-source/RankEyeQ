import { describe, expect, it } from "vitest";
import { buildSngRosterExport, SNG_ROSTER_EXPORT_VERSION } from "./roster-export";

const player = (overrides: Record<string, unknown> = {}) => ({
  displayName: "Aaron Jones",
  team: "MIN",
  position: "RB" as const,
  nflStatus: "ACTIVE",
  activeOnNFLRoster: true,
  sourcePosition: "RB",
  sourceNflStatus: "ACT",
  rankableEntry: {
    provider: "nflcom-bootstrap",
    externalId: "aaron-jones",
    type: "PLAYER" as const,
    name: "Aaron Jones",
    adminNotes: "NFL.com roster\n@aliases:Aaron Jones Sr.|Aaron Jones, Sr.",
  },
  ...overrides,
});

describe("SNG roster export", () => {
  it("exports canonical identity, aliases, roster state, and provenance", () => {
    const result = buildSngRosterExport({
      seasonId: "season-2026",
      seasonYear: 2026,
      sourceSyncedAt: new Date("2026-09-01T00:00:00Z"),
      exportedAt: new Date("2026-09-19T00:00:00Z"),
      players: [player()],
    });

    expect(result.contractVersion).toBe(SNG_ROSTER_EXPORT_VERSION);
    expect(result.rows[0]).toMatchObject({
      canonicalName: "Aaron Jones",
      aliases: ["Aaron Jones Sr.", "Aaron Jones, Sr."],
      teamAbbreviation: "MIN",
      fantasyPosition: "RB",
      active: true,
    });
  });

  it("excludes defenses because SNG owns canonical D/ST identities", () => {
    const result = buildSngRosterExport({
      seasonId: "season-2026",
      seasonYear: 2026,
      sourceSyncedAt: null,
      exportedAt: new Date("2026-09-19T00:00:00Z"),
      players: [player({ position: "DEF", rankableEntry: { ...player().rankableEntry, type: "DEFENSE" } })],
    });
    expect(result.rows).toEqual([]);
  });

  it("rejects duplicate provider identities", () => {
    expect(() => buildSngRosterExport({
      seasonId: "season-2026",
      seasonYear: 2026,
      sourceSyncedAt: null,
      exportedAt: new Date("2026-09-19T00:00:00Z"),
      players: [player(), player({ team: "PHI" })],
    })).toThrow("Duplicate provider identities");
  });
});
