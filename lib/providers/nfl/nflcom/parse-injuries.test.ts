import { describe, expect, it } from "vitest";
import { WEEK1_NFL_INJURIES_FIXTURE_HTML } from "@/lib/providers/nfl/nflcom/injuries.fixture";
import {
  mapGameStatusToAvailability,
  nextAvailabilityFromInjuryRow,
  parseNflComInjuriesHtml,
  teamAbbrFromInjuryLabel,
} from "@/lib/providers/nfl/nflcom/parse-injuries";
import { partitionAiPromptPlayers, buildAiRankingPrompt } from "@/lib/admin/ai-prompt";
import {
  canNewlySelectPlayer,
  isSelectableAvailability,
} from "@/lib/eligibility/weekly-status";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { normalizePlayerName } from "@/lib/nfl/player-identity";

describe("NFL.com injury report parser", () => {
  it("maps Game Status designations", () => {
    expect(mapGameStatusToAvailability("Out")).toBe("OUT");
    expect(mapGameStatusToAvailability("Doubtful")).toBe("DOUBTFUL");
    expect(mapGameStatusToAvailability("Questionable")).toBe("QUESTIONABLE");
    expect(mapGameStatusToAvailability("")).toBeNull();
    expect(mapGameStatusToAvailability("  ")).toBeNull();
  });

  it("resolves team nicknames to abbreviations", () => {
    expect(teamAbbrFromInjuryLabel("Raiders")).toBe("LV");
    expect(teamAbbrFromInjuryLabel("Bears")).toBe("CHI");
    expect(teamAbbrFromInjuryLabel("Buccaneers")).toBe("TB");
    expect(teamAbbrFromInjuryLabel("49ers")).toBe("SF");
  });

  it("parses Week 1 fixture including Bowers / McMillan / Odunze", () => {
    const rows = parseNflComInjuriesHtml(WEEK1_NFL_INJURIES_FIXTURE_HTML);
    const byName = new Map(rows.map((row) => [row.name, row]));

    expect(byName.get("Brock Bowers")).toMatchObject({
      team: "LV",
      position: "TE",
      gameStatus: "OUT",
      externalId: "brock-bowers",
    });
    expect(byName.get("Jalen McMillan")).toMatchObject({
      team: "TB",
      position: "WR",
      gameStatus: "DOUBTFUL",
    });
    expect(byName.get("Rome Odunze")).toMatchObject({
      team: "CHI",
      position: "WR",
      gameStatus: "QUESTIONABLE",
    });
    expect(byName.get("Ashton Jeanty")?.gameStatus).toBeNull();
    // Unknown team label skipped
    expect(byName.has("Mystery Man")).toBe(false);
  });

  it("throws on unrecognized HTML so callers do not mass-reset", () => {
    expect(() =>
      parseNflComInjuriesHtml(
        `<html><body>${"x".repeat(250)} no injury tables here</body></html>`,
      ),
    ).toThrow(/not recognized|zero player/i);
  });

  it("blank game status preserves IR/PUP and otherwise ACTIVE", () => {
    expect(
      nextAvailabilityFromInjuryRow({ gameStatus: null, current: "IR" }),
    ).toBe("IR");
    expect(
      nextAvailabilityFromInjuryRow({ gameStatus: null, current: "PUP" }),
    ).toBe("PUP");
    expect(
      nextAvailabilityFromInjuryRow({
        gameStatus: null,
        current: "QUESTIONABLE",
      }),
    ).toBe("ACTIVE");
    expect(
      nextAvailabilityFromInjuryRow({ gameStatus: "OUT", current: "ACTIVE" }),
    ).toBe("OUT");
  });

  it("normalizes Jr/Sr punctuation for matching keys", () => {
    expect(normalizePlayerName("Marvin Mims Jr.")).toBe("marvin mims jr");
    expect(normalizePlayerName("Ja'Marr Chase")).toBe("jamarr chase");
  });
});

describe("Week 1 injury status → human + AI behavior", () => {
  const now = zonedLocalToUtc(2026, 9, 12, 9, 0);
  const sundayKickoff = zonedLocalToUtc(2026, 9, 13, 15, 25);

  it("Bowers OUT not newly addable; Q/D selectable", () => {
    expect(isSelectableAvailability("OUT")).toBe(false);
    expect(isSelectableAvailability("DOUBTFUL")).toBe(true);
    expect(isSelectableAvailability("QUESTIONABLE")).toBe(true);
    expect(
      canNewlySelectPlayer({
        availability: "OUT",
        kickoffAt: sundayKickoff,
        now,
      }),
    ).toBe(false);
  });

  it("AI prompt lists Bowers unavailable and marks Q/D in eligible pool", () => {
    const players = [
      {
        name: "Brock Bowers",
        team: "LV",
        opponent: "vs DEN",
        gameStartsAt: sundayKickoff,
        availability: "OUT" as const,
      },
      {
        name: "Jalen McMillan",
        team: "TB",
        opponent: "@ CIN",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        availability: "DOUBTFUL" as const,
      },
      {
        name: "Rome Odunze",
        team: "CHI",
        opponent: "@ CAR",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        availability: "QUESTIONABLE" as const,
      },
      {
        name: "Trey McBride",
        team: "ARI",
        opponent: "@ LAC",
        gameStartsAt: sundayKickoff,
        availability: "ACTIVE" as const,
      },
    ];
    const { eligible, unavailable } = partitionAiPromptPlayers(players, now);
    expect(unavailable.some((p) => p.name === "Brock Bowers")).toBe(true);
    expect(eligible.some((p) => p.name === "Brock Bowers")).toBe(false);
    expect(eligible.some((p) => p.name === "Jalen McMillan")).toBe(true);
    expect(eligible.some((p) => p.name === "Rome Odunze")).toBe(true);

    const prompt = buildAiRankingPrompt(
      {
        title: "TE/WR",
        seasonYear: 2026,
        sport: "NFL",
        weekLabel: "Week 1",
        weekNumber: 1,
        position: "WR",
        rankingDepth: 15,
        rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
        fullLockAt: new Date("2026-09-13T15:00:00.000Z"),
        players,
      },
      { now, generatedAt: now },
    );
    expect(prompt).toContain("UNAVAILABLE — DO NOT SELECT");
    expect(prompt).toContain("Brock Bowers");
    expect(prompt).toContain("Doubtful");
    expect(prompt).toContain("Questionable");
  });
});
