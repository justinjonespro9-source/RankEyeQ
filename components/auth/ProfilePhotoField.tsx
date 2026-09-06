"use client";

import { useRef, useState, useTransition } from "react";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import { Button } from "@/components/ui/Button";

/**
 * Human profile photo control — file picker only (no URL paste).
 * Parent owns persistence via onUploaded / onRemoved callbacks.
 */
export function ProfilePhotoField({
  displayName,
  previewSrc,
  canRemove,
  uploadEnabled,
  onUpload,
  onRemove,
  helperText = "Shown on your public profile and leaderboards.",
}: {
  displayName: string;
  /** Resolved preview: uploaded, Google, or null for initials. */
  previewSrc: string | null;
  canRemove: boolean;
  uploadEnabled: boolean;
  onUpload: (file: File) => Promise<{ ok: true } | { ok: false; error: string }>;
  onRemove?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  helperText?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  const shownSrc = localPreview ?? previewSrc;

  function pickFile() {
    setError(null);
    inputRef.current?.click();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);

    startTransition(async () => {
      const result = await onUpload(file);
      URL.revokeObjectURL(objectUrl);
      if (!result.ok) {
        setLocalPreview(null);
        setError(result.error);
        return;
      }
      setLocalPreview(null);
      setError(null);
    });
  }

  function handleRemove() {
    if (!onRemove) return;
    setError(null);
    startTransition(async () => {
      const result = await onRemove();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLocalPreview(null);
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-ink">Profile Photo</p>
        <p className="mt-0.5 text-xs text-muted">{helperText}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <ProfileAvatar name={displayName || "RankEyeQ"} src={shownSrc} size="lg" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !uploadEnabled}
            onClick={pickFile}
          >
            {pending ? "Uploading…" : "Upload Profile Photo"}
          </Button>
          {canRemove && onRemove ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={handleRemove}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {!uploadEnabled ? (
        <p className="text-xs text-muted">
          Photo upload will be available once storage is configured.
        </p>
      ) : (
        <p className="text-xs text-muted">JPG, PNG, WEBP, or GIF · up to 2 MB</p>
      )}
      {error ? (
        <p className="text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
