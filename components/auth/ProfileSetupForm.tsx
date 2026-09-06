"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  completeProfileSetupAction,
  uploadProfilePhotoAction,
} from "@/lib/account-actions";
import { ProfilePhotoField } from "@/components/auth/ProfilePhotoField";
import { Button } from "@/components/ui/Button";
import { resolveAvatarUrl } from "@/lib/avatar";

export function ProfileSetupForm({
  defaultUsername,
  defaultDisplayName,
  oauthImageUrl,
  uploadEnabled,
  signupPolicies,
}: {
  defaultUsername: string;
  defaultDisplayName: string;
  oauthImageUrl: string | null;
  uploadEnabled: boolean;
  signupPolicies: Array<{
    slug: string;
    title: string;
    href: string;
    publishedVersion: string;
  }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const terms = signupPolicies.find((row) => row.slug === "terms");
  const privacy = signupPolicies.find((row) => row.slug === "privacy");
  const versionLabel = terms?.publishedVersion ?? privacy?.publishedVersion;

  const previewSrc = resolveAvatarUrl({
    avatarUrl: uploadedUrl,
    oauthImageUrl,
  });

  return (
    <form
      className="space-y-5 rounded-lg border border-border bg-surface-elevated p-5"
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
        <p className="mt-0.5 text-xs text-muted">Your unique RankEyeQ handle.</p>
        <input
          name="username"
          required
          defaultValue={defaultUsername}
          className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          pattern="[a-z0-9_]{3,24}"
          title="3–24 lowercase letters, numbers, underscores"
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
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          minLength={2}
          maxLength={40}
          autoComplete="nickname"
        />
      </label>

      <ProfilePhotoField
        displayName={displayName || defaultDisplayName || "You"}
        previewSrc={previewSrc}
        canRemove={Boolean(uploadedUrl)}
        uploadEnabled={uploadEnabled}
        helperText="Optional. We'll use your Google photo if you signed in with Google."
        onUpload={async (file) => {
          const data = new FormData();
          data.set("file", file);
          const result = await uploadProfilePhotoAction(data);
          if (!result.ok) return result;
          setUploadedUrl(result.url);
          return { ok: true as const };
        }}
        onRemove={async () => {
          setUploadedUrl(null);
          return { ok: true as const };
        }}
      />
      <input type="hidden" name="avatarUrl" value={uploadedUrl ?? ""} />

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
