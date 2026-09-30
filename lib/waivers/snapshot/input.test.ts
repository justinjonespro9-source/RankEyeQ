import { describe, expect, it } from "vitest";
import {
  parseRosteredPercentToBps,
  parseWaiverInput,
  parseWaiverInputRow,
  parseWaiverObservedAt,
  splitWaiverColumns,
  waiverRawInputSha256,
  WAIVER_INPUT_MAX_CHARS,
  WAIVER_INPUT_MAX_ROWS,
} from "@/lib/waivers/snapshot/input";

describe("parseRosteredPercentToBps (exact, never rounds)", () => {
  it.each([
    ["0", 0],
    ["0.01", 1],
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["49.99", 4999],
    ["50", 5000],
    ["50.00", 5000],
    ["100", 10000],
    ["100.00", 10000],
    ["7%", 700],
    ["7.25 %", 725],
  ])("%s → %s bps", (raw, bps) => {
    expect(parseRosteredPercentToBps(raw)).toBe(bps);
  });

  it.each(["49.995", "41.234", "-1", "100.01", "101", "abc", "", "1e2", "12,5", ".5", "5.", " "])("rejects %j", (raw) => {
    expect(parseRosteredPercentToBps(raw)).toBeNull();
  });
});

describe("splitWaiverColumns", () => {
  it("keeps empty middle cells so optional columns never shift", () => {
    expect(splitWaiverColumns("Tank Bigsby | RB | JAX | 12 |  | FantasyPros | 2026-10-06 09:30")).toEqual([
      "Tank Bigsby",
      "RB",
      "JAX",
      "12",
      "",
      "FantasyPros",
      "2026-10-06 09:30",
    ]);
    expect(splitWaiverColumns("A\tWR\tSF\t3\t\tSrc")).toEqual(["A", "WR", "SF", "3", "", "Src"]);
    expect(splitWaiverColumns("A,WR,SF,3,,Src")).toEqual(["A", "WR", "SF", "3", "", "Src"]);
  });

  it("handles markdown pipes and quoted commas", () => {
    expect(splitWaiverColumns("| A | WR | SF | 3 |")).toEqual(["A", "WR", "SF", "3"]);
    expect(splitWaiverColumns('"Smith, Jr.",WR,SF,"3"')).toEqual(["Smith, Jr.", "WR", "SF", "3"]);
    expect(splitWaiverColumns('"He said ""hi""",WR,SF,3')).toEqual(['He said "hi"', "WR", "SF", "3"]);
  });
});

describe("parseWaiverObservedAt", () => {
  it("reads Chicago wall clock and zoned ISO", () => {
    expect(parseWaiverObservedAt("2026-10-06 09:30 CT")?.toISOString()).toBe("2026-10-06T14:30:00.000Z");
    expect(parseWaiverObservedAt("2026-10-06T09:30")?.toISOString()).toBe("2026-10-06T14:30:00.000Z");
    expect(parseWaiverObservedAt("2026-10-06T14:30:00Z")?.toISOString()).toBe("2026-10-06T14:30:00.000Z");
  });

  it.each(["5", "yesterday", "10/06/2026", "2026-10-06T14:30:00"])("rejects ambiguous %j", (raw) => {
    expect(parseWaiverObservedAt(raw)).toBeNull();
  });
});

describe("parseWaiverInputRow", () => {
  it("parses a full row and preserves the source line verbatim", () => {
    const row = parseWaiverInputRow(3, "Kenneth Walker III | rb | sea | 41.5 | re_1 | Sleeper | 2026-10-06 09:30");
    expect(row).toMatchObject({
      lineNumber: 3,
      line: "Kenneth Walker III | rb | sea | 41.5 | re_1 | Sleeper | 2026-10-06 09:30",
      playerName: "Kenneth Walker III",
      position: "RB",
      team: "SEA",
      rosteredBps: 4150,
      rankEyeQId: "re_1",
      sourceLabel: "Sleeper",
      issues: [],
    });
  });

  it("normalizes DST and legacy team codes; accepts source free agents as FA", () => {
    expect(parseWaiverInputRow(1, "Jaguars D/ST, DST, JAC, 3").position).toBe("DEF");
    expect(parseWaiverInputRow(1, "Jaguars D/ST, DST, JAC, 3").team).toBe("JAX");
    expect(parseWaiverInputRow(1, "Somebody, WR, FA, 3").team).toBe("FA");
  });

  it("flags every malformed column", () => {
    expect(parseWaiverInputRow(1, "A, WR, SF").issues).toContain("TOO_FEW_COLUMNS");
    expect(parseWaiverInputRow(1, "A, K, SF, 3").issues).toContain("INVALID_POSITION");
    expect(parseWaiverInputRow(1, "A, WR, XXX, 3").issues).toContain("INVALID_TEAM");
    expect(parseWaiverInputRow(1, "A, WR, SF, 49.995").issues).toContain("INVALID_PERCENT");
    expect(parseWaiverInputRow(1, ", WR, SF, 3").issues).toContain("MISSING_PLAYER");
    expect(parseWaiverInputRow(1, "A, WR, SF, 3, , , soon").issues).toContain("INVALID_OBSERVED_AT");
    expect(parseWaiverInputRow(1, "A, WR, SF, 3, , , , extra").issues).toContain("TOO_MANY_COLUMNS");
    expect(parseWaiverInputRow(1, "A, WR, SF, 3, , , , ").issues).toEqual([]);
  });
});

describe("parseWaiverInput", () => {
  it("skips header, blank and comment lines while keeping source line numbers", () => {
    const parsed = parseWaiverInput("Player|Pos|Team|Rostered%\n\n# QBs\nA|QB|SF|3\r\nB|WR|SEA|4");
    expect(parsed.error).toBeNull();
    expect(parsed.headerSkipped).toBe(true);
    expect(parsed.ignoredLines).toBe(2);
    expect(parsed.rows.map((row) => [row.lineNumber, row.playerName])).toEqual([
      [4, "A"],
      [5, "B"],
    ]);
  });

  it("reports empty, oversized and too-long pastes", () => {
    expect(parseWaiverInput("  \n# nothing\n").error).toBe("EMPTY");
    expect(parseWaiverInput("x".repeat(WAIVER_INPUT_MAX_CHARS + 1)).error).toBe("TOO_LARGE");
    const many = Array.from({ length: WAIVER_INPUT_MAX_ROWS + 1 }, (_, i) => `P${i}|WR|SF|1`).join("\n");
    expect(parseWaiverInput(many).error).toBe("TOO_MANY_ROWS");
  });

  it("hashes raw input with normalized line endings", () => {
    expect(waiverRawInputSha256("A|QB|SF|3\r\nB|WR|SEA|4")).toBe(waiverRawInputSha256("A|QB|SF|3\nB|WR|SEA|4"));
    expect(waiverRawInputSha256("A|QB|SF|3")).not.toBe(waiverRawInputSha256("A|QB|SF|4"));
  });
});
