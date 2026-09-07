"use client";

import { useEffect } from "react";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";

export default function RankError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "rank.ui_error",
        route: "/rank",
        digest: error.digest ?? null,
      }),
    );
  }, [error]);

  return (
    <Container className="py-12 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Ranking board unavailable
      </h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        RankEyeQ could not finish loading this weekly ranking board. This is an
        error state — not an empty contest. Try again, or return to the weekly
        hub.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button href="/rank" variant="secondary">
          Weekly rankings
        </Button>
      </div>
    </Container>
  );
}
