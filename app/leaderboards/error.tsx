"use client";

import { useEffect } from "react";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";

export default function LeaderboardsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "leaderboards.ui_error",
        route: "/leaderboards",
        digest: error.digest ?? null,
      }),
    );
  }, [error]);

  return (
    <Container className="py-12 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Leaderboards unavailable
      </h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        RankEyeQ could not finish loading leaderboards. This is an error state —
        not an empty week. Try again, or open weekly rankings while we recover.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button href="/rank" variant="secondary">
          Build rankings
        </Button>
      </div>
    </Container>
  );
}
