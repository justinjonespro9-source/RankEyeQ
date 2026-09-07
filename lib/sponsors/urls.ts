import { getCompanyWebsiteUrl } from "@/lib/company";

/**
 * Official SNG LABS product destinations.
 * Override with HANDICAP_HERO_URL / STADIUM_SLOP_URL / TEAM_M8TES_URL.
 */
const DEFAULTS = {
  handicapHero: "https://handicaphero.com",
  stadiumSlop: "https://stadiumslop.com",
  teamM8tes: "https://team-m8tes.com",
} as const;

function envOr(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  if (value) return value;
  return fallback;
}

export function getHandicapHeroUrl(): string {
  return envOr("HANDICAP_HERO_URL", DEFAULTS.handicapHero);
}

export function getStadiumSlopUrl(): string {
  return envOr("STADIUM_SLOP_URL", DEFAULTS.stadiumSlop);
}

export function getTeamM8tesUrl(): string {
  return envOr("TEAM_M8TES_URL", DEFAULTS.teamM8tes);
}

/** Allowed outbound destinations for /go redirect (open-redirect safe). */
export function getAllowedSponsorDestinations(): string[] {
  const urls = [
    getHandicapHeroUrl(),
    getStadiumSlopUrl(),
    getTeamM8tesUrl(),
    getCompanyWebsiteUrl(),
  ].filter((url): url is string => Boolean(url));
  return [...new Set(urls)];
}

export function isAllowedSponsorDestination(url: string): boolean {
  try {
    const target = new URL(url);
    return getAllowedSponsorDestinations().some((allowed) => {
      try {
        const a = new URL(allowed);
        return a.origin === target.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
