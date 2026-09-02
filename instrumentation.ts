export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { assertProductionEnv, validateEnv, isStrictProductionEnv } = await import(
    "@/lib/env"
  );
  const { logServerEvent } = await import("@/lib/log");
  if (isStrictProductionEnv()) {
    assertProductionEnv();
    return;
  }
  const result = validateEnv();
  if (!result.ok || result.warnings.length > 0) {
    logServerEvent(
      "env.validation",
      {
        ok: result.ok,
        errors: result.errors.map((issue) => issue.message),
        warnings: result.warnings.map((issue) => issue.message),
        summary: result.summary,
      },
      result.ok ? "warn" : "error",
    );
  }
}
