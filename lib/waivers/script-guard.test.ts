import { describe, expect, it } from "vitest";
import { ProductionDatabaseGuardError } from "@/lib/db-target-guard";
import { assertWaiversScriptDatabaseTarget } from "@/lib/waivers/script-guard";

const PROD = "postgresql://u:p@ep-curly-bonus-ax4xh6fm-pooler.c-4.us-east-2.aws.neon.tech/neondb";
const PREVIEW = "postgresql://u:p@ep-aged-sunset-axbayr5e-pooler.c-4.us-east-2.aws.neon.tech/neondb";
const LOCAL = "postgresql://u:p@localhost:5432/rankiq?schema=public";

describe("Waivers script database guard", () => {
  it("allows local and Preview targets", () => {
    for (const url of [LOCAL, PREVIEW]) {
      expect(() => assertWaiversScriptDatabaseTarget({ script: "t", env: { DATABASE_URL: url } })).not.toThrow();
    }
  });

  it("refuses Production by default, even with the env override set", () => {
    expect(() =>
      assertWaiversScriptDatabaseTarget({
        script: "t",
        env: { DATABASE_URL: PROD, RANKEYEQ_ALLOW_PRODUCTION_DB: "1" },
      }),
    ).toThrow(ProductionDatabaseGuardError);
  });

  it("requires both an explicit approved-operation opt-in and the env override", () => {
    expect(() =>
      assertWaiversScriptDatabaseTarget({ script: "t", allowApprovedProductionOperation: true, env: { DATABASE_URL: PROD } }),
    ).toThrow(ProductionDatabaseGuardError);
    expect(() =>
      assertWaiversScriptDatabaseTarget({
        script: "t",
        allowApprovedProductionOperation: true,
        env: { DATABASE_URL: PROD, RANKEYEQ_ALLOW_PRODUCTION_DB: "1" },
      }),
    ).not.toThrow();
  });

  it("names the script in the refusal without exposing credentials", () => {
    try {
      assertWaiversScriptDatabaseTarget({ script: "waivers-freeze", env: { DATABASE_URL: PROD } });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("waivers-script:waivers-freeze");
      expect(message).not.toContain("u:p@");
    }
  });
});
