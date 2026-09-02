export type LogLevel = "info" | "warn" | "error";

const REDACT_KEY =
  /(secret|token|password|authorization|api[_-]?key|cookie|magic|email_server|database_url|auth_secret)/i;

function redactValue(key: string, value: unknown): unknown {
  if (REDACT_KEY.test(key)) return "[redacted]";
  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 200)}…[truncated]`;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

function sanitizeFields(fields?: Record<string, unknown>) {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = redactValue(key, value);
  }
  return out;
}

export function logServerEvent(
  event: string,
  fields?: Record<string, unknown>,
  level: LogLevel = "info",
) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizeFields(fields),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function logAuthFailure(reason: string, fields?: Record<string, unknown>) {
  logServerEvent("auth.failure", { reason, ...fields }, "warn");
}

export function logProviderFailure(provider: string, message: string, fields?: Record<string, unknown>) {
  logServerEvent(
    "provider.failure",
    { provider, message, ...fields },
    "error",
  );
}

export function logAdminImpact(action: string, fields?: Record<string, unknown>) {
  logServerEvent("admin.impact", { action, ...fields }, "info");
}
