import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeeklyContentLinks } from "@/components/profile/WeeklyContentLinks";

describe("WeeklyContentLinks", () => {
  it("renders safe links and drops unsafe stored URLs", () => {
    const html = renderToStaticMarkup(
      createElement(WeeklyContentLinks, {
        profileId: "p1",
        items: [
          { id: "a", title: "Breakdown", url: "https://youtube.com/watch?v=1", type: "VIDEO", position: "RB" },
          { id: "b", title: "Evil", url: "javascript:alert(1)", type: "OTHER", position: null },
        ],
      }),
    );
    expect(html).toContain('href="https://youtube.com/watch?v=1"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Evil");
  });

  it("renders nothing when no link is safe", () => {
    const html = renderToStaticMarkup(
      createElement(WeeklyContentLinks, {
        profileId: "p1",
        items: [{ id: "b", title: "Evil", url: "javascript:alert(1)", type: "OTHER", position: null }],
      }),
    );
    expect(html).toBe("");
  });
});
