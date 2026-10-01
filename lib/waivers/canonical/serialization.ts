import { createHash } from "node:crypto";

/**
 * `sng-canonical-json/1`: recursive plain-object keys in JavaScript UTF-16
 * code-unit order, arrays in contract order, explicit nulls, booleans, strings
 * and safe integers only. Must stay byte-identical to the producer serializer;
 * it is a transport contract, not scoring logic.
 */
export class CanonicalSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalSerializationError";
  }
}

function normalize(item: unknown): unknown {
  if (item === null || typeof item === "string" || typeof item === "boolean") return item;
  if (typeof item === "number" && Number.isSafeInteger(item)) return item;
  if (Array.isArray(item)) return item.map(normalize);
  if (item && Object.getPrototypeOf(item) === Object.prototype) {
    const record = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalize(record[key])]),
    );
  }
  throw new CanonicalSerializationError("Canonical JSON requires plain objects, explicit nulls and safe integers");
}

export function canonicalExportJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function canonicalExportChecksum(value: unknown): string {
  return createHash("sha256").update(canonicalExportJson(value), "utf8").digest("hex");
}
