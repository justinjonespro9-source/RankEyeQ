import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeeklySourceLink } from "@/components/profile/WeeklySourceLink";

const render = (sourceUrl: string) =>
  renderToStaticMarkup(createElement(WeeklySourceLink, { profileId: "p1", sourceUrl }));

describe("WeeklySourceLink URL safety", () => {
  it("10: keeps valid http(s) source links clickable", () => {
    const html = render("https://example.com/rankings/week-3?pos=qb");
    expect(html).toContain('href="https://example.com/rankings/week-3?pos=qb"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(render("http://example.com/r")).toContain('href="http://example.com/r"');
  });

  it("11: suppresses unsafe or malformed URLs instead of rendering a link", () => {
    for (const unsafe of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "not a url",
      "//evil.example.com",
      "",
    ]) {
      const html = render(unsafe);
      expect(html).toBe("");
      expect(html).not.toContain("href");
    }
  });
});
