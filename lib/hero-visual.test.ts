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
    expect(hero).toContain("BrandWordmark");
    expect(hero).toContain("brand-navy-surface");
  });

  it("uses device mockups with static demo data (not live contests)", () => {
    const visual = readFileSync(
      join(process.cwd(), "components/home/HeroProductVisual.tsx"),
      "utf8",
    );
    const phone = readFileSync(
      join(process.cwd(), "components/home/HeroPhoneRankScreen.tsx"),
      "utf8",
    );
    const laptop = readFileSync(
      join(process.cwd(), "components/home/HeroLaptopConsensusScreen.tsx"),
      "utf8",
    );
    const demo = readFileSync(
      join(process.cwd(), "components/home/hero-demo-data.ts"),
      "utf8",
    );

    expect(visual).toContain("aria-hidden");
    expect(visual).toContain("Example product view");
    expect(visual).toContain("HeroPhoneRankScreen");
    expect(visual).toContain("HeroLaptopConsensusScreen");
    expect(visual).toContain("hidden");
    expect(visual).toContain("md:block");

    expect(phone).toContain("Your RB Top 10");
    expect(phone).toContain("Player pool");
    expect(phone).toContain("Podium picks");

    expect(laptop).toContain("Community EYEQ");
    expect(laptop).toContain("Selected %");
    expect(laptop).toContain("Humans");
    expect(laptop).toContain("Experts");
    expect(laptop).toContain("Creators");
    expect(laptop).toContain("AI");

    expect(demo).toContain("Bijan Robinson");
    expect(demo).not.toContain("prisma");
    expect(visual).not.toContain("getHomepageData");
    expect(visual).not.toContain("prisma");
  });

  it("hides the laptop consensus mock below tablet", () => {
    const visual = readFileSync(
      join(process.cwd(), "components/home/HeroProductVisual.tsx"),
      "utf8",
    );
    expect(visual).toMatch(/hidden[\s\S]*md:block/);
    expect(visual).toContain("PhoneFrame");
    expect(visual).toContain("LaptopFrame");
  });
});
