import { submissionIsEligible } from "@/lib/contest-lifecycle";
import {
  profileContributesToPublicConsensus,
  weekIsPubliclyVisibleForProfile,
  type WeekVisibilityFields,
} from "@/lib/competitor-visibility";
import {
  isAnalystExpertSource,
  isPublisherConsensusSource,
} from "@/lib/expert-identity";
import type {
  ProfileType,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

export type ConsensusFilter =
  | "ALL"
  | "HUMAN"
  | "AI"
  | "EXPERT"
  | "CREATOR"
  | "PUBLISHER";

/**
 * Official ballots only — drafts and empty shells never count toward consensus.
 * Qualifying statuses: SUBMITTED | LOCKED | GRADED, with at least one pick.
 *
 * PRIVATE_TRACKED Experts/Creators (competitorActive && !publicVisible) never
 * contribute to any public consensus segment.
 *
 * When publicFromWeekId is set, only weeks on/after that gate contribute.
 *
 * EXPERT = individual analyst BENCHMARK boards only.
 * PUBLISHER = Publisher Consensus boards only.
 * Publisher Consensus never feeds ballot_union All (HUMAN+AI) or group-weighted All.
 */
export function filterEligibleConsensusSubmissions<
  T extends {
    status: SubmissionStatus;
    profileType: ProfileType;
    sourceKind?: string | null;
    picks?: readonly unknown[];
    competitorActive?: boolean;
    publicVisible?: boolean;
    publicFromWeekId?: string | null;
    publicFromWeek?: WeekVisibilityFields | null;
    week?: WeekVisibilityFields | null;
  },
>(submissions: T[], filter: ConsensusFilter = "ALL"): T[] {
  return submissions.filter((submission) => {
    if (!submissionIsEligible(submission.status)) return false;
    // When picks are provided, empty shells are excluded. Call sites that load
    // submissions always include picks; unit fixtures may omit the field.
    if ("picks" in submission) {
      if (!Array.isArray(submission.picks) || submission.picks.length === 0) {
        return false;
      }
    }

    // Default missing flags to public-eligible for legacy unit fixtures.
    const competitorActive = submission.competitorActive ?? true;
    const publicVisible = submission.publicVisible ?? true;
    const visibility = {
      profileType: submission.profileType,
      competitorActive,
      publicVisible,
      publicFromWeekId: submission.publicFromWeekId ?? null,
      publicFromWeek: submission.publicFromWeek ?? null,
    };
    if (!profileContributesToPublicConsensus(visibility)) {
      return false;
    }
    if (visibility.publicFromWeekId) {
      if (!submission.week) return false;
      if (!weekIsPubliclyVisibleForProfile(visibility, submission.week)) {
        return false;
      }
    }

    if (filter === "HUMAN") return submission.profileType === "HUMAN";
    if (filter === "AI") return submission.profileType === "AI";
    if (filter === "CREATOR") return submission.profileType === "CREATOR";
    if (filter === "EXPERT") {
      return (
        submission.profileType === "BENCHMARK" &&
        isAnalystExpertSource(submission.sourceKind)
      );
    }
    if (filter === "PUBLISHER") {
      return (
        submission.profileType === "BENCHMARK" &&
        isPublisherConsensusSource(submission.sourceKind)
      );
    }
    // ballot_union All: HUMAN + AI only (Experts/Creators via group_weighted;
    // Publisher Consensus never included).
    return (
      submission.profileType === "HUMAN" || submission.profileType === "AI"
    );
  });
}
