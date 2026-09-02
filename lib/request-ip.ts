import { headers } from "next/headers";

export async function getRequestIp() {
  try {
    const headerStore = await headers();
    const forwarded = headerStore.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    return (
      headerStore.get("x-real-ip") ??
      headerStore.get("cf-connecting-ip") ??
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export async function rateLimitKey(scope: string, subject?: string | null) {
  const ip = await getRequestIp();
  return `${scope}:${subject || ip}`;
}
