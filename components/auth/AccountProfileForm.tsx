"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAccountProfileAction } from "@/lib/account-actions";
import { Button } from "@/components/ui/Button";

export function AccountProfileForm({
  username,
  displayName,
  avatarUrl,
}: {
  username: string;
  displayName: string;
  avatarUrl: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-surface-elevated p-5"
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
        <input
          name="username"
          required
          defaultValue={username}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          pattern="[a-z0-9_]{3,24}"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-ink">Display name</span>
        <input
          name="displayName"
          required
          defaultValue={displayName}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          minLength={2}
          maxLength={40}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-ink">Avatar URL</span>
        <input
          name="avatarUrl"
          type="url"
          defaultValue={avatarUrl}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
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
        <p className="text-sm text-accent" role="status">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Save changes
      </Button>
    </form>
  );
}
