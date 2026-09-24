import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_DEVELOPER_LINKS,
  ADMIN_PRESERVED_ROUTES,
  ADMIN_PRIMARY_LINKS,
  COMMAND_CENTER_SECONDARY,
  SCORING_SECONDARY,
  WEEKLY_OPS_SECONDARY,
  adminPrimaryLabels,
  isAdminCapabilityReachable,
  resolveAdminNav,
} from "@/lib/admin/admin-nav";

describe("admin IA navigation config", () => {
  it("primary nav contains only intended top-level destinations", () => {
    expect(adminPrimaryLabels()).toEqual([
      "Command Center",
      "Weekly Ops",
      "Players",
      "Scoring",
      "Legal",
    ]);
    expect(ADMIN_PRIMARY_LINKS.map((l) => l.href)).toEqual([
      "/admin/command-center",
      "/admin",
      "/admin/players",
      "/admin/scoring",
      "/legal",
    ]);
  });

  it("Developer Tools lists Test Week and Test Preview only", () => {
    expect(ADMIN_DEVELOPER_LINKS.map((l) => l.label)).toEqual([
      "Test Week",
      "Test Preview",
    ]);
    expect(ADMIN_DEVELOPER_LINKS.map((l) => l.href)).not.toContain(
      "/admin/diagnostics",
    );
  });

  it("resolves Weekly Ops route-family active state", () => {
    expect(resolveAdminNav("/admin")).toMatchObject({
      family: "weekly-ops",
      primaryHref: "/admin",
      secondaryHref: null,
    });
    expect(resolveAdminNav("/admin/live-scoring")).toMatchObject({
      family: "weekly-ops",
      primaryHref: "/admin",
      secondaryHref: "/admin/live-scoring",
    });
    expect(resolveAdminNav("/admin/week-status?weekId=x")).toMatchObject({
      family: "weekly-ops",
      primaryHref: "/admin",
      secondaryHref: "/admin/week-status",
    });
    expect(resolveAdminNav("/admin/ops")).toMatchObject({
      family: "weekly-ops",
      primaryHref: "/admin",
      secondaryHref: "/admin/ops",
    });
    expect(resolveAdminNav("/admin/contests/abc")).toMatchObject({
      family: "weekly-ops",
      primaryHref: "/admin",
      secondaryHref: "/admin/contests",
    });
  });

  it("resolves Command Center route-family active state", () => {
    expect(resolveAdminNav("/admin/command-center")).toMatchObject({
      family: "command-center",
      primaryHref: "/admin/command-center",
    });
    expect(resolveAdminNav("/admin/experts")).toMatchObject({
      family: "command-center",
      primaryHref: "/admin/command-center",
      secondaryHref: "/admin/experts",
    });
    expect(resolveAdminNav("/admin/creators/verification")).toMatchObject({
      family: "command-center",
      primaryHref: "/admin/command-center",
      secondaryHref: "/admin/creators/verification",
    });
    expect(resolveAdminNav("/admin/competitors/live")).toMatchObject({
      family: "command-center",
      primaryHref: "/admin/command-center",
      secondaryHref: "/admin/competitors/live",
    });
  });

  it("resolves Scoring route-family active state", () => {
    expect(resolveAdminNav("/admin/scoring")).toMatchObject({
      family: "scoring",
      primaryHref: "/admin/scoring",
      secondaryHref: "/admin/scoring",
    });
    expect(resolveAdminNav("/admin/scoring-lab")).toMatchObject({
      family: "scoring",
      primaryHref: "/admin/scoring",
      secondaryHref: "/admin/scoring-lab",
    });
  });

  it("keeps existing specialized URLs reachable", () => {
    for (const href of ADMIN_PRESERVED_ROUTES) {
      expect(isAdminCapabilityReachable(href)).toBe(true);
    }
    const secondaryHrefs = [
      ...COMMAND_CENTER_SECONDARY,
      ...WEEKLY_OPS_SECONDARY,
      ...SCORING_SECONDARY,
    ].flatMap((g) => g.links.map((l) => l.href));
    for (const href of secondaryHrefs) {
      expect(isAdminCapabilityReachable(href)).toBe(true);
    }
    for (const href of ADMIN_DEVELOPER_LINKS.map((l) => l.href)) {
      expect(isAdminCapabilityReachable(href)).toBe(true);
    }
  });

  it("Weekly Ops secondary uses Availability + Ops Status labels", () => {
    const operate = WEEKLY_OPS_SECONDARY.find((g) => g.label === "Operate");
    expect(operate?.links.map((l) => l.label)).toEqual([
      "Live Scoring",
      "Availability",
      "Exceptions",
      "Diagnostics",
      "Ops Status",
    ]);
  });
});

describe("admin IA chrome identity (source)", () => {
  it("/admin identifies as Weekly Ops", () => {
    const source = readFileSync(
      join(process.cwd(), "app/admin/page.tsx"),
      "utf8",
    );
    expect(source).toContain('title="Weekly Ops"');
    expect(source).toContain("Weekly Ops · Admin");
    expect(source).not.toContain("Weekly command center");
  });

  it("/admin/ops identifies as Ops Status", () => {
    const source = readFileSync(
      join(process.cwd(), "app/admin/ops/page.tsx"),
      "utf8",
    );
    expect(source).toContain('title="Ops Status"');
    expect(source).toContain("Ops Status · Admin");
  });

  it("/admin/week-status identifies as Availability", () => {
    const source = readFileSync(
      join(process.cwd(), "app/admin/week-status/page.tsx"),
      "utf8",
    );
    expect(source).toContain('title="Player Availability"');
    expect(source).toContain("Availability · Admin");
  });

  it("AdminNav no longer ships the equal-weight 24-button cloud", () => {
    const source = readFileSync(
      join(process.cwd(), "components/admin/AdminNav.tsx"),
      "utf8",
    );
    expect(source).toContain("Developer Tools");
    expect(source).toContain("admin-developer-tools");
    expect(source).not.toContain('label: "Add Competitor"');
    expect(source).not.toContain('label: "Live Scoring"');
    expect(source).not.toContain('label: "Week Status"');
  });

  it("Command Center hub page exists with identity cards", () => {
    const source = readFileSync(
      join(process.cwd(), "app/admin/command-center/page.tsx"),
      "utf8",
    );
    expect(source).toContain("Command Center");
    expect(source).toContain("/admin/users");
    expect(source).toContain("/admin/competitors/live");
    expect(source).toContain("/admin/creators/entitlements");
  });
});
