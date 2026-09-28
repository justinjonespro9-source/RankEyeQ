import { describe, expect, it } from "vitest";
import {
  canAuthorWeeklyContent,
  validateWeeklyContentInput,
} from "@/lib/weekly-content";

const valid = { title: "Week 4 breakdown", url: "https://youtube.com/watch?v=1", type: "VIDEO" };

describe("validateWeeklyContentInput (URL safety)", () => {
  it("accepts http(s) links and normalizes position", () => {
    expect(validateWeeklyContentInput({ ...valid, position: "rb" })).toEqual({
      title: "Week 4 breakdown",
      url: "https://youtube.com/watch?v=1",
      type: "VIDEO",
      position: "RB",
    });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/file",
    "https://user:pass@example.com/",
    "https://localhost/",
    "https://exa mple.com/",
    'https://example.com/"onmouseover=',
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(() => validateWeeklyContentInput({ ...valid, url })).toThrow();
  });

  it("rejects bad titles, types and positions", () => {
    expect(() => validateWeeklyContentInput({ ...valid, title: "  " })).toThrow("Title is required.");
    expect(() => validateWeeklyContentInput({ ...valid, title: "x".repeat(121) })).toThrow("Title is too long.");
    expect(() => validateWeeklyContentInput({ ...valid, type: "SPAM" })).toThrow("Choose a content type.");
    expect(() => validateWeeklyContentInput({ ...valid, position: "K" })).toThrow("Unknown position.");
  });
});

describe("canAuthorWeeklyContent", () => {
  it.each([
    ["HUMAN", true, true],
    ["CREATOR", true, true],
    ["CREATOR", false, false],
    ["BENCHMARK", true, false],
    ["AI", true, false],
  ] as const)("%s linked=%s → %s", (profileType, hasLinkedUser, expected) => {
    expect(canAuthorWeeklyContent({ profileType, hasLinkedUser })).toBe(expected);
  });
});
