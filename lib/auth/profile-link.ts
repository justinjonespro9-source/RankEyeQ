import { prisma } from "@/lib/db";
import {
  normalizeUsername,
  validateDisplayName,
  validateUsername,
} from "@/lib/username";

export class ProfileLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileLinkError";
  }
}

export type ProfileSetupInput = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

/**
 * First-login profile creation. Idempotent: if the user already has a
 * UniversalProfile, returns it without creating another.
 */
export async function createOrResolveUniversalProfile(
  input: ProfileSetupInput,
) {
  const existingUser = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { universalProfile: true },
  });
  if (!existingUser) {
    throw new ProfileLinkError("Auth user not found");
  }
  if (existingUser.universalProfile) {
    return existingUser.universalProfile;
  }

  const usernameResult = validateUsername(input.username);
  if (!usernameResult.ok) {
    throw new ProfileLinkError(usernameResult.error);
  }
  const displayResult = validateDisplayName(input.displayName);
  if (!displayResult.ok) {
    throw new ProfileLinkError(displayResult.error);
  }

  const username = usernameResult.username;
  const displayName = displayResult.username;
  const avatarUrl = input.avatarUrl?.trim() || existingUser.image || null;

  const taken = await prisma.universalProfile.findUnique({
    where: { username },
  });
  if (taken) {
    throw new ProfileLinkError("That username is already taken.");
  }

  return prisma.$transaction(async (tx) => {
    // Re-check link inside transaction to avoid duplicates on concurrent setup.
    // Avoid include-on-write/tx join fan-out (pg concurrent query on one Client).
    const again = await tx.user.findUnique({
      where: { id: input.userId },
      select: { universalProfileId: true },
    });
    if (again?.universalProfileId) {
      return tx.universalProfile.findUniqueOrThrow({
        where: { id: again.universalProfileId },
      });
    }

    const profile = await tx.universalProfile.create({
      data: {
        username,
        displayName,
        avatarUrl,
        profileType: "HUMAN",
      },
    });

    await tx.user.update({
      where: { id: input.userId },
      data: { universalProfileId: profile.id },
    });

    return profile;
  });
}

export type ProfileEditInput = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

/** Owner-only public field updates. Never changes profileType or scores. */
export async function updateOwnedUniversalProfile(input: ProfileEditInput) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { universalProfile: true },
  });
  if (!user?.universalProfile) {
    throw new ProfileLinkError("Complete profile setup first.");
  }
  if (user.universalProfile.profileType !== "HUMAN") {
    throw new ProfileLinkError(
      "AI and benchmark profiles are admin-managed and cannot sign in.",
    );
  }

  const usernameResult = validateUsername(input.username);
  if (!usernameResult.ok) {
    throw new ProfileLinkError(usernameResult.error);
  }
  const displayResult = validateDisplayName(input.displayName);
  if (!displayResult.ok) {
    throw new ProfileLinkError(displayResult.error);
  }

  const username = usernameResult.username;
  if (username !== user.universalProfile.username) {
    const taken = await prisma.universalProfile.findUnique({
      where: { username },
    });
    if (taken && taken.id !== user.universalProfile.id) {
      throw new ProfileLinkError("That username is already taken.");
    }
  }

  const avatarUrl =
    input.avatarUrl === undefined
      ? user.universalProfile.avatarUrl
      : input.avatarUrl?.trim() || null;

  return prisma.universalProfile.update({
    where: { id: user.universalProfile.id },
    data: {
      username,
      displayName: displayResult.username,
      avatarUrl,
    },
  });
}

export function suggestedUsernameFromEmail(email: string | null | undefined) {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  return normalizeUsername(local.replace(/[^a-z0-9_]/gi, "_")).slice(0, 24);
}
