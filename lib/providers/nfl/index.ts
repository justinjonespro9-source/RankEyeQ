import { MockNflProvider } from "@/lib/providers/nfl/mock/provider";
import { ManualNflProvider } from "@/lib/providers/nfl/manual/provider";
import { SportsDataIoProvider } from "@/lib/providers/nfl/sportsdataio/provider";
import type { NflDataProvider, NflProviderName } from "@/lib/providers/nfl/types";

export type { NflDataProvider, NflProviderName } from "@/lib/providers/nfl/types";

export const NFL_PROVIDER_NAMES = ["manual", "mock", "sportsdataio"] as const;

export function resolveNflProviderName(
  env: NodeJS.ProcessEnv = process.env,
): NflProviderName {
  const configured = (env.NFL_DATA_PROVIDER ?? "mock").toLowerCase();
  if (configured === "manual") return "manual";
  if (configured === "sportsdataio") {
    if (!env.SPORTSDATAIO_API_KEY) {
      return "mock";
    }
    return "sportsdataio";
  }
  return "mock";
}

export function isManualNflMode(env: NodeJS.ProcessEnv = process.env) {
  return resolveNflProviderName(env) === "manual";
}

export function createNflDataProvider(
  env: NodeJS.ProcessEnv = process.env,
): NflDataProvider {
  const name = resolveNflProviderName(env);
  if (name === "manual") {
    return new ManualNflProvider();
  }
  if (name === "sportsdataio" && env.SPORTSDATAIO_API_KEY) {
    return new SportsDataIoProvider(
      env.SPORTSDATAIO_API_KEY,
      env.SPORTSDATAIO_BASE_URL,
    );
  }
  return new MockNflProvider();
}
