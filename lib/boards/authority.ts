import { canSubmitFromRankingWorkspace } from "@/lib/auth/participation";
import { prisma } from "@/lib/db";
import type {
  Prisma,
  ProfileType,
  SubmissionAuthority,
} from "@/lib/generated/prisma/client";

export type { SubmissionAuthority };

/** Authorities a ranking-workspace style save may stamp (never client-chosen). */
export type WorkspaceSaveAuthority = Extract<
  SubmissionAuthority,
  "OWNER_AUTHORED" | "SYSTEM_OPERATED"
>;

export type BoardAuthorityEvidence = {
  authority: SubmissionAuthority | null;
  picks: ReadonlyArray<{ sourceRank: number | null }>;
};

export class BoardAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardAuthorityError";
  }
}

export const OWNER_MANAGED_CAPTURE_MESSAGE =
  "Owner-managed board — RankEyeQ capture is disabled for this contest.";
export const CAPTURED_BOARD_WORKSPACE_MESSAGE =
  "This contest's board was captured by RankEyeQ from your published rankings, so it can't be edited here. You can rank contests that don't already have a captured board.";

/**
 * Legacy (NULL authority) rows: captured picks always carry sourceRank;
 * workspace and AI picks never do (validated against Production before the
 * authority column existed). Mixed or unexpected shapes return null
 * (ambiguous) so callers can fail closed.
 */
export function inferLegacySubmissionAuthority(input: {
  profileType: ProfileType;
  picks: ReadonlyArray<{ sourceRank: number | null }>;
}): SubmissionAuthority | null {
  if (input.picks.length === 0) return null;
  const withSource = input.picks.filter((pick) => pick.sourceRank != null).length;
  if (withSource === input.picks.length) return "RANKEYEQ_CAPTURED";
  if (withSource > 0) return null;
  if (input.profileType === "AI") return "SYSTEM_OPERATED";
  if (input.profileType === "HUMAN" || input.profileType === "CREATOR") {
    return "OWNER_AUTHORED";
  }
  return null;
}

/** Stored authority, else legacy inference. null = no board content or ambiguous. */
export function resolveSubmissionAuthority(input: {
  profileType: ProfileType;
  submission: BoardAuthorityEvidence | null;
}): SubmissionAuthority | null {
  if (!input.submission) return null;
  return (
    input.submission.authority ??
    inferLegacySubmissionAuthority({
      profileType: input.profileType,
      picks: input.submission.picks,
    })
  );
}

function isAmbiguousLegacyBoard(input: {
  profileType: ProfileType;
  submission: BoardAuthorityEvidence | null;
}) {
  return (
    input.submission != null &&
    input.submission.authority == null &&
    input.submission.picks.length > 0 &&
    inferLegacySubmissionAuthority({
      profileType: input.profileType,
      picks: input.submission.picks,
    }) == null
  );
}

/**
 * A profile whose owner can author through the ranking workspace (linked User
 * + HUMAN/CREATOR). Claimed BENCHMARK stays capture-managed.
 */
export function isOwnerManagedProfile(input: {
  profileType: ProfileType;
  hasLinkedUser: boolean;
}) {
  return input.hasLinkedUser && canSubmitFromRankingWorkspace(input.profileType);
}

export type CaptureAuthorityDecision =
  | { allowed: true; boardAuthority: SubmissionAuthority | null }
  | {
      allowed: false;
      reason:
        | "owner_authored_board"
        | "owner_managed_profile"
        | "system_operated_board"
        | "ambiguous_legacy_board";
      boardAuthority: SubmissionAuthority | null;
      message: string;
    };

/**
 * Canonical guard for every admin capture mutation that can create, replace,
 * hide or restrict a competitive board (capture, official upsert, NOT_AVAILABLE).
 */
export function evaluateCaptureAuthority(input: {
  profileType: ProfileType;
  hasLinkedUser: boolean;
  submission: BoardAuthorityEvidence | null;
}): CaptureAuthorityDecision {
  const boardAuthority = resolveSubmissionAuthority(input);
  if (boardAuthority === "OWNER_AUTHORED") {
    return {
      allowed: false,
      reason: "owner_authored_board",
      boardAuthority,
      message: OWNER_MANAGED_CAPTURE_MESSAGE,
    };
  }
  if (boardAuthority === "SYSTEM_OPERATED") {
    return {
      allowed: false,
      reason: "system_operated_board",
      boardAuthority,
      message: "This contest board is system-operated and cannot be captured.",
    };
  }
  if (isAmbiguousLegacyBoard(input)) {
    return {
      allowed: false,
      reason: "ambiguous_legacy_board",
      boardAuthority,
      message:
        "Board authority could not be established from existing evidence — capture refused.",
    };
  }
  if (isOwnerManagedProfile(input) && boardAuthority !== "RANKEYEQ_CAPTURED") {
    return {
      allowed: false,
      reason: "owner_managed_profile",
      boardAuthority,
      message: OWNER_MANAGED_CAPTURE_MESSAGE,
    };
  }
  return { allowed: true, boardAuthority };
}

export type WorkspaceAuthorityDecision =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * Ranking-workspace style saves (owner workspace, admin AI board tools) may
 * only write a board that is empty or already under the same authority.
 */
export function evaluateWorkspaceSaveAuthority(input: {
  requested: WorkspaceSaveAuthority;
  profileType: ProfileType;
  submission: BoardAuthorityEvidence | null;
}): WorkspaceAuthorityDecision {
  if (
    input.requested === "OWNER_AUTHORED" &&
    !canSubmitFromRankingWorkspace(input.profileType)
  ) {
    return {
      allowed: false,
      message: "This profile cannot author boards from the ranking workspace.",
    };
  }
  if (input.requested === "SYSTEM_OPERATED" && input.profileType !== "AI") {
    return {
      allowed: false,
      message: "System-operated boards require an AI profile.",
    };
  }
  if (isAmbiguousLegacyBoard(input)) {
    return {
      allowed: false,
      message:
        "Board authority could not be established from existing evidence — save refused.",
    };
  }
  const existing = resolveSubmissionAuthority(input);
  if (existing == null || existing === input.requested) return { allowed: true };
  if (existing === "RANKEYEQ_CAPTURED") {
    return { allowed: false, message: CAPTURED_BOARD_WORKSPACE_MESSAGE };
  }
  return {
    allowed: false,
    message: "This board is managed under a different authority.",
  };
}

type Db = Prisma.TransactionClient | typeof prisma;

export async function loadCaptureAuthorityDecision(
  input: { contestId: string; universalProfileId: string },
  db: Db = prisma,
): Promise<CaptureAuthorityDecision | null> {
  // Sequential: may run on a single transaction connection.
  const profile = await db.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    select: { profileType: true, authUser: { select: { id: true } } },
  });
  if (!profile) return null;
  const submission = await db.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId: input.contestId,
        universalProfileId: input.universalProfileId,
      },
    },
    select: { authority: true, picks: { select: { sourceRank: true } } },
  });
  return evaluateCaptureAuthority({
    profileType: profile.profileType,
    hasLinkedUser: profile.authUser != null,
    submission,
  });
}
