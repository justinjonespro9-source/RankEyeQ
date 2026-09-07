"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestCreatorVerificationAction } from "@/lib/creator-verification-actions";
import {
  CREATOR_CLAIM_REVIEW_COPY,
  CREATOR_TRACKED_DISCLAIMER,
  CREATOR_VERIFICATION_CRITERIA,
} from "@/lib/creator-verification-shared";
import type { CreatorClaimStatus } from "@/lib/generated/prisma/client";
import { Button } from "@/components/ui/Button";

export function CreatorVerificationSection({
  profileType,
  claimStatus,
  creatorBrandName,
}: {
  profileType: "HUMAN" | "AI" | "BENCHMARK" | "CREATOR";
  claimStatus: CreatorClaimStatus | null;
  creatorBrandName?: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  return (
    <section className="mt-10 rounded-lg border border-border bg-surface-elevated p-5">
      <h2 className="font-display text-xl font-semibold text-ink">
        Are you a fantasy creator?
      </h2>
      <p className="mt-1 text-sm text-muted">
        Request Creator verification. {CREATOR_CLAIM_REVIEW_COPY} PUBLIC remains
        the default until an admin approves.
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
            setMessage("Creator verification requested");
            router.refresh();
          });
        }}
      >
        <label className="block text-sm">
          <span className="font-medium text-ink">Creator / content URL</span>
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
            placeholder="Shown as CREATOR · brand after approval"
            className="mt-1 w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-ink">
            Existing tracked Creator username (optional)
          </span>
          <input
            name="claimTargetUsername"
            type="text"
            placeholder="Only if RankEyeQ already tracks you"
            className="mt-1 w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-ink"
          />
          <span className="mt-1 block text-xs text-muted">
            Leave blank to request a new Creator identity on this account. Admin
            manually links tracked profiles — no automatic matching.
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
          {pending ? "Submitting…" : "Request Creator verification"}
        </Button>
      </form>
    </section>
  );
}
