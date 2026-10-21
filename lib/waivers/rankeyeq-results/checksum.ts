import { createHash } from "node:crypto";

/**
 * Stable JSON for RankEyeQ final-week-stats content: plain-object keys in
 * UTF-16 code-unit order, arrays in given order, explicit nulls, booleans,
 * strings and safe integers only (fantasy points are integer hundredths, never
 * floats). `undefined`, floats, dates and class instances throw instead of
 * silently changing a checksum.
 */
export class RankEyeQCanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RankEyeQCanonicalJsonError";
  }
}

function normalize(item: unknown, path: string): unknown {
  if (item === null || typeof item === "string" || typeof item === "boolean") return item;
  if (typeof item === "number") {
    if (Number.isSafeInteger(item)) return Object.is(item, -0) ? 0 : item;
    throw new RankEyeQCanonicalJsonError(`Canonical JSON requires safe integers (${path} = ${item})`);
  }
  if (Array.isArray(item)) return item.map((value, index) => normalize(value, `${path}[${index}]`));
  if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
    const record = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => {
          if (record[key] === undefined) throw new RankEyeQCanonicalJsonError(`Canonical JSON forbids undefined (${path}.${key})`);
          return [key, normalize(record[key], `${path}.${key}`)];
        }),
    );
  }
  throw new RankEyeQCanonicalJsonError(`Canonical JSON requires plain objects, explicit nulls and safe integers (${path})`);
}

export function canonicalRankEyeQJson(value: unknown): string {
  return JSON.stringify(normalize(value, "$"));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 over the canonical JSON of the immutable snapshot content. */
export function rankEyeQContentChecksum(content: unknown): string {
  return sha256Hex(canonicalRankEyeQJson(content));
}
