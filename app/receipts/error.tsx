"use client";

import { useEffect } from "react";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";

export default function ReceiptsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "receipts.ui_error",
        route: "/receipts",
        digest: error.digest ?? null,
      }),
    );
  }, [error]);

  return (
    <Container className="py-12 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Receipts unavailable
      </h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        RankEyeQ could not finish loading Thursday receipts. This is an error
        state — not an empty early slate. Try again, or open results while we
        recover.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button href="/results" variant="secondary">
          Graded results
        </Button>
      </div>
    </Container>
  );
}
