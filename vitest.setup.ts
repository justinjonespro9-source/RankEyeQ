import "dotenv/config";
import { assertNonProductionDatabase } from "./lib/db-target-guard";

assertNonProductionDatabase({ context: "vitest", allowOverride: false });
