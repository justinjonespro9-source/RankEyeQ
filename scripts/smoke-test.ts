import "dotenv/config";
import { getSmokeDiagnostics } from "../lib/admin/smoke";

async function main() {
  const smoke = await getSmokeDiagnostics();
  for (const check of smoke.checks) {
    const mark = check.ok ? "ok" : "FAIL";
    console.info(`[${mark}] ${check.key}: ${check.detail}`);
  }
  if (!smoke.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Smoke test failed to run");
  console.error(error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
