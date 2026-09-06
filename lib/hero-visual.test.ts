import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("homepage hero product visual", () => {
  it("keeps RankEyeQ copy and primary CTA", () => {
    const hero = readFileSync(
      join(process.cwd(), "components/home/Hero.tsx"),
      "utf8",
    );
    expect(hero).toContain("How good is your eye for fantasy talent?");
    expect(hero).toContain("Rank This Week");
    expect(hero).toContain('href="/rank"');
    expect(hero).toContain("HeroProductVisual");
  });

  it("uses a decorative static product mockup (not live Week 1 data)", () => {
    const visual = readFileSync(
      join(process.cwd(), "components/home/HeroProductVisual.tsx"),
      "utf8",
    );
    expect(visual).toContain("aria-hidden");
    expect(visual).toContain("Demo product UI");
    expect(visual).toContain("RB Top 10");
    expect(visual).toMatch(/Rank|Reveal|Prove/);
    expect(visual).not.toContain("getHomepageData");
    expect(visual).not.toContain("prisma");
  });

  it("simplifies supporting panels below desktop", () => {
    const visual = readFileSync(
      join(process.cwd(), "components/home/HeroProductVisual.tsx"),
      "utf8",
    );
    // Consensus + Leaderboard use lg:block so mobile/tablet show ranking only.
    expect(visual).toContain("hidden w-[58%]");
    expect(visual).toContain("lg:block");
    expect(visual).toContain("RankingBoardCard");
  });
});
