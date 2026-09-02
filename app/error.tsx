"use client";

import { useEffect } from "react";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(JSON.stringify({ event: "ui.error", digest: error.digest }));
  }, [error]);

  return (
    <Container className="py-16">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Something went wrong
      </h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        RankEyeQ hit an unexpected error. Try again. If this keeps happening, the
        operator logs will have a safe diagnostic id — no stack traces are shown here.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </Container>
  );
}
