"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestCreatorVerificationAction } from "@/lib/creator-verification-actions";
import {
  CREATOR_CLAIM_REVIEW_COPY,
  CREATOR_TRACKED_DISCLAIMER,
  CREATOR_VERIFICATION_CRITERIA,
} from "@/lib/creator-verification-shared";
import type {
  CreatorClaimStatus,
  ProfileType,
} from "@/lib/generated/prisma/client";
import { Button } from "@/components/ui/Button";

export function CreatorVerificationSection({
  profileType,
  claimStatus,
  creatorBrandName,
  ownershipVerifiedAt,
  defaultClaimUsername,
  pendingProfileClaim,
}: {
  profileType: "HUMAN" | "AI" | "BENCHMARK" | "CREATOR";
  claimStatus: CreatorClaimStatus | null;
  creatorBrandName?: string | null;
  ownershipVerifiedAt?: Date | null;
  defaultClaimUsername?: string | null;
  pendingProfileClaim?: {
    targetUsername: string;
    targetDisplayName: string;
    targetType: ProfileType;
  } | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (profileType === "BENCHMARK" && ownershipVerifiedAt) {
    return (
      <section className="mt-10 rounded-lg border border-accent/30 bg-accent-soft/40 p-5">
        <h2 className="font-display text-xl font-semibold text-ink">
          Verified Expert
        </h2>
        <p className="mt-2 text-sm text-muted">
          You own this Expert profile. Edit presentation fields above — rankings,
          scores, and weekly source links stay RankEyeQ-controlled.
        </p>
      </section>
    );
  }

  if (profileType === "CREATOR" && claimStatus === "VERIFIED") {
    return (
      <section className="mt-10 rounded-lg border border-accent/30 bg-accent-soft/40 p-5">
        <h2 className="font-display text-xl font-semibold text-ink">
          Verified Creator
        </h2>
        <p className="mt-2 text-sm text-muted">
          Your account is verified
          {creatorBrandName ? ` as CREATOR · ${creatorBrandName}` : ""}. Public
          identity chips stay CREATOR — verification is shown on your profile.
        </p>
        <p className="mt-3 text-xs text-muted">{CREATOR_TRACKED_DISCLAIMER}</p>
      </section>
    );
  }

  if (profileType !== "HUMAN") {
    return null;
  }

  if (pendingProfileClaim) {
    const kind =
      pendingProfileClaim.targetType === "BENCHMARK" ? "Expert" : "Creator";
    return (
      <section className="mt-10 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-xl font-semibold text-ink">
          {kind} claim requested
        </h2>
        <p className="mt-2 text-sm text-muted">
          Claiming @{pendingProfileClaim.targetUsername} (
          {pendingProfileClaim.targetDisplayName}). RankEyeQ reviews claims
          manually — ownership is not automatic.
        </p>
        <p className="mt-3 text-xs text-muted">{CREATOR_CLAIM_REVIEW_COPY}</p>
      </section>
    );
  }

  if (claimStatus === "REQUESTED") {
    return (
      <section className="mt-10 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-xl font-semibold text-ink">
          Creator verification requested
        </h2>
        <p className="mt-2 text-sm text-muted">
          RankEyeQ reviews Creator requests manually. Your competitor class
          stays PUBLIC until approval — you cannot self-select Creator.
        </p>
        <p className="mt-3 text-xs text-muted">{CREATOR_CLAIM_REVIEW_COPY}</p>
      </section>
    );
  }

  const claimPrefill = defaultClaimUsername?.trim() || "";

  return (
    <section className="mt-10 rounded-lg border border-border bg-surface-elevated p-5">
      <h2 className="font-display text-xl font-semibold text-ink">
        {claimPrefill
          ? "Claim this Expert or Creator profile"
          : "Are you a fantasy creator or expert?"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {claimPrefill
          ? "Request ownership of an existing tracked profile. Admin approval is required. Claiming controls presentation only — rankings and scores stay on the tracked identity."
          : `Request Creator verification, or claim an existing tracked Expert/Creator. ${CREATOR_CLAIM_REVIEW_COPY} PUBLIC remains the default until an admin approves.`}
      </p>

      {claimStatus === "REJECTED" ? (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          Your previous request was not approved. You may submit again with
          clearer public proof.
        </p>
      ) : null}

      <details className="mt-4 rounded-md border border-border bg-surface px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          Launch verification criteria
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {CREATOR_VERIFICATION_CRITERIA.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          setMessage(null);
          setError(null);
          startTransition(async () => {
            const result = await requestCreatorVerificationAction(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMessage("Claim / verification requested");
            router.refresh();
          });
        }}
      >
        <label className="block text-sm">
          <span className="font-medium text-ink">Site / content URL</span>
          <input
            name="creatorSiteUrl"
            type="url"
            required
            placeholder="https://"
            className="mt-1 w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-ink">Primary platform or handle</span>
          <input
            name="socialHandle"
            type="text"
            required
            placeholder="@handle or channel"
            className="mt-1 w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-ink">
            Public RankEyeQ proof URL
          </span>
          <input
            name="publicProofUrl"
            type="url"
            required
            placeholder="https://… receipt, post, or profile mention"
            className="mt-1 w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-ink">
            Brand / show name (optional)
          </span>
          <input
            name="brandName"
            type="text"
            placeholder="Shown as CREATOR · brand after in-place approval"
            className="mt-1 w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-ink">
            Tracked Expert / Creator username
            {claimPrefill ? "" : " (optional)"}
          </span>
          <input
            name="claimTargetUsername"
            type="text"
            defaultValue={claimPrefill}
            required={Boolean(claimPrefill)}
            placeholder="justin-boone"
            className="mt-1 w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
          <span className="mt-1 block text-xs text-muted">
            Fill this to claim an existing BENCHMARK (Expert) or CREATOR
            profile. Leave blank only to request a new Creator identity on this
            account.
          </span>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-ink">Short note (optional)</span>
          <textarea
            name="claimNote"
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>

        <p className="text-xs text-muted">{CREATOR_TRACKED_DISCLAIMER}</p>

        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="text-sm text-accent-ink" role="status">
            {message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="min-h-11 w-full sm:w-auto">
          {pending
            ? "Submitting…"
            : claimPrefill
              ? "Request profile claim"
              : "Request verification / claim"}
        </Button>
      </form>
    </section>
  );
}
