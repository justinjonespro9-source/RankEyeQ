import { prisma } from "@/lib/db";
import type { ContestPosition, ProfileType } from "@/lib/generated/prisma/client";
import { isExpertProfile } from "@/lib/expert-identity";
import { normalizeUsername, validateDisplayName } from "@/lib/username";

/** Competitive Creator class (distinct from monetization CreatorProfile). */
export const CREATOR_PROFILE_TYPE: ProfileType = "CREATOR";

export function isCreatorCompetitorProfile(profileType: ProfileType): boolean {
  return profileType === "CREATOR";
}

export type CreatorDisplayInput = {
  displayName: string;
  personName?: string | null;
  brandName?: string | null;
};

/** Primary public name: person when present, otherwise profile displayName. */
export function formatCreatorPrimaryName(input: CreatorDisplayInput): string {
  const person = input.personName?.trim();
  if (person) return person;
  return input.displayName.trim();
}

/**
 * Secondary affiliation badge, e.g. "CREATOR · TCO Fantasy Show".
 */
export function formatCreatorAffiliationBadge(
  input: CreatorDisplayInput,
): string | null {
  const brand = input.brandName?.trim();
  if (!brand) return "CREATOR";
  return `CREATOR · ${brand}`;
}

export function creatorPublicLabel(input: CreatorDisplayInput): {
  primaryName: string;
  affiliationBadge: string | null;
} {
  return {
    primaryName: formatCreatorPrimaryName(input),
    affiliationBadge: formatCreatorAffiliationBadge(input),
  };
}

export function parseCreatorPositionsCovered(raw: unknown): ContestPosition[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(["QB", "RB", "WR", "TE", "DEF"]);
  return raw.filter(
    (value): value is ContestPosition =>
      typeof value === "string" && allowed.has(value),
  );
}

export function slugifyCreatorUsername(raw: string): string {
  return normalizeUsername(raw)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

export class CreatorIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreatorIdentityError";
  }
}

export type CreatorIdentityRow = {
  universalProfileId: string;
  username: string;
  displayName: string;
  personName: string | null;
  brandName: string | null;
  sourceUrl: string | null;
  creatorSiteUrl: string | null;
  socialHandle: string | null;
  socialUrl: string | null;
  claimStatus: string;
  avatarUrl: string | null;
  bio: string | null;
  publicVisible: boolean;
  positionsCovered: ContestPosition[];
  active: boolean;
  competitorActive: boolean;
  gradedSubmissions: number;
  primaryName: string;
  affiliationBadge: string | null;
};

export async function listCreatorCompetitorIdentities(): Promise<
  CreatorIdentityRow[]
> {
  const profiles = await prisma.universalProfile.findMany({
    where: { profileType: "CREATOR" },
    include: {
      creatorCompetitor: true,
      submissions: {
        where: { status: "GRADED" },
        select: { id: true },
      },
    },
    orderBy: [{ competitorActive: "desc" }, { displayName: "asc" }],
  });

  return profiles.map((profile) => {
    const personName =
      profile.creatorCompetitor?.personName ?? profile.displayName;
    const brandName = profile.creatorCompetitor?.brandName ?? null;
    const label = creatorPublicLabel({
      displayName: profile.displayName,
      personName,
      brandName,
    });
    return {
      universalProfileId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      personName,
      brandName,
      sourceUrl: profile.creatorCompetitor?.sourceUrl ?? null,
      creatorSiteUrl: profile.creatorCompetitor?.creatorSiteUrl ?? null,
      socialHandle: profile.creatorCompetitor?.socialHandle ?? null,
      socialUrl: profile.creatorCompetitor?.socialUrl ?? null,
      claimStatus: profile.creatorCompetitor?.claimStatus ?? "UNCLAIMED",
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      publicVisible: profile.publicVisible,
      positionsCovered: parseCreatorPositionsCovered(
        profile.creatorCompetitor?.positionsCovered,
      ),
      active: profile.creatorCompetitor?.active ?? true,
      competitorActive: profile.competitorActive,
      gradedSubmissions: profile.submissions.length,
      primaryName: label.primaryName,
      affiliationBadge: label.affiliationBadge,
    };
  });
}

/** Active Creator competitors for weekly coverage / import grids. */
export async function listActiveCreatorCompetitors() {
  return prisma.universalProfile.findMany({
    where: {
      profileType: "CREATOR",
      competitorActive: true,
      status: "ACTIVE",
    },
    include: { creatorCompetitor: true },
    orderBy: { displayName: "asc" },
  });
}

async function upsertCreatorCompetitorMetadata(input: {
  universalProfileId: string;
  personName?: string | null;
  brandName?: string | null;
  sourceUrl?: string | null;
  creatorSiteUrl?: string | null;
  socialHandle?: string | null;
  socialUrl?: string | null;
  positionsCovered?: ContestPosition[];
  active?: boolean;
  notes?: string | null;
  claimStatus?: "UNCLAIMED" | "REQUESTED" | "VERIFIED" | "REJECTED";
}) {
  const existing = await prisma.creatorCompetitorProfile.findUnique({
    where: { universalProfileId: input.universalProfileId },
  });

  const data = {
    personName:
      input.personName !== undefined
        ? input.personName
        : (existing?.personName ?? null),
    brandName:
      input.brandName !== undefined
        ? input.brandName
        : (existing?.brandName ?? null),
    sourceUrl:
      input.sourceUrl !== undefined
        ? input.sourceUrl
        : (existing?.sourceUrl ?? null),
    creatorSiteUrl:
      input.creatorSiteUrl !== undefined
        ? input.creatorSiteUrl
        : (existing?.creatorSiteUrl ?? null),
    socialHandle:
      input.socialHandle !== undefined
        ? input.socialHandle
        : (existing?.socialHandle ?? null),
    socialUrl:
      input.socialUrl !== undefined
        ? input.socialUrl
        : (existing?.socialUrl ?? null),
    positionsCovered:
      input.positionsCovered !== undefined
        ? input.positionsCovered
        : (existing?.positionsCovered ?? []),
    active:
      input.active !== undefined ? input.active : (existing?.active ?? true),
    notes:
      input.notes !== undefined ? input.notes : (existing?.notes ?? null),
    ...(input.claimStatus !== undefined
      ? { claimStatus: input.claimStatus }
      : existing
        ? {}
        : { claimStatus: "UNCLAIMED" as const }),
  };

  if (existing) {
    return prisma.creatorCompetitorProfile.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.creatorCompetitorProfile.create({
    data: {
      universalProfileId: input.universalProfileId,
      ...data,
    },
  });
}

export type UpsertCreatorCompetitorResult = {
  action: "created" | "updated" | "unchanged";
  profile: {
    id: string;
    username: string;
    displayName: string;
    profileType: ProfileType;
    competitorActive: boolean;
  };
};

/**
 * Idempotent Creator competitor upsert by stable username slug.
 * Refuses to convert HUMAN / AI / BENCHMARK profiles (no double-count).
 */
export async function upsertCreatorCompetitor(input: {
  personName: string;
  brandName: string;
  username?: string;
  sourceUrl?: string | null;
  creatorSiteUrl?: string | null;
  socialHandle?: string | null;
  socialUrl?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
  positionsCovered?: ContestPosition[];
  competitorActive?: boolean;
  notes?: string | null;
  acknowledgeDuplicate?: boolean;
}): Promise<UpsertCreatorCompetitorResult> {
  const nameResult = validateDisplayName(input.personName);
  if (!nameResult.ok) throw new CreatorIdentityError(nameResult.error);
  const brand = input.brandName.trim();
  if (brand.length < 2) {
    throw new CreatorIdentityError("Brand / show affiliation is required");
  }

  const username =
    input.username?.trim()
      ? slugifyCreatorUsername(input.username)
      : slugifyCreatorUsername(nameResult.username);
  if (username.length < 3) {
    throw new CreatorIdentityError(
      "Username must be at least 3 characters after normalization",
    );
  }

  const competitorActive = input.competitorActive ?? true;
  const publicVisible = input.publicVisible ?? false;
  const sourceUrl = input.sourceUrl?.trim() || null;
  const creatorSiteUrl = input.creatorSiteUrl?.trim() || null;
  const socialHandle = input.socialHandle?.trim() || null;
  const socialUrl = input.socialUrl?.trim() || null;
  const avatarUrl = input.avatarUrl?.trim() || null;
  const bio = input.bio?.trim() || null;
  const positions = input.positionsCovered ?? [];
  const notes = input.notes ?? null;

  const existing = await prisma.universalProfile.findUnique({
    where: { username },
    include: { creatorCompetitor: true, expertSource: true },
  });

  if (existing) {
    if (existing.profileType !== "CREATOR") {
      const kind = isExpertProfile(existing.profileType)
        ? "Expert"
        : existing.profileType === "AI"
          ? "AI"
          : "Human";
      throw new CreatorIdentityError(
        `Username @${username} already belongs to a ${kind} profile — refusing double-count`,
      );
    }

    const currentPositions = parseCreatorPositionsCovered(
      existing.creatorCompetitor?.positionsCovered,
    );
    const positionsEqual =
      currentPositions.length === positions.length &&
      currentPositions.every((position) => positions.includes(position));

    const unchanged =
      existing.displayName === nameResult.username &&
      existing.competitorActive === competitorActive &&
      existing.publicVisible === publicVisible &&
      existing.status === "ACTIVE" &&
      (existing.avatarUrl ?? null) === avatarUrl &&
      (existing.bio ?? null) === bio &&
      (existing.creatorCompetitor?.personName ?? null) === nameResult.username &&
      (existing.creatorCompetitor?.brandName ?? null) === brand &&
      (existing.creatorCompetitor?.sourceUrl ?? null) === sourceUrl &&
      (existing.creatorCompetitor?.creatorSiteUrl ?? null) === creatorSiteUrl &&
      (existing.creatorCompetitor?.socialHandle ?? null) === socialHandle &&
      (existing.creatorCompetitor?.socialUrl ?? null) === socialUrl &&
      (existing.creatorCompetitor?.active ?? true) === true &&
      positionsEqual &&
      (existing.creatorCompetitor?.notes ?? null) === notes;

    if (unchanged) {
      return {
        action: "unchanged",
        profile: {
          id: existing.id,
          username: existing.username,
          displayName: existing.displayName,
          profileType: existing.profileType,
          competitorActive: existing.competitorActive,
        },
      };
    }

    await prisma.universalProfile.update({
      where: { id: existing.id },
      data: {
        displayName: nameResult.username,
        status: "ACTIVE",
        competitorActive,
        publicVisible,
        avatarUrl,
        bio,
      },
    });
    await upsertCreatorCompetitorMetadata({
      universalProfileId: existing.id,
      personName: nameResult.username,
      brandName: brand,
      sourceUrl,
      creatorSiteUrl,
      socialHandle,
      socialUrl,
      positionsCovered: positions,
      active: true,
      notes,
    });

    return {
      action: "updated",
      profile: {
        id: existing.id,
        username: existing.username,
        displayName: nameResult.username,
        profileType: "CREATOR",
        competitorActive,
      },
    };
  }

  const nameConflicts = await prisma.universalProfile.findMany({
    where: {
      profileType: "CREATOR",
      displayName: { equals: nameResult.username, mode: "insensitive" },
    },
    select: { username: true },
    take: 5,
  });
  if (nameConflicts.length > 0 && !input.acknowledgeDuplicate) {
    throw new CreatorIdentityError(
      `A similar Creator already exists (${nameConflicts
        .map((row) => `@${row.username}`)
        .join(", ")}). Check “Acknowledge existing name” to create anyway.`,
    );
  }

  const profile = await prisma.universalProfile.create({
    data: {
      username,
      displayName: nameResult.username,
      profileType: "CREATOR",
      status: "ACTIVE",
      competitorActive,
      universalUserId: `uu_creator_${username}`,
      publicVisible,
      avatarUrl,
      bio,
    },
  });

  await upsertCreatorCompetitorMetadata({
    universalProfileId: profile.id,
    personName: nameResult.username,
    brandName: brand,
    sourceUrl,
    creatorSiteUrl,
    socialHandle,
    socialUrl,
    positionsCovered: positions,
    active: true,
    notes,
    claimStatus: "UNCLAIMED",
  });

  return {
    action: "created",
    profile: {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      profileType: profile.profileType,
      competitorActive: profile.competitorActive,
    },
  };
}

/**
 * Admin create for a tracked Creator identity.
 * Does NOT verify or claim the profile — claimStatus stays UNCLAIMED.
 */
export async function createCreatorCompetitor(input: {
  personName: string;
  brandName: string;
  username?: string;
  sourceUrl?: string | null;
  creatorSiteUrl?: string | null;
  socialHandle?: string | null;
  socialUrl?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
  positionsCovered?: ContestPosition[];
  competitorActive?: boolean;
  notes?: string | null;
  acknowledgeDuplicate?: boolean;
}) {
  const result = await upsertCreatorCompetitor(input);
  if (result.action !== "created") {
    throw new CreatorIdentityError(
      `Username @${result.profile.username} is already taken`,
    );
  }
  return result.profile;
}

export async function updateCreatorCompetitorMetadata(input: {
  universalProfileId: string;
  personName?: string;
  brandName?: string;
  sourceUrl?: string | null;
  creatorSiteUrl?: string | null;
  socialHandle?: string | null;
  socialUrl?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
  positionsCovered?: ContestPosition[];
  notes?: string | null;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    include: { creatorCompetitor: true },
  });
  if (!profile || profile.profileType !== "CREATOR") {
    throw new CreatorIdentityError("Creator competitor profile not found");
  }

  let displayName = profile.displayName;
  const profileData: {
    displayName?: string;
    avatarUrl?: string | null;
    bio?: string | null;
    publicVisible?: boolean;
  } = {};

  if (input.personName != null) {
    const nameResult = validateDisplayName(input.personName);
    if (!nameResult.ok) throw new CreatorIdentityError(nameResult.error);
    displayName = nameResult.username;
    profileData.displayName = displayName;
  }
  if (input.avatarUrl !== undefined) {
    profileData.avatarUrl = input.avatarUrl?.trim() || null;
  }
  if (input.bio !== undefined) {
    profileData.bio = input.bio?.trim() || null;
  }
  if (input.publicVisible !== undefined) {
    profileData.publicVisible = input.publicVisible;
  }

  if (Object.keys(profileData).length > 0) {
    await prisma.universalProfile.update({
      where: { id: profile.id },
      data: profileData,
    });
  }

  await upsertCreatorCompetitorMetadata({
    universalProfileId: profile.id,
    personName: input.personName != null ? displayName : undefined,
    brandName: input.brandName,
    sourceUrl: input.sourceUrl,
    creatorSiteUrl: input.creatorSiteUrl,
    socialHandle: input.socialHandle,
    socialUrl: input.socialUrl,
    positionsCovered: input.positionsCovered,
    notes: input.notes,
  });

  return prisma.universalProfile.findUniqueOrThrow({
    where: { id: profile.id },
    include: { creatorCompetitor: true },
  });
}

/** Directory + competitor activation without deleting historical Creator rows. */
export async function setCreatorDirectoryActive(input: {
  universalProfileId: string;
  active: boolean;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    include: { creatorCompetitor: true },
  });
  if (!profile || profile.profileType !== "CREATOR") {
    throw new CreatorIdentityError("Creator competitor profile not found");
  }

  await prisma.universalProfile.update({
    where: { id: profile.id },
    data: { competitorActive: input.active },
  });

  await upsertCreatorCompetitorMetadata({
    universalProfileId: profile.id,
    active: input.active,
    personName: profile.creatorCompetitor?.personName ?? profile.displayName,
    brandName: profile.creatorCompetitor?.brandName ?? null,
  });

  return { id: profile.id, active: input.active };
}
