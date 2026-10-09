/**
 * Inspects an original provider record (e.g. a chat export) for late-entry
 * evidence. Pure and browser-safe, for the admin preview only: the database
 * re-derives both results from the stored bytes (`waiver_ai_artifact_contains`,
 * `waiver_ai_artifact_message_time`) and its result is authoritative.
 *
 * - containsResponse: the exact response text appears in the file — inside a
 *   JSON string value for JSON files, otherwise in the decoded text.
 * - extractedAt: the earliest provider timestamp carried by an
 *   assistant-attributed JSON message object that itself holds the exact
 *   response. A time anywhere else (conversation, export, user message) or in
 *   a non-JSON file never counts.
 */

export type ProviderArtifactInspection = {
  utf8: boolean;
  json: boolean;
  containsResponse: boolean;
  extractedAt: Date | null;
  extractedKey: string | null;
};

const TIME_KEYS = ["create_time", "created_at", "createdAt", "timestamp"] as const;
const MAX_DEPTH = 64;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** Epoch seconds or milliseconds, or an ISO string with an explicit zone. */
export function providerTime(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000;
    const at = new Date(Math.round(ms));
    return Number.isNaN(at.getTime()) ? null : at;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return null;
}

function isAssistantMessage(node: JsonObject): boolean {
  const author = node.author;
  return node.role === "assistant" || node.sender === "assistant" || (isObject(author) && author.role === "assistant");
}

function messageTime(node: JsonObject): { at: Date; key: string } | null {
  for (const key of TIME_KEYS) {
    const at = providerTime(node[key]);
    if (at) return { at, key };
  }
  return null;
}

function holdsText(node: unknown, text: string, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (typeof node === "string") return node.includes(text);
  if (Array.isArray(node)) return node.some((child) => holdsText(child, text, depth + 1));
  if (isObject(node)) return Object.values(node).some((child) => holdsText(child, text, depth + 1));
  return false;
}

export function inspectProviderArtifact(bytes: Uint8Array, responseText: string): ProviderArtifactInspection {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { utf8: false, json: false, containsResponse: false, extractedAt: null, extractedKey: null };
  }
  if (!responseText) return { utf8: true, json: false, containsResponse: false, extractedAt: null, extractedKey: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { utf8: true, json: false, containsResponse: text.includes(responseText), extractedAt: null, extractedKey: null };
  }

  let earliest: { at: Date; key: string } | null = null;
  const visit = (node: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (!isObject(node)) return;
    if (isAssistantMessage(node)) {
      const time = messageTime(node);
      if (time && holdsText(node, responseText) && (!earliest || time.at.getTime() < earliest.at.getTime())) earliest = time;
    }
    for (const child of Object.values(node)) visit(child, depth + 1);
  };
  visit(parsed, 0);
  const found = earliest as { at: Date; key: string } | null;
  return { utf8: true, json: true, containsResponse: holdsText(parsed, responseText), extractedAt: found?.at ?? null, extractedKey: found?.key ?? null };
}
