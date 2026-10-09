import { createHash } from "node:crypto";

/** sha256 hex of the UTF-8 bytes of `text` (matches the database CHECK). */
export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Text that round-trips through UTF-8 and PostgreSQL unchanged: no NUL and
 * no lone surrogates (which UTF-8 encoding would silently replace).
 */
export function isStorableText(text: string): boolean {
  return !text.includes("\u0000") && text.isWellFormed();
}

export const SHA256_HEX = /^[a-f0-9]{64}$/;
