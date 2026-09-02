import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";

export const metadata: Metadata = {
  title: "Check your email",
  description: "Confirm your RankEyeQ magic link to finish signing in.",
};

export default function VerifyRequestPage() {
  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-3xl font-semibold text-ink">
          Check your email
        </h1>
        <p className="mt-3 text-sm text-muted">
          We sent a magic sign-in link. Open it on this device to continue.
          In local development without an email provider, the link is printed
          in the server console.
        </p>
        <Link
          href="/signin"
          className="mt-8 inline-block text-sm font-medium text-accent hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </Container>
  );
}
