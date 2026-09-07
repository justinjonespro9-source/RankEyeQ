import type { Metadata } from "next";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { NO_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Page not found",
  description: "That RankEyeQ page does not exist.",
  ...NO_INDEX,
};

export default function NotFoundPage() {
  return (
    <Container className="py-16">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Page not found
      </h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        That RankEyeQ page does not exist, or you do not have access to it.
      </p>
      <div className="mt-6">
        <Button href="/">Back to home</Button>
      </div>
    </Container>
  );
}
