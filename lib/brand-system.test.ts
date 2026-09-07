import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("RankEyeQ brand system", () => {
  const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
  const button = readFileSync(
    join(process.cwd(), "components/ui/Button.tsx"),
    "utf8",
  );
  const wordmark = readFileSync(
    join(process.cwd(), "components/brand/BrandWordmark.tsx"),
    "utf8",
  );

  it("centralizes the navy / teal / off-white palette", () => {
    expect(globals).toContain("--accent: #19c7d4");
    expect(globals).toContain("--accent-ink: #0c7a84");
    expect(globals).toContain("--navy: #071b2e");
    expect(globals).toContain("--midnight: #0b2238");
    expect(globals).toContain("--background: #f7f9fa");
    expect(globals).toContain("--ink: #0a1c2d");
    expect(globals).toContain("--muted: #66798b");
    expect(globals).not.toContain("#0b6e4f");
  });

  it("keeps semantic danger distinct from brand teal", () => {
    expect(globals).toContain("--danger:");
    expect(globals).toContain("--success:");
    expect(button).toContain('danger:');
    expect(button).toContain("bg-accent text-ink");
  });

  it("uses geometric display + technical body fonts", () => {
    expect(layout).toContain("Space_Grotesk");
    expect(layout).toContain("IBM_Plex_Sans");
  });

  it("renders RankEye + monocle Q wordmark", () => {
    expect(wordmark).toContain("RankEye");
    expect(wordmark).toContain("BrandMark");
    expect(wordmark).toContain('variant === "dark"');
  });

  it("sizes the Q bowl to match capital letter height optically", () => {
    // SVG 40×44; bowl diameter 24.5 → ~1.53em SVG for ~0.85em bowl (~cap + overshoot).
    expect(wordmark).toContain("h-[1.53em]");
    expect(wordmark).toContain("w-[1.39em]");
    expect(wordmark).toContain("top-[0.5em]");
    // Standalone BrandMark default must stay independent of wordmark sizing.
    const mark = readFileSync(
      join(process.cwd(), "components/brand/BrandMark.tsx"),
      "utf8",
    );
    expect(mark).toContain('className = "h-7 w-7"');
    expect(mark).toContain('viewBox="0 0 40 44"');
    expect(mark).toContain('treatment = "standalone"');
    expect(mark).toContain("M26.8 26.2 L35.2 38.4");
  });

  it("joins the Q to RankEye as a letter, not a detached icon", () => {
    // ~30% tighter than prior gap-0.5 / gap-1, plus left nudge into viewBox pad.
    expect(wordmark).toContain("gap-[0.085em]");
    expect(wordmark).toContain("gap-[0.12em]");
    expect(wordmark).toContain("-ml-[0.1em]");
    expect(wordmark).toContain('treatment="letter"');
    const mark = readFileSync(
      join(process.cwd(), "components/brand/BrandMark.tsx"),
      "utf8",
    );
    // Wordmark-only shorter Q descender; standalone handle preserved.
    expect(mark).toContain("M26.8 26.2 L32.6 34.8");
    expect(mark).toContain("M26.8 26.2 L35.2 38.4");
  });
});
