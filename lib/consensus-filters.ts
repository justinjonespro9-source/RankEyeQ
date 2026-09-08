import { submissionIsEligible } from "@/lib/contest-lifecycle";
import type {
  ProfileType,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

export type ConsensusFilter = "ALL" | "HUMAN" | "AI" | "EXPERT" | "CREATOR";

/** Official ballots only — drafts never count toward consensus. */
export function filterEligibleConsensusSubmissions<
  T extends { status: SubmissionStatus; profileType: ProfileType },
>(submissions: T[], filter: ConsensusFilter = "ALL"): T[] {
  return submissions.filter((submission) => {
    if (!submissionIsEligible(submission.status)) return false;
    if (filter === "HUMAN") return submission.profileType === "HUMAN";
    if (filter === "AI") return submission.profileType === "AI";
    if (filter === "EXPERT") return submission.profileType === "BENCHMARK";
    if (filter === "CREATOR") return submission.profileType === "CREATOR";
    // ballot_union All: HUMAN + AI official ballots only (Experts/Creators via group_weighted).
    return (
      submission.profileType === "HUMAN" || submission.profileType === "AI"
    );
  });
}
