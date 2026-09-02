import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/layout/Container";
import { ProfileSetupForm } from "@/components/auth/ProfileSetupForm";
import { requireAuthContext } from "@/lib/auth/session";
import { suggestedUsernameFromEmail } from "@/lib/auth/profile-link";
import { getSignupPolicyMetadata } from "@/lib/legal/policy-acceptance";
import { ELIGIBILITY_SUMMARY } from "@/lib/legal/eligibility";
import { NO_WAGERING_DISCLAIMER } from "@/lib/company";
import Link from "next/link";
import { policyRoute } from "@/lib/legal/policies";

import { privatePageMetadata } from "@/lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Create your RankEyeQ profile",
  "Choose a username and display name for your UniversalProfile.",
);

export default async function AccountSetupPage() {
  const ctx = await requireAuthContext();
  if (ctx.universalProfile) {
    redirect("/account");
  }

  const signupPolicies = await getSignupPolicyMetadata();

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-lg">
        <h1 className="font-display text-3xl font-semibold text-ink">
          Set up your RankEyeQ profile
        </h1>
        <p className="mt-2 text-sm text-muted">
          This UniversalProfile is your sports identity for rankings and
          leaderboards across RankEyeQ.
        </p>
        <p className="mt-3 text-sm text-muted">{ELIGIBILITY_SUMMARY}</p>
        <p className="mt-2 text-xs text-muted">{NO_WAGERING_DISCLAIMER}</p>
        <p className="mt-2 text-xs text-muted">
          <Link href={policyRoute("eligibility")} className="text-accent hover:underline">
            Eligibility
          </Link>
          {" · "}
          <Link href={policyRoute("responsible-play")} className="text-accent hover:underline">
            Responsible Play
          </Link>
        </p>
        <div className="mt-8">
          <ProfileSetupForm
            defaultUsername={suggestedUsernameFromEmail(ctx.user.email)}
            defaultDisplayName={ctx.user.name ?? ""}
            defaultAvatarUrl={ctx.user.image ?? ""}
            signupPolicies={signupPolicies}
          />
        </div>
      </div>
    </Container>
  );
}
