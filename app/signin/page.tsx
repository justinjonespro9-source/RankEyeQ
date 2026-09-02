import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Container } from "@/components/layout/Container";
import { SignInForm } from "@/components/auth/SignInForm";

import { privatePageMetadata } from "@/lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Sign In",
  "Sign in to RankEyeQ to save and submit weekly NFL slate rankings.",
);

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = params.callbackUrl || "/rank";

  if (session?.user) {
    redirect(
      session.user.universalProfileId ? callbackUrl : "/account/setup",
    );
  }

  const googleEnabled = Boolean(
    process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
  );

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-3xl font-semibold text-ink">
          Sign in to RankEyeQ
        </h1>
        <p className="mt-2 text-sm text-muted">
          Browse weekly contests publicly. Sign in to save and submit this
          week&apos;s rankings on your UniversalProfile.
        </p>
        {params.error ? (
          <p className="mt-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
            Sign-in failed. Try again or use a different method.
          </p>
        ) : null}
        <div className="mt-8">
          <SignInForm
            callbackUrl={callbackUrl}
            googleEnabled={googleEnabled}
          />
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/" className="text-accent hover:underline">
            Back to homepage
          </Link>
        </p>
      </div>
    </Container>
  );
}
