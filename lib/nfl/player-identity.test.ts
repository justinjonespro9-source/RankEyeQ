import { describe, expect, it } from "vitest";
import {
  normalizePlayerName,
  parsePlayerNameIdentity,
  playerIdentityGroupKey,
  playerNamesCanMerge,
  resolvePlayerMatchFromCandidates,
} from "@/lib/nfl/player-identity";
import type { RankableEntry } from "@/lib/generated/prisma/client";

function entry(partial: Partial<RankableEntry> & Pick<RankableEntry, "id" | "name" | "team" | "position" | "provider" | "externalId">): RankableEntry {
  return {
    type: "PLAYER",
    shortName: partial.name.split(" ").pop() ?? partial.name,
    opponent: "TBD",
    headshotUrl: null,
    gameStartsAt: null,
    gameId: null,
    availability: "ACTIVE",
    active: true,
    adminNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe("player identity normalization", () => {
  it("matches AJ Brown and A.J. Brown", () => {
    expect(playerNamesCanMerge("AJ Brown", "A.J. Brown")).toBe(true);
    expect(normalizePlayerName("A.J. Brown")).toBe("aj brown");
  });

  it("matches suffix punctuation variants for Brian Robinson Jr.", () => {
    expect(
      playerNamesCanMerge("Brian Robinson Jr.", "Brian Robinson, Jr."),
    ).toBe(true);
    expect(parsePlayerNameIdentity("Brian Robinson, Jr.").suffixKey).toBe("jr");
  });

  it("does not merge Brian Robinson with Brian Robinson Jr. without aliases", () => {
    expect(playerNamesCanMerge("Brian Robinson", "Brian Robinson Jr.")).toBe(
      false,
    );
    expect(
      playerIdentityGroupKey("Brian Robinson", "RB"),
    ).not.toBe(playerIdentityGroupKey("Brian Robinson Jr.", "RB"));
  });

  it("allows Aaron Jones vs Aaron Jones Sr.", () => {
    expect(playerNamesCanMerge("Aaron Jones", "Aaron Jones Sr.")).toBe(true);
  });
});

describe("resolvePlayerMatchFromCandidates", () => {
  it("prefers nflcom-bootstrap over legacy mock on team change", () => {
    const nflcom = entry({
      id: "nflcom-1",
      name: "A.J. Brown",
      team: "NE",
      position: "WR",
      provider: "nflcom-bootstrap",
      externalId: "a-j-brown",
    });
    const mock = entry({
      id: "mock-1",
      name: "A.J. Brown",
      team: "PHI",
      position: "WR",
      provider: "mock",
      externalId: "mock-wr-5",
    });

    const result = resolvePlayerMatchFromCandidates([mock, nflcom], {
      externalId: "a-j-brown",
      name: "A.J. Brown",
      team: "NE",
      fantasyPosition: "WR",
    });

    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.entry.id).toBe("nflcom-1");
    }
  });

  it("flags ambiguous when multiple active nflcom identities share a name", () => {
    const a = entry({
      id: "a",
      name: "Chris Jones",
      team: "KC",
      position: "WR",
      provider: "nflcom-bootstrap",
      externalId: "chris-jones-1",
    });
    const b = entry({
      id: "b",
      name: "Chris Jones",
      team: "DAL",
      position: "WR",
      provider: "nflcom-bootstrap",
      externalId: "chris-jones-2",
      active: true,
    });

    const result = resolvePlayerMatchFromCandidates([a, b], {
      externalId: "chris-jones-3",
      name: "Chris Jones",
      team: "ARI",
      fantasyPosition: "WR",
    });

    expect(result.kind).toBe("ambiguous");
  });
});
