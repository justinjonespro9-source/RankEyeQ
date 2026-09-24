/**
 * Admin information architecture — primary destinations + contextual secondary nav.
 * Presentation/navigation only; does not gate authorization.
 */

export type AdminNavLink = {
  href: string;
  label: string;
};

export type AdminNavGroup = {
  label: string;
  links: readonly AdminNavLink[];
};

export type AdminNavFamily =
  | "command-center"
  | "weekly-ops"
  | "players"
  | "scoring"
  | "legal"
  | "developer";

export const ADMIN_PRIMARY_LINKS = [
  { href: "/admin/command-center", label: "Command Center" },
  { href: "/admin", label: "Weekly Ops" },
  { href: "/admin/players", label: "Players" },
  { href: "/admin/scoring", label: "Scoring" },
  { href: "/legal", label: "Legal" },
] as const satisfies readonly AdminNavLink[];

export const ADMIN_DEVELOPER_LINKS = [
  { href: "/admin/test-week", label: "Test Week" },
  { href: "/admin/preview", label: "Test Preview" },
] as const satisfies readonly AdminNavLink[];

export const COMMAND_CENTER_SECONDARY: readonly AdminNavGroup[] = [
  {
    label: "People / Identities",
    links: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/experts", label: "Experts" },
      { href: "/admin/creators", label: "Creators" },
      { href: "/admin/creators/verification", label: "Creator Verify" },
    ],
  },
  {
    label: "Sources / Boards",
    links: [
      { href: "/admin/benchmarks", label: "Benchmarks" },
      { href: "/admin/ai", label: "AI" },
    ],
  },
  {
    label: "Competitors",
    links: [
      { href: "/admin/competitors/new", label: "Add Competitor" },
      { href: "/admin/competitors/live", label: "Competitor Live" },
    ],
  },
];

export const WEEKLY_OPS_SECONDARY: readonly AdminNavGroup[] = [
  {
    label: "Setup",
    links: [
      { href: "/admin/seasons", label: "Seasons & Weeks" },
      { href: "/admin/data", label: "NFL Data" },
      { href: "/admin/weekly-pools", label: "Weekly Pools" },
      { href: "/admin/contests", label: "Contests" },
    ],
  },
  {
    label: "Operate",
    links: [
      { href: "/admin/live-scoring", label: "Live Scoring" },
      { href: "/admin/week-status", label: "Availability" },
      { href: "/admin/weekly-exceptions", label: "Exceptions" },
      { href: "/admin/diagnostics", label: "Diagnostics" },
      { href: "/admin/ops", label: "Ops Status" },
    ],
  },
];

export const SCORING_SECONDARY: readonly AdminNavGroup[] = [
  {
    label: "Scoring",
    links: [
      { href: "/admin/scoring", label: "Scoring Versions" },
      { href: "/admin/scoring-lab", label: "Scoring Lab" },
    ],
  },
];

/** Every specialized admin route that must remain reachable via IA. */
export const ADMIN_PRESERVED_ROUTES = [
  "/admin",
  "/admin/command-center",
  "/admin/ops",
  "/admin/live-scoring",
  "/admin/week-status",
  "/admin/weekly-pools",
  "/admin/weekly-exceptions",
  "/admin/seasons",
  "/admin/data",
  "/admin/contests",
  "/admin/players",
  "/admin/ai",
  "/admin/creators",
  "/admin/creators/verification",
  "/admin/creators/entitlements",
  "/admin/experts",
  "/admin/benchmarks",
  "/admin/competitors/new",
  "/admin/competitors/live",
  "/admin/users",
  "/admin/scoring",
  "/admin/scoring-lab",
  "/admin/test-week",
  "/admin/preview",
  "/admin/diagnostics",
  "/legal",
] as const;

const COMMAND_CENTER_PREFIXES = [
  "/admin/command-center",
  "/admin/users",
  "/admin/experts",
  "/admin/creators",
  "/admin/benchmarks",
  "/admin/ai",
  "/admin/competitors",
] as const;

const WEEKLY_OPS_PREFIXES = [
  "/admin/seasons",
  "/admin/data",
  "/admin/weekly-pools",
  "/admin/contests",
  "/admin/live-scoring",
  "/admin/week-status",
  "/admin/weekly-exceptions",
  "/admin/diagnostics",
  "/admin/ops",
] as const;

function pathMatches(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/admin") return false;
  return pathname.startsWith(`${href}/`);
}

function findSecondaryMatch(
  pathname: string,
  groups: readonly AdminNavGroup[],
): string | null {
  const candidates = groups
    .flatMap((group) => group.links)
    .map((link) => link.href)
    .filter((href) => pathMatches(pathname, href))
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}

export type ResolvedAdminNav = {
  family: AdminNavFamily | null;
  primaryHref: string | null;
  secondaryHref: string | null;
  secondaryGroups: readonly AdminNavGroup[] | null;
};

/**
 * Resolve primary + secondary active state from a pathname.
 * `/admin` (exact) is Weekly Ops; `/admin/command-center` is Command Center.
 */
export function resolveAdminNav(pathname: string): ResolvedAdminNav {
  const path = pathname.split("?")[0] || pathname;

  if (path === "/legal" || path.startsWith("/legal/")) {
    return {
      family: "legal",
      primaryHref: "/legal",
      secondaryHref: null,
      secondaryGroups: null,
    };
  }

  if (
    ADMIN_DEVELOPER_LINKS.some((link) => pathMatches(path, link.href))
  ) {
    return {
      family: "developer",
      primaryHref: null,
      secondaryHref:
        ADMIN_DEVELOPER_LINKS.find((link) => pathMatches(path, link.href))
          ?.href ?? null,
      secondaryGroups: null,
    };
  }

  if (path === "/admin/players" || path.startsWith("/admin/players/")) {
    return {
      family: "players",
      primaryHref: "/admin/players",
      secondaryHref: null,
      secondaryGroups: null,
    };
  }

  if (path === "/admin/scoring" || path.startsWith("/admin/scoring")) {
    return {
      family: "scoring",
      primaryHref: "/admin/scoring",
      secondaryHref: findSecondaryMatch(path, SCORING_SECONDARY),
      secondaryGroups: SCORING_SECONDARY,
    };
  }

  if (COMMAND_CENTER_PREFIXES.some((prefix) => pathMatches(path, prefix))) {
    return {
      family: "command-center",
      primaryHref: "/admin/command-center",
      secondaryHref: findSecondaryMatch(path, COMMAND_CENTER_SECONDARY),
      secondaryGroups: COMMAND_CENTER_SECONDARY,
    };
  }

  if (path === "/admin" || WEEKLY_OPS_PREFIXES.some((prefix) => pathMatches(path, prefix))) {
    return {
      family: "weekly-ops",
      primaryHref: "/admin",
      secondaryHref:
        path === "/admin" ? null : findSecondaryMatch(path, WEEKLY_OPS_SECONDARY),
      secondaryGroups: WEEKLY_OPS_SECONDARY,
    };
  }

  return {
    family: null,
    primaryHref: null,
    secondaryHref: null,
    secondaryGroups: null,
  };
}

export function adminPrimaryLabels(): string[] {
  return ADMIN_PRIMARY_LINKS.map((link) => link.label);
}

export function isAdminCapabilityReachable(href: string): boolean {
  return (ADMIN_PRESERVED_ROUTES as readonly string[]).includes(href);
}
