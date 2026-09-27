/**
 * Local safety guard: refuse to run tests / Prisma CLI against the Production
 * Neon database by accident (e.g. a stale `export DATABASE_URL=...` in a shell,
 * which dotenv will NOT override from `.env`).
 *
 * Dependency-free so it can be imported from prisma.config.ts and vitest setup.
 */

/** Hostname fragments that identify the Production database. Not credentials. */
export const PRODUCTION_DB_HOST_MARKERS = ["ep-curly-bonus-ax4xh6fm"] as const;

export const ALLOW_PRODUCTION_DB_ENV = "RANKEYEQ_ALLOW_PRODUCTION_DB";

export function databaseHostFromUrl(url: string | undefined | null): string | null {
  const raw = url?.trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;
  try {
    return new URL(raw).hostname || null;
  } catch {
    return null;
  }
}

export function isProductionDatabaseHost(host: string | null): boolean {
  if (!host) return false;
  return PRODUCTION_DB_HOST_MARKERS.some((marker) => host.includes(marker));
}

export class ProductionDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionDatabaseGuardError";
  }
}

/**
 * Throws when DATABASE_URL points at Production.
 * `allowOverride` lets an operator run an intentional Production migration with
 * RANKEYEQ_ALLOW_PRODUCTION_DB=1. Tests never allow the override.
 */
export function assertNonProductionDatabase(input: {
  context: string;
  env?: Record<string, string | undefined>;
  allowOverride: boolean;
}): void {
  const env = input.env ?? process.env;
  const host = databaseHostFromUrl(env.DATABASE_URL);
  if (!isProductionDatabaseHost(host)) return;
  if (input.allowOverride && env[ALLOW_PRODUCTION_DB_ENV] === "1") return;
  throw new ProductionDatabaseGuardError(
    [
      `[${input.context}] Refusing to use the Production database (${host}).`,
      "DATABASE_URL is probably exported in your shell (dotenv does not override it).",
      "Run `unset DATABASE_URL` so `.env` (local Postgres) applies.",
      input.allowOverride
        ? `For an intentional, approved Production operation set ${ALLOW_PRODUCTION_DB_ENV}=1 for that single command.`
        : "Tests may never run against Production.",
    ].join(" "),
  );
}
