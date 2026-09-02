import type { Metadata } from "next";
import { Container } from "@/components/layout/Container";
import { PositionChallengeCard } from "@/components/rank/PositionChallengeCard";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getActiveProfile } from "@/lib/active-profile";
import { CONTEST_ELIGIBILITY } from "@/lib/contest";
import { getPublicWeeklyChallenges } from "@/lib/contests";
import { getHomepageData } from "@/lib/homepage";
import {
  WEEKLY_RANKINGS_EXPLAINER,
  WEEKLY_RANKINGS_SHORT,
} from "@/lib/weekly-messaging";

export const metadata: Metadata = {
  title: "Weekly Rankings",
  description:
    "Rank this week's NFL slate by position before kickoff. Weekly contests graded against actual fantasy-point finishes — not draft or season-long projections.",
};

export const dynamic = "force-dynamic";

export default async function RankHubPage() {
  const activeProfile = await getActiveProfile();
  const [challenges, homepage] = await Promise.all([
    getPublicWeeklyChallenges(),
    getHomepageData(activeProfile?.id),
  ]);

  const byPosition = new Map(
    homepage.challenges.map((challenge) => [challenge.position, challenge]),
  );
  const fromDatabase = challenges.some(
    (challenge) => challenge.source === "database",
  );

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Weekly hub"
        title="Rank this week's slate"
        description={`${WEEKLY_RANKINGS_SHORT} ${CONTEST_ELIGIBILITY}`}
        action={
          <Badge tone={fromDatabase ? "success" : "warning"}>
            {fromDatabase ? "Live contests" : "No live contests"}
          </Badge>
        }
      />
      {challenges.length === 0 ? (
        <EmptyState
          title="No challenges this week"
          description={`${WEEKLY_RANKINGS_EXPLAINER} Contests appear here when the active NFL week is configured.`}
          actionHref="/how-it-works"
          actionLabel="How RankEyeQ works"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {challenges.map((challenge) => {
            const live = byPosition.get(challenge.position);
            return (
              <PositionChallengeCard
                key={challenge.contestId ?? challenge.position}
                challenge={challenge}
                contestStatus={live?.contestStatus ?? challenge.dbStatus}
                submittedCount={live?.submittedCount}
                profileSubmissionStatus={live?.profileSubmissionStatus ?? null}
                resultsHref={
                  challenge.contestId
                    ? `/results?contestId=${challenge.contestId}`
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </Container>
  );
}
