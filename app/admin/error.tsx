"use client";

import { useEffect } from "react";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "admin.ui.error",
        digest: error.digest,
        message: error.message?.slice(0, 200),
      }),
    );
  }, [error]);

  return (
    <Container className="py-16">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Admin action failed
      </h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        {error.message && !/secret|token|api[_-]?key|password/i.test(error.message)
          ? error.message
          : "The operator action could not be completed. Check server logs for details — secrets are never shown here."}
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">Digest: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="button" onClick={() => reset()}>
          Retry
        </Button>
        <Button href="/admin" variant="secondary">
          Command center
        </Button>
      </div>
    </Container>
  );
}
