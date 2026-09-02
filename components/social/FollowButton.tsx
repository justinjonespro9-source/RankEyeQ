"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  followProfileAction,
  unfollowProfileAction,
} from "@/lib/social-actions";
import { Button } from "@/components/ui/Button";

export function FollowButton({
  targetProfileId,
  initialFollowing,
  signedIn,
  canFollow = true,
  size = "sm",
}: {
  targetProfileId: string;
  initialFollowing: boolean;
  signedIn: boolean;
  canFollow?: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Button href={`/signin?callbackUrl=/following`} size={size} variant="secondary">
        Sign in to follow
      </Button>
    );
  }

  if (!canFollow) {
    return null;
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size={size}
        variant={following ? "secondary" : "primary"}
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = following
              ? await unfollowProfileAction(targetProfileId)
              : await followProfileAction(targetProfileId);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setError(null);
            setFollowing(!following);
            router.refresh();
          });
        }}
      >
        {pending ? "Saving…" : following ? "Following" : "Follow"}
      </Button>
      {error ? <p className="text-xs text-warning">{error}</p> : null}
    </div>
  );
}
