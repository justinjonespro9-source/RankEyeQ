"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { completeProfileSetupAction } from "@/lib/account-actions";
import { Button } from "@/components/ui/Button";

export function ProfileSetupForm({
  defaultUsername,
  defaultDisplayName,
  defaultAvatarUrl,
  signupPolicies,
}: {
  defaultUsername: string;
  defaultDisplayName: string;
  defaultAvatarUrl: string;
  signupPolicies: Array<{
    slug: string;
    title: string;
    href: string;
    publishedVersion: string;
  }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const terms = signupPolicies.find((row) => row.slug === "terms");
  const privacy = signupPolicies.find((row) => row.slug === "privacy");
  const versionLabel = terms?.publishedVersion ?? privacy?.publishedVersion;

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-surface-elevated p-5"
      action={(formData) => {
        startTransition(async () => {
          const result = await completeProfileSetupAction(formData);
          if (result && !result.ok) {
            setError(result.error);
          }
        });
      }}
    >
      <label className="block text-sm">
        <span className="font-medium text-ink">Username</span>
        <input
          name="username"
          required
          defaultValue={defaultUsername}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          pattern="[a-z0-9_]{3,24}"
          title="3–24 lowercase letters, numbers, underscores"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-ink">Display name</span>
        <input
          name="displayName"
          required
          defaultValue={defaultDisplayName}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          minLength={2}
          maxLength={40}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-ink">Avatar URL (optional)</span>
        <input
          name="avatarUrl"
          type="url"
          defaultValue={defaultAvatarUrl}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          placeholder="https://"
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input
          type="checkbox"
          name="acceptPolicies"
          required
          className="mt-1"
        />
        <span>
          I agree to the{" "}
          {terms ? (
            <Link href={terms.href} className="text-accent hover:underline">
              {terms.title}
            </Link>
          ) : (
            "Terms of Use"
          )}{" "}
          and{" "}
          {privacy ? (
            <Link href={privacy.href} className="text-accent hover:underline">
              {privacy.title}
            </Link>
          ) : (
            "Privacy Policy"
          )}
          {versionLabel ? (
            <span className="text-xs"> (version {versionLabel})</span>
          ) : null}
          .
        </span>
      </label>
      {error ? (
        <p className="text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        Create profile
      </Button>
    </form>
  );
}
