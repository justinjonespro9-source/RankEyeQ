import { prisma } from "@/lib/db";
import {
  OFFICIAL_AI_USERNAMES,
  RETIRED_AI_USERNAMES,
} from "@/lib/ai-competitors";
import { validateAdminUsername } from "@/lib/admin/users";
import type { ProfileType } from "@/lib/generated/prisma/client";
import { validateDisplayName } from "@/lib/username";

export class AiIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiIdentityError";
  }
}

export type AiIdentityRow = {
  universalProfileId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  publicVisible: boolean;
  competitorActive: boolean;
  status: string;
  isOfficial: boolean;
  gradedSubmissions: number;
};

export async function listAiCompetitorIdentities(): Promise<AiIdentityRow[]> {
  const profiles = await prisma.universalProfile.findMany({
    where: { profileType: "AI" },
    include: {
      submissions: {
        where: { status: "GRADED" },
        select: { id: true },
      },
    },
    orderBy: [{ competitorActive: "desc" }, { displayName: "asc" }],
  });

  return profiles.map((profile) => ({
    universalProfileId: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    publicVisible: profile.publicVisible,
    competitorActive: profile.competitorActive,
    status: profile.status,
    isOfficial: OFFICIAL_AI_USERNAMES.has(profile.username),
    gradedSubmissions: profile.submissions.length,
  }));
}

/** Active AI competitors for weekly coverage / import grids. */
export async function listActiveAiCompetitorsForAdmin() {
  return prisma.universalProfile.findMany({
    where: {
      profileType: "AI",
      competitorActive: true,
      status: "ACTIVE",
    },
    orderBy: { displayName: "asc" },
  });
}

export async function findCompetitorDisplayNameConflicts(input: {
  displayName: string;
  profileType: ProfileType;
  excludeProfileId?: string;
}) {
  const name = input.displayName.trim();
  if (name.length < 2) return [];
  return prisma.universalProfile.findMany({
    where: {
      profileType: input.profileType,
      displayName: { equals: name, mode: "insensitive" },
      ...(input.excludeProfileId
        ? { id: { not: input.excludeProfileId } }
        : {}),
    },
    select: { id: true, username: true, displayName: true },
    take: 5,
  });
}

/**
 * Admin create for an AI competition identity.
 * Does not require API credentials. Defaults competitorActive=true.
 */
export async function createAiCompetitor(input: {
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  bio?: string | null;
  competitorActive?: boolean;
  publicVisible?: boolean;
  acknowledgeDuplicate?: boolean;
}) {
  const displayResult = validateDisplayName(input.displayName);
  if (!displayResult.ok) throw new AiIdentityError(displayResult.error);

  const usernameResult = validateAdminUsername(input.username, {
    allowAiReserved: true,
  });
  if (!usernameResult.ok) throw new AiIdentityError(usernameResult.error);

  if (RETIRED_AI_USERNAMES.has(usernameResult.username)) {
    throw new AiIdentityError(
      `Username @${usernameResult.username} is permanently retired`,
    );
  }

  const exists = await prisma.universalProfile.findUnique({
    where: { username: usernameResult.username },
  });
  if (exists) {
    throw new AiIdentityError(
      `Username @${usernameResult.username} is already taken`,
    );
  }

  const conflicts = await findCompetitorDisplayNameConflicts({
    displayName: displayResult.username,
    profileType: "AI",
  });
  if (conflicts.length > 0 && !input.acknowledgeDuplicate) {
    const sample = conflicts
      .map((row) => `@${row.username}`)
      .join(", ");
    throw new AiIdentityError(
      `A similar AI competitor already exists (${sample}). Check “Acknowledge existing name” to create anyway.`,
    );
  }

  const competitorActive = input.competitorActive ?? true;
  const publicVisible = input.publicVisible ?? true;
  const avatarUrl = input.avatarUrl?.trim() || null;
  const bio = input.bio?.trim() || null;

  return prisma.universalProfile.create({
    data: {
      username: usernameResult.username,
      displayName: displayResult.username,
      avatarUrl,
      bio,
      profileType: "AI",
      status: "ACTIVE",
      competitorActive,
      publicVisible,
      universalUserId: `uu_bot_${usernameResult.username}`,
    },
  });
}

export async function updateAiCompetitorMetadata(input: {
  universalProfileId: string;
  displayName?: string;
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
  });
  if (!profile || profile.profileType !== "AI") {
    throw new AiIdentityError("AI competitor profile not found");
  }

  const data: {
    displayName?: string;
    avatarUrl?: string | null;
    bio?: string | null;
    publicVisible?: boolean;
  } = {};

  if (input.displayName != null) {
    const displayResult = validateDisplayName(input.displayName);
    if (!displayResult.ok) throw new AiIdentityError(displayResult.error);
    data.displayName = displayResult.username;
  }
  if (input.avatarUrl !== undefined) {
    data.avatarUrl = input.avatarUrl?.trim() || null;
  }
  if (input.bio !== undefined) {
    data.bio = input.bio?.trim() || null;
  }
  if (input.publicVisible !== undefined) {
    data.publicVisible = input.publicVisible;
  }

  return prisma.universalProfile.update({
    where: { id: profile.id },
    data,
  });
}

/** Deactivate/activate without deleting historical AI submissions. */
export async function setAiDirectoryActive(input: {
  universalProfileId: string;
  active: boolean;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
  });
  if (!profile || profile.profileType !== "AI") {
    throw new AiIdentityError("AI competitor profile not found");
  }

  return prisma.universalProfile.update({
    where: { id: profile.id },
    data: { competitorActive: input.active },
  });
}
