export type NavLink = {
  href: string;
  label: string;
  /** Path prefixes that should highlight this parent nav item. */
  activePrefixes?: string[];
};

export const PRIMARY_NAV: NavLink[] = [
  { href: "/rank", label: "Rank", activePrefixes: ["/rank"] },
  { href: "/consensus", label: "Consensus", activePrefixes: ["/consensus"] },
  {
    href: "/results",
    label: "Results",
    activePrefixes: ["/results", "/receipts", "/archive", "/leaderboards/live"],
  },
  {
    href: "/leaderboards",
    label: "Leaderboards",
    activePrefixes: ["/leaderboards", "/rankers"],
  },
  { href: "/players", label: "Players", activePrefixes: ["/players"] },
];

export const RESULTS_SUBNAV: NavLink[] = [
  { href: "/results", label: "This Week" },
  { href: "/leaderboards/live", label: "Live" },
  { href: "/receipts", label: "Receipts" },
  { href: "/archive", label: "Archive" },
];

export const LEADERBOARDS_SUBNAV: NavLink[] = [
  { href: "/leaderboards", label: "Overall" },
  { href: "/leaderboards?filter=HUMAN", label: "Humans" },
  { href: "/leaderboards?filter=EXPERT", label: "Experts" },
  { href: "/leaderboards?filter=AI", label: "AI" },
  { href: "/rankers", label: "Rankers" },
];

export function isPrimaryNavActive(pathname: string, link: NavLink): boolean {
  if (link.label === "Leaderboards") {
    if (pathname === "/rankers" || pathname.startsWith("/rankers/")) return true;
    if (pathname === "/leaderboards") return true;
    if (
      pathname.startsWith("/leaderboards/") &&
      !pathname.startsWith("/leaderboards/live")
    ) {
      return true;
    }
    return false;
  }

  const prefixes = link.activePrefixes ?? [link.href];
  return prefixes.some(
    (prefix) =>
      pathname === prefix ||
      (prefix !== "/" && pathname.startsWith(`${prefix}/`)) ||
      (prefix.includes("?") && pathname === prefix.split("?")[0]),
  );
}

export function isSubnavActive(pathname: string, href: string): boolean {
  const [path, query] = href.split("?");
  if (query) {
    return false;
  }
  if (path === "/results") {
    return pathname === "/results";
  }
  if (path === "/leaderboards") {
    return pathname === "/leaderboards";
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function subnavHrefActive(
  pathname: string,
  searchParams: URLSearchParams | null,
  href: string,
): boolean {
  const [path, query] = href.split("?");

  if (path === "/rankers") {
    return pathname === "/rankers" || pathname.startsWith("/rankers/");
  }

  if (path === "/leaderboards/live") {
    return (
      pathname === "/leaderboards/live" ||
      pathname.startsWith("/leaderboards/live/")
    );
  }

  if (query) {
    const params = new URLSearchParams(query);
    if (pathname !== path) return false;
    const expectedFilter = params.get("filter") ?? "ALL";
    const actualFilter = searchParams?.get("filter") ?? "ALL";
    return actualFilter === expectedFilter;
  }

  if (path === "/leaderboards") {
    return (
      pathname === "/leaderboards" &&
      (!searchParams?.get("filter") || searchParams.get("filter") === "ALL")
    );
  }

  if (path === "/results") {
    return pathname === "/results";
  }

  return pathname === path || pathname.startsWith(`${path}/`);
}
