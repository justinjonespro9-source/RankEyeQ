import { describe, expect, it } from "vitest";
import { WAIVER_AI_RESPONSE_MAX_BYTES } from "@/lib/waivers/ai/constants";
import { parseWaiverAiResponse, type WaiverAiFrozenRow } from "@/lib/waivers/ai/response-parser";
import type { WaiverPosition } from "@/lib/waivers/constants";

let seq = 0;
function row(displayName: string, position: string, team: string | null, eligible = true): WaiverAiFrozenRow {
  seq += 1;
  return { snapshotEntryId: `se${seq}`, rankableEntryId: `re-${displayName}-${team}`, position, displayName, team, eligible };
}

const ROWS: WaiverAiFrozenRow[] = [
  row("Bijan Robinson", "RB", "ATL"),
  row("Jaylen Warren", "RB", "PIT"),
  row("Kenneth Walker III", "RB", "SEA"),
  row("Chase Brown", "RB", "CIN"),
  row("Josh Jacobs", "RB", "GB"),
  row("Josh Jacobs", "RB", "NE"),
  row("Derrick Henry", "RB", "BAL", false),
  row("Puka Nacua", "WR", "LAR"),
  row("Tyler Lockett", "WR", "TEN"),
  row("TEN D/ST", "DEF", "TEN"),
  row("Baltimore Ravens D/ST", "DEF", "BAL"),
];

function parse(text: string, position: WaiverPosition = "RB", maxCalls = 3, rows = ROWS) {
  return parseWaiverAiResponse({ text, position, maxCalls, rows });
}

const names = (result: ReturnType<typeof parse>) => result.picks.map((pick) => `${pick.slot}:${pick.displayName}`);
const codes = (result: ReturnType<typeof parse>) => result.issues.map((issue) => issue.code);

describe("parseWaiverAiResponse — accepted formats", () => {
  it("numbered lists keep the exact stated order", () => {
    const result = parse("1. Chase Brown\n2) Bijan Robinson\n3: Jaylen Warren\n");
    expect(result.ok).toBe(true);
    expect(names(result)).toEqual(["1:Chase Brown", "2:Bijan Robinson", "3:Jaylen Warren"]);
    expect(result.parserVersion).toBe("WAIVEREYEQ_AI_PARSER_V1");
  });

  it("plain and bulleted lines take document order; fewer picks than allowed are fine", () => {
    expect(names(parse("Jaylen Warren\nChase Brown"))).toEqual(["1:Jaylen Warren", "2:Chase Brown"]);
    expect(names(parse("- Bijan Robinson"))).toEqual(["1:Bijan Robinson"]);
  });

  it("CSV, TSV and markdown tables with headers", () => {
    expect(names(parse("Rank,Player,Team\n1,Chase Brown,CIN\n2,Bijan Robinson,ATL"))).toEqual(["1:Chase Brown", "2:Bijan Robinson"]);
    expect(names(parse("1\tJaylen Warren\tPIT\n2\tChase Brown\tCIN"))).toEqual(["1:Jaylen Warren", "2:Chase Brown"]);
    expect(names(parse("| Rank | Player |\n|---|---|\n| 1 | Chase Brown |\n| 2 | Jaylen Warren |"))).toEqual(["1:Chase Brown", "2:Jaylen Warren"]);
  });

  it("code fences, CRLF and a copied prompt pool line", () => {
    const result = parse("```\r\n1. Chase Brown (CIN, opp. BAL) — rostered 12.50%\r\n2. Bijan Robinson\r\n```\r\n");
    expect(names(result)).toEqual(["1:Chase Brown", "2:Bijan Robinson"]);
  });

  it("suffix-aware exact names and team annotations", () => {
    expect(names(parse("1. kenneth walker iii"))).toEqual(["1:Kenneth Walker III"]);
    expect(codes(parse("1. Kenneth Walker"))).toEqual(["UNKNOWN_PLAYER"]);
    expect(names(parse("1. Aaron Jones Sr.", "RB", 3, [...ROWS, row("Aaron Jones", "RB", "MIN")]))).toEqual(["1:Aaron Jones"]);
    expect(names(parse("1. Josh Jacobs (GB)"))).toEqual(["1:Josh Jacobs"]);
    expect(parse("1. Josh Jacobs, NE").picks[0].team).toBe("NE");
  });

  it("DEF by display name, team abbreviation, full name or nickname", () => {
    for (const text of ["TEN D/ST", "TEN", "Tennessee Titans", "Titans", "Titans Defense"]) {
      expect(names(parse(`1. ${text}`, "DEF")), text).toEqual(["1:TEN D/ST"]);
    }
    expect(names(parse("1. Ravens D/ST\n2. Baltimore Ravens", "DEF"))).toEqual([]);
    expect(names(parse("1. Ravens D/ST\n2. TEN", "DEF"))).toEqual(["1:Baltimore Ravens D/ST", "2:TEN D/ST"]);
  });

  it("an explicit NO CALLS is a valid zero-pick response", () => {
    for (const text of ["NO CALLS", "No calls.", "**NO CALLS**", "\n  no calls\n"]) {
      const result = parse(text);
      expect(result, text).toMatchObject({ ok: true, noCalls: true, picks: [], issues: [] });
    }
  });
});

describe("parseWaiverAiResponse — the whole response is rejected, never repaired", () => {
  it("unknown, ineligible and wrong-position players", () => {
    expect(codes(parse("1. Chase Brown\n2. Saquon Barkley"))).toEqual(["UNKNOWN_PLAYER"]);
    expect(codes(parse("1. Derrick Henry"))).toEqual(["INELIGIBLE_PLAYER"]);
    expect(codes(parse("1. Puka Nacua"))).toEqual(["WRONG_POSITION"]);
    const result = parse("1. Chase Brown\n2. Saquon Barkley");
    expect(result).toMatchObject({ ok: false, noCalls: false, picks: [] });
  });

  it("ambiguous names need a team; a contradicting team is an error, not a substitution", () => {
    expect(codes(parse("1. Josh Jacobs"))).toEqual(["AMBIGUOUS_PLAYER"]);
    expect(codes(parse("1. Chase Brown (ATL)"))).toEqual(["TEAM_MISMATCH"]);
  });

  it("duplicate players and slots, missing slots, order and mixed numbering", () => {
    expect(codes(parse("1. Chase Brown\n2. Chase Brown"))).toEqual(["DUPLICATE_PLAYER"]);
    expect(codes(parse("1. Chase Brown\n1. Jaylen Warren"))).toEqual(["DUPLICATE_SLOT", "DUPLICATE_SLOT"]);
    expect(codes(parse("1. Chase Brown\n3. Jaylen Warren"))).toEqual(["MISSING_SLOT"]);
    expect(codes(parse("2. Chase Brown\n1. Jaylen Warren"))).toEqual(["OUT_OF_ORDER"]);
    expect(codes(parse("1. Chase Brown\nJaylen Warren"))).toEqual(["MIXED_NUMBERING"]);
  });

  it("more picks than allowed are rejected, never truncated", () => {
    const result = parse("1. Chase Brown\n2. Jaylen Warren\n3. Bijan Robinson\n4. Kenneth Walker III");
    expect(codes(result)).toEqual(["TOO_MANY_CALLS"]);
    expect(result.picks).toEqual([]);
    const small = [row("Only Back", "RB", "KC"), row("Other Back", "RB", "LV")];
    const capped = parse("1. Only Back\n2. Other Back\n3. Only Back", "RB", 3, small);
    expect(capped.availableSlots).toBe(2);
    expect(codes(capped)).toContain("TOO_MANY_CALLS");
  });

  it("commentary and stray lines are errors, never skipped", () => {
    expect(parse("Here are my picks:\n1. Chase Brown").ok).toBe(false);
    expect(parse("1. Chase Brown\nGood luck!").ok).toBe(false);
    expect(codes(parse("1,Chase Brown,Jaylen Warren"))).toEqual(["UNPARSEABLE_LINE"]);
    expect(codes(parse("1. 12345"))).toEqual(["UNPARSEABLE_LINE"]);
  });

  it("NO CALLS mixed with picks, repeated, or an empty response", () => {
    expect(codes(parse("NO CALLS\n1. Chase Brown"))).toEqual(["NO_CALLS_MIXED"]);
    expect(codes(parse("NO CALLS\nNO CALLS"))).toEqual(["NO_CALLS_MIXED"]);
    expect(codes(parse(""))).toEqual(["EMPTY"]);
    expect(codes(parse("  \n```\n```"))).toEqual(["EMPTY"]);
  });

  it("unstorable or oversized text", () => {
    expect(codes(parse("1. Chase Brown\u0000"))).toEqual(["INVALID_TEXT"]);
    expect(codes(parse("1. Chase Brown\uD800"))).toEqual(["INVALID_TEXT"]);
    expect(codes(parse(`1. Chase Brown\n${"x".repeat(WAIVER_AI_RESPONSE_MAX_BYTES)}`))).toEqual(["TOO_LONG"]);
  });

  it("reports every problem with its line, and previews each line", () => {
    const result = parse("1. Chase Brown\n2. Saquon Barkley\n3. Derrick Henry");
    expect(result.issues.map((issue) => [issue.code, issue.lineNumber])).toEqual([
      ["UNKNOWN_PLAYER", 2],
      ["INELIGIBLE_PLAYER", 3],
    ]);
    expect(result.lines.map((line) => [line.kind, line.slot, line.match?.displayName ?? null])).toEqual([
      ["PICK", 1, "Chase Brown"],
      ["PICK", 2, null],
      ["PICK", 3, null],
    ]);
  });
});
