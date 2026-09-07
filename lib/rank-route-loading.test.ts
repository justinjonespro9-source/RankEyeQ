import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("rank route loading safety", () => {
  it("normalizes position params and redirects non-canonical casing", () => {
    const page = readFileSync(
      join(process.cwd(), "app/rank/[position]/page.tsx"),
      "utf8",
    );
    expect(page).toContain("parsePositionParam");
    expect(page).toContain("rank.page_load_failed");
    expect(page).toContain("EmptyState");
    expect(page).not.toContain("redirect(`/rank/${position}");
  });

  it("ships segment error boundaries so failures are not endless loading UIs", () => {
    const rankError = readFileSync(
      join(process.cwd(), "app/rank/error.tsx"),
      "utf8",
    );
    const boardsError = readFileSync(
      join(process.cwd(), "app/leaderboards/error.tsx"),
      "utf8",
    );
    expect(rankError).toContain("Ranking board unavailable");
    expect(boardsError).toContain("Leaderboards unavailable");
    expect(rankError).toContain("Try again");
    expect(boardsError).toContain("Try again");
  });
});
