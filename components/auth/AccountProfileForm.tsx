"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeProfilePhotoAction,
  updateAccountProfileAction,
  uploadProfilePhotoAction,
} from "@/lib/account-actions";
import { ProfilePhotoField } from "@/components/auth/ProfilePhotoField";
import { Button } from "@/components/ui/Button";
import { resolveAvatarUrl } from "@/lib/avatar";

export function AccountProfileForm({
  username,
  displayName,
  avatarUrl,
  oauthImageUrl,
  uploadEnabled,
}: {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  oauthImageUrl: string | null;
  uploadEnabled: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [nameDraft, setNameDraft] = useState(displayName);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(avatarUrl);

  const previewSrc = resolveAvatarUrl({
    avatarUrl: currentAvatarUrl,
    oauthImageUrl,
  });
  const canRemove = Boolean(currentAvatarUrl);

  return (
    <div className="space-y-5 rounded-lg border border-border bg-surface-elevated p-5">
      <ProfilePhotoField
        displayName={nameDraft || displayName}
        previewSrc={previewSrc}
        canRemove={canRemove}
        uploadEnabled={uploadEnabled}
        onUpload={async (file) => {
          const data = new FormData();
          data.set("file", file);
          const result = await uploadProfilePhotoAction(data);
          if (!result.ok) return result;
          setCurrentAvatarUrl(result.url);
          router.refresh();
          return { ok: true as const };
        }}
        onRemove={async () => {
          const result = await removeProfilePhotoAction();
          if (!result.ok) return result;
          setCurrentAvatarUrl(result.avatarUrl);
          router.refresh();
          return { ok: true as const };
        }}
      />

      <form
        className="space-y-4 border-t border-border pt-5"
        action={(formData) => {
          startTransition(async () => {
            const result = await updateAccountProfileAction(formData);
            if (!result.ok) {
              setError(result.error);
              setMessage(null);
              return;
            }
            setError(null);
            setMessage("Profile updated");
            router.refresh();
          });
        }}
      >
        <label className="block text-sm">
          <span className="font-medium text-ink">Username</span>
          <p className="mt-0.5 text-xs text-muted">Your unique RankEyeQ handle.</p>
          <input
            name="username"
            required
            defaultValue={username}
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            pattern="[a-z0-9_]{3,24}"
            autoComplete="username"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-ink">Display Name</span>
          <p className="mt-0.5 text-xs text-muted">
            The name shown on your public profile.
          </p>
          <input
            name="displayName"
            required
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            minLength={2}
            maxLength={40}
            autoComplete="nickname"
          />
        </label>
        <p className="text-xs text-muted">
          Profile type, contest history, and EYEQ scores cannot be changed here.
        </p>
        {error ? (
          <p className="text-sm text-warning" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="text-sm text-accent-ink" role="status">
            {message}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          Save changes
        </Button>
      </form>
    </div>
  );
}
