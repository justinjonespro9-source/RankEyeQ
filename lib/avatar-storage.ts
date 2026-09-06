import { del, put } from "@vercel/blob";
import { isUploadedAvatarUrl } from "@/lib/avatar";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export class AvatarStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarStorageError";
  }
}

export function isAvatarUploadConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());
}

function extensionFor(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "jpg";
}

/**
 * Upload a profile photo to Vercel Blob. Requires BLOB_READ_WRITE_TOKEN.
 * Returns a public HTTPS URL to store on UniversalProfile.avatarUrl.
 */
export async function uploadProfileAvatarBlob(input: {
  userId: string;
  file: File;
}) {
  if (!isAvatarUploadConfigured()) {
    throw new AvatarStorageError(
      "Photo upload is not configured yet. Please try again later.",
    );
  }

  if (!(input.file instanceof File) || input.file.size <= 0) {
    throw new AvatarStorageError("Choose a photo to upload.");
  }
  if (input.file.size > MAX_BYTES) {
    throw new AvatarStorageError("Photos must be 2 MB or smaller.");
  }
  if (!ALLOWED_TYPES.has(input.file.type)) {
    throw new AvatarStorageError("Use a JPG, PNG, WEBP, or GIF photo.");
  }

  const pathname = `avatars/${input.userId}/${Date.now()}.${extensionFor(input.file.type)}`;
  const blob = await put(pathname, input.file, {
    access: "public",
    addRandomSuffix: true,
    contentType: input.file.type,
  });

  return blob.url;
}

/** Best-effort delete of a prior Blob upload (ignore failures). */
export async function deleteUploadedAvatarIfOwned(url: string | null | undefined) {
  if (!isUploadedAvatarUrl(url) || !isAvatarUploadConfigured()) return;
  try {
    await del(url!);
  } catch {
    // Non-fatal: orphaned blobs can be cleaned later.
  }
}
