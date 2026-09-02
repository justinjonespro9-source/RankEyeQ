import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/layout/Container";
import { AccountProfileForm } from "@/components/auth/AccountProfileForm";
import { CreatorAccountSection } from "@/components/social/CreatorAccountSection";
import { requireAuthContext } from "@/lib/auth/session";
import { getActiveSeasonAndWeek } from "@/lib/leaderboards";
import { evaluateProfileQualification } from "@/lib/social/creator";
import { prisma } from "@/lib/db";

import { privatePageMetadata } from "@/lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Account",
  "Manage your RankEyeQ UniversalProfile public fields.",
);

export default async function AccountPage() {
  const ctx = await requireAuthContext();
  if (!ctx.universalProfile) {
    redirect("/account/setup");
  }

  const profile = ctx.universalProfile;
  const [qualification, context] = await Promise.all([
    evaluateProfileQualification(profile.id),
    getActiveSeasonAndWeek(),
  ]);

  const currentWeekBoards = context?.week
    ? await prisma.rankingSubmission.findMany({
        where: {
          universalProfileId: profile.id,
          contest: { weekId: context.week.id },
        },
        include: { contest: true },
        orderBy: { contest: { position: "asc" } },
      })
    : [];

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-lg">
        <h1 className="font-display text-3xl font-semibold text-ink">Account</h1>
        <p className="mt-2 text-sm text-muted">
          Signed in as {ctx.user.email}. Edit public profile fields only —
          scores and AI status are not editable here.
        </p>
        <p className="mt-3 text-sm">
          <Link
            href={`/profile/${profile.username}`}
            className="font-medium text-accent hover:underline"
          >
            View public profile
          </Link>
          {" · "}
          <Link href="/creator" className="font-medium text-accent hover:underline">
            Creator dashboard
          </Link>
        </p>
        <div className="mt-8">
          <AccountProfileForm
            username={profile.username}
            displayName={profile.displayName}
            avatarUrl={profile.avatarUrl ?? ""}
          />
        </div>
        <CreatorAccountSection
          status={qualification.status}
          eligible={qualification.eligible}
          reasons={qualification.reasons}
          enabled={qualification.status === "ENABLED"}
          defaultRevealPreference={qualification.defaultRevealPreference}
          gradedContestCount={qualification.gradedContestCount}
          minGradedContests={qualification.rules.minGradedContests}
          currentWeekBoards={currentWeekBoards.map((board) => ({
            contestId: board.contestId,
            position: board.contest.position,
            status: board.status,
            revealPreference: board.revealPreference,
          }))}
        />
      </div>
    </Container>
  );
}
