import { assertNonProductionDatabase } from "@/lib/db-target-guard";

/**
 * Required first call in every Waivers script that can touch a database.
 * Refuses the Production host unless the caller explicitly opts into an
 * approved Production operation AND RANKEYEQ_ALLOW_PRODUCTION_DB=1 is set for
 * that single command. Scripts do not inherit the Prisma CLI / vitest guards.
 */
export function assertWaiversScriptDatabaseTarget(input: {
  script: string;
  allowApprovedProductionOperation?: boolean;
  env?: Record<string, string | undefined>;
}): void {
  assertNonProductionDatabase({
    context: `waivers-script:${input.script}`,
    env: input.env,
    allowOverride: input.allowApprovedProductionOperation === true,
  });
}
