import { describe, expect, it } from "vitest";
import {
  isPrimaryNavActive,
  LEADERBOARDS_SUBNAV,
  PRIMARY_NAV,
  RESULTS_SUBNAV,
  subnavHrefActive,
} from "@/lib/navigation";

describe("primary navigation", () => {
  it("exposes exactly the five core destinations", () => {
    expect(PRIMARY_NAV.map((link) => link.label)).toEqual([
      "Rank",
      "Consensus",
      "Results",
      "Leaderboards",
      "Players",
    ]);
  });

  it("does not include retired top-level destinations", () => {
    const labels = PRIMARY_NAV.map((link) => link.label);
    expect(labels).not.toContain("Receipts");
    expect(labels).not.toContain("Rankers");
    expect(labels).not.toContain("Following");
    expect(labels).not.toContain("Player Performance");
    expect(labels).not.toContain("Live Results");
  });

  it("highlights Results for nested result routes", () => {
    const results = PRIMARY_NAV.find((link) => link.label === "Results")!;
    expect(isPrimaryNavActive("/receipts", results)).toBe(true);
    expect(isPrimaryNavActive("/archive", results)).toBe(true);
    expect(isPrimaryNavActive("/leaderboards/live", results)).toBe(true);
    expect(isPrimaryNavActive("/results", results)).toBe(true);
  });

  it("highlights Leaderboards for rankers without live results", () => {
    const leaderboards = PRIMARY_NAV.find((link) => link.label === "Leaderboards")!;
    expect(isPrimaryNavActive("/rankers", leaderboards)).toBe(true);
    expect(isPrimaryNavActive("/leaderboards", leaderboards)).toBe(true);
    expect(isPrimaryNavActive("/leaderboards/live", leaderboards)).toBe(false);
  });
});

describe("results subnavigation", () => {
  it("includes This Week, Live, Receipts, and Archive", () => {
    expect(RESULTS_SUBNAV.map((link) => link.label)).toEqual([
      "This Week",
      "Live",
      "Receipts",
      "Archive",
    ]);
  });

  it("marks nested routes active", () => {
    expect(subnavHrefActive("/receipts", null, "/receipts")).toBe(true);
    expect(subnavHrefActive("/leaderboards/live", null, "/leaderboards/live")).toBe(
      true,
    );
    expect(subnavHrefActive("/archive", null, "/archive")).toBe(true);
  });
});

describe("leaderboards subnavigation", () => {
  it("owns Rankers as a secondary destination", () => {
    expect(LEADERBOARDS_SUBNAV.map((link) => link.label)).toContain("Rankers");
    expect(LEADERBOARDS_SUBNAV.find((link) => link.label === "Rankers")?.href).toBe(
      "/rankers",
    );
  });

  it("marks filter tabs active from query params", () => {
    const params = new URLSearchParams("filter=HUMAN");
    expect(subnavHrefActive("/leaderboards", params, "/leaderboards?filter=HUMAN")).toBe(
      true,
    );
    expect(subnavHrefActive("/leaderboards", params, "/leaderboards")).toBe(false);
  });
});
