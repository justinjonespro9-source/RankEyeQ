import type { WaiverSubmissionStatus } from "@/lib/generated/prisma/client";
import { isWaiverRevealAllowed } from "@/lib/waivers/lock-time";

export type WaiverBoardViewer = {
  profileId: string | null;
  /** Admins receive no content access before lock; counts only. */
  isAdmin: boolean;
};

/**
 * Who may see a Waiver board's calls. The owner always sees their own board.
 * Everyone else — competitors, the public and admins alike — sees nothing
 * before lock, and after lock only competitively submitted boards. Drafts
 * stay private forever.
 */
export function canViewWaiverBoardContents(input: {
  viewer: WaiverBoardViewer;
  ownerProfileId: string;
  submissionStatus: WaiverSubmissionStatus;
  locksAt: Date;
  now: Date;
}): boolean {
  if (input.viewer.profileId !== null && input.viewer.profileId === input.ownerProfileId) {
    return true;
  }
  if (!isWaiverRevealAllowed(input.locksAt, input.now)) return false;
  return input.submissionStatus === "SUBMITTED" || input.submissionStatus === "LOCKED";
}
