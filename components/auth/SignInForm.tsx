"use client";

import { useState, useTransition } from "react";
import {
  signInWithEmailAction,
  signInWithGoogleAction,
} from "@/lib/auth-actions";
import { Button } from "@/components/ui/Button";

export function SignInForm({
  callbackUrl,
  googleEnabled,
}: {
  callbackUrl: string;
  googleEnabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-elevated p-5">
      {googleEnabled ? (
        <form
          action={(formData) => {
            formData.set("callbackUrl", callbackUrl);
            startTransition(async () => {
              await signInWithGoogleAction(formData);
            });
          }}
        >
          <Button
            type="submit"
            variant="secondary"
            className="w-full"
            disabled={pending}
          >
            Continue with Google
          </Button>
        </form>
      ) : null}

      {googleEnabled ? (
        <p className="text-center text-xs uppercase tracking-wide text-muted">
          or
        </p>
      ) : null}

      <form
        className="space-y-3"
        action={(formData) => {
          formData.set("callbackUrl", callbackUrl);
          startTransition(async () => {
            try {
              const result = await signInWithEmailAction(formData);
              if (result && !result.ok) {
                setError(result.error);
              }
            } catch {
              // Redirect on success is expected.
            }
          });
        }}
      >
        <label className="block text-sm">
          <span className="font-medium text-ink">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            placeholder="you@example.com"
          />
        </label>
        <Button type="submit" className="w-full" disabled={pending}>
          Email magic link
        </Button>
      </form>

      {error ? (
        <p className="text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
