import { prisma } from "@/lib/db";
import type { ContestPosition, ProfileType } from "@/lib/generated/prisma/client";
import { isOfficialBenchmarkUsername } from "@/lib/benchmark-sources";
import { normalizeUsername, validateDisplayName } from "@/lib/username";

/** UI label for BENCHMARK profile type. */
export const EXPERT_PROFILE_TYPE: ProfileType = "BENCHMARK";

export const EXPERT_SOURCE_KIND = {
  ANALYST: "ANALYST",
  PUBLISHER: "PUBLISHER",
  SITE_CONSENSUS: "SITE_CONSENSUS",
} as const;

export type ExpertSourceKind =
  (typeof EXPERT_SOURCE_KIND)[keyof typeof EXPERT_SOURCE_KIND];

export function isExpertProfile(profileType: ProfileType): boolean {
  return profileType === "BENCHMARK";
}

export type ExpertIdentityRow = {
  universalProfileId: string;
  username: string;
  displayName: string;
  publicationName: string | null;
  analystName: string | null;
  sourceUrl: string | null;
  sourceKind: string;
  positionsCovered: ContestPosition[];
  active: boolean;
  competitorActive: boolean;
  isOfficialSource: boolean;
  gradedSubmissions: number;
  primaryName: string;
  affiliationBadge: string | null;
};

export type ExpertDisplayInput = {
  displayName: string;
  analystName?: string | null;
  publicationName?: string | null;
  sourceKind?: string | null;
};

/** Primary public name: analyst when present, otherwise profile displayName. */
export function formatExpertPrimaryName(input: ExpertDisplayInput): string {
  const analyst = input.analystName?.trim();
  if (analyst) return analyst;
  return input.displayName.trim();
}

/**
 * Secondary affiliation badge, e.g. "EXPERT · Yahoo Fantasy".
 * Publisher-only / staff consensus shells still get EXPERT · {publication|display}.
 */
export function formatExpertAffiliationBadge(
  input: ExpertDisplayInput,
): string | null {
  const publication =
    input.publicationName?.trim() ||
    (input.sourceKind === EXPERT_SOURCE_KIND.ANALYST
      ? null
      : input.displayName.trim());
  if (!publication) return "EXPERT";
  return `EXPERT · ${publication}`;
}

export function expertPublicLabel(input: ExpertDisplayInput): {
  primaryName: string;
  affiliationBadge: string | null;
} {
  return {
    primaryName: formatExpertPrimaryName(input),
    affiliationBadge: formatExpertAffiliationBadge(input),
  };
}

export function parsePositionsCovered(raw: unknown): ContestPosition[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(["QB", "RB", "WR", "TE", "DEF"]);
  return raw.filter(
    (value): value is ContestPosition =>
      typeof value === "string" && allowed.has(value),
  );
}

export function slugifyExpertUsername(raw: string): string {
  return normalizeUsername(raw)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

export class ExpertIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpertIdentityError";
  }
}

export async function listExpertIdentities(): Promise<ExpertIdentityRow[]> {
  const profiles = await prisma.universalProfile.findMany({
    where: { profileType: "BENCHMARK" },
    include: {
      expertSource: true,
      submissions: {
        where: { status: "GRADED" },
        select: { id: true },
      },
    },
    orderBy: [{ competitorActive: "desc" }, { displayName: "asc" }],
  });

  return profiles.map((profile) => {
    const publicationName =
      profile.expertSource?.publicationName ?? profile.displayName;
    const analystName = profile.expertSource?.analystName ?? null;
    const sourceKind = profile.expertSource?.sourceKind ?? "PUBLISHER";
    const label = expertPublicLabel({
      displayName: profile.displayName,
      analystName,
      publicationName,
      sourceKind,
    });
    return {
      universalProfileId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      publicationName,
      analystName,
      sourceUrl: profile.expertSource?.sourceUrl ?? null,
      sourceKind,
      positionsCovered: parsePositionsCovered(
        profile.expertSource?.positionsCovered,
      ),
      active: profile.expertSource?.active ?? true,
      competitorActive: profile.competitorActive,
      isOfficialSource: isOfficialBenchmarkUsername(profile.username),
      gradedSubmissions: profile.submissions.length,
      primaryName: label.primaryName,
      affiliationBadge: label.affiliationBadge,
    };
  });
}

export async function upsertExpertSourceProfile(input: {
  universalProfileId: string;
  publicationName?: string | null;
  analystName?: string | null;
  sourceUrl?: string | null;
  sourceKind?: string;
  positionsCovered?: ContestPosition[] | null;
  active?: boolean;
  notes?: string | null;
}) {
  const positionsJson =
    input.positionsCovered && input.positionsCovered.length > 0
      ? input.positionsCovered
      : input.positionsCovered === null
        ? []
        : undefined;

  return prisma.expertSourceProfile.upsert({
    where: { universalProfileId: input.universalProfileId },
    update: {
      publicationName: input.publicationName ?? undefined,
      analystName: input.analystName ?? undefined,
      sourceUrl: input.sourceUrl ?? undefined,
      sourceKind: input.sourceKind ?? undefined,
      positionsCovered: positionsJson,
      active: input.active ?? undefined,
      notes: input.notes ?? undefined,
    },
    create: {
      universalProfileId: input.universalProfileId,
      publicationName: input.publicationName ?? null,
      analystName: input.analystName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      sourceKind: input.sourceKind ?? EXPERT_SOURCE_KIND.PUBLISHER,
      positionsCovered: positionsJson ?? undefined,
      active: input.active ?? true,
      notes: input.notes ?? null,
    },
  });
}

export async function ensureExpertSourceMetadata(input: {
  universalProfileId: string;
  displayName: string;
  publicationName?: string;
  sourceKind?: string;
  active?: boolean;
}) {
  const existing = await prisma.expertSourceProfile.findUnique({
    where: { universalProfileId: input.universalProfileId },
  });
  if (existing) {
    return prisma.expertSourceProfile.update({
      where: { id: existing.id },
      data: {
        publicationName:
          input.publicationName ?? existing.publicationName ?? input.displayName,
        sourceKind: input.sourceKind ?? existing.sourceKind,
        active: input.active ?? existing.active,
      },
    });
  }

  return upsertExpertSourceProfile({
    universalProfileId: input.universalProfileId,
    publicationName: input.publicationName ?? input.displayName,
    sourceKind: input.sourceKind ?? EXPERT_SOURCE_KIND.PUBLISHER,
    active: input.active ?? true,
  });
}

/**
 * Create an individual analyst Expert identity (BENCHMARK profile).
 * Does not create publisher-level ballots. Historical publisher shells stay separate.
 * Fails if the username already exists (use upsertExpertAnalyst for idempotent seeding).
 */
export async function createExpertAnalyst(input: {
  analystName: string;
  publicationName: string;
  username?: string;
  sourceUrl?: string | null;
  positionsCovered?: ContestPosition[];
  competitorActive?: boolean;
  notes?: string | null;
}) {
  const result = await upsertExpertAnalyst(input);
  if (result.action !== "created") {
    throw new ExpertIdentityError(
      `Username @${result.profile.username} is already taken`,
    );
  }
  return result.profile;
}

export type UpsertExpertAnalystResult = {
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
 * Idempotent analyst upsert by stable username slug.
 * Never reactivates official publisher shells or converts them into analysts.
 */
export async function upsertExpertAnalyst(input: {
  analystName: string;
  publicationName: string;
  username?: string;
  sourceUrl?: string | null;
  positionsCovered?: ContestPosition[];
  competitorActive?: boolean;
  notes?: string | null;
}): Promise<UpsertExpertAnalystResult> {
  const nameResult = validateDisplayName(input.analystName);
  if (!nameResult.ok) throw new ExpertIdentityError(nameResult.error);
  const publication = input.publicationName.trim();
  if (publication.length < 2) {
    throw new ExpertIdentityError("Publisher / affiliation is required");
  }

  const username =
    input.username?.trim()
      ? slugifyExpertUsername(input.username)
      : slugifyExpertUsername(nameResult.username);
  if (username.length < 3) {
    throw new ExpertIdentityError(
      "Username must be at least 3 characters after normalization",
    );
  }
  if (isOfficialBenchmarkUsername(username)) {
    throw new ExpertIdentityError(
      "That username is reserved for an official publisher shell",
    );
  }

  const competitorActive = input.competitorActive ?? true;
  const sourceUrl = input.sourceUrl?.trim() || null;
  const positions = input.positionsCovered ?? [];
  const notes = input.notes ?? null;

  const existing = await prisma.universalProfile.findUnique({
    where: { username },
    include: { expertSource: true },
  });

  if (existing) {
    if (existing.profileType !== "BENCHMARK") {
      throw new ExpertIdentityError(`Username @${username} is already taken`);
    }
    if (isOfficialBenchmarkUsername(existing.username)) {
      throw new ExpertIdentityError(
        `Refusing to convert publisher shell @${existing.username} into an analyst`,
      );
    }

    const currentPositions = parsePositionsCovered(
      existing.expertSource?.positionsCovered,
    );
    const positionsEqual =
      currentPositions.length === positions.length &&
      currentPositions.every((position) => positions.includes(position));

    const unchanged =
      existing.displayName === nameResult.username &&
      existing.competitorActive === competitorActive &&
      existing.status === "ACTIVE" &&
      (existing.expertSource?.analystName ?? null) === nameResult.username &&
      (existing.expertSource?.publicationName ?? null) === publication &&
      (existing.expertSource?.sourceUrl ?? null) === sourceUrl &&
      (existing.expertSource?.sourceKind ?? null) === EXPERT_SOURCE_KIND.ANALYST &&
      (existing.expertSource?.active ?? true) === true &&
      positionsEqual &&
      (existing.expertSource?.notes ?? null) === notes;

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
        publicVisible: true,
      },
    });
    await upsertExpertSourceProfile({
      universalProfileId: existing.id,
      analystName: nameResult.username,
      publicationName: publication,
      sourceUrl,
      sourceKind: EXPERT_SOURCE_KIND.ANALYST,
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
        profileType: "BENCHMARK",
        competitorActive,
      },
    };
  }

  const profile = await prisma.universalProfile.create({
    data: {
      username,
      displayName: nameResult.username,
      profileType: "BENCHMARK",
      status: "ACTIVE",
      competitorActive,
      universalUserId: `uu_expert_${username}`,
      publicVisible: true,
    },
  });

  await upsertExpertSourceProfile({
    universalProfileId: profile.id,
    analystName: nameResult.username,
    publicationName: publication,
    sourceUrl,
    sourceKind: EXPERT_SOURCE_KIND.ANALYST,
    positionsCovered: positions,
    active: true,
    notes,
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

/** Directory + competitor activation without deleting historical Expert rows. */
export async function setExpertDirectoryActive(input: {
  universalProfileId: string;
  active: boolean;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    include: { expertSource: true },
  });
  if (!profile || profile.profileType !== "BENCHMARK") {
    throw new ExpertIdentityError("Expert profile not found");
  }

  await prisma.universalProfile.update({
    where: { id: profile.id },
    data: { competitorActive: input.active },
  });

  await upsertExpertSourceProfile({
    universalProfileId: profile.id,
    active: input.active,
    publicationName:
      profile.expertSource?.publicationName ?? profile.displayName,
    analystName: profile.expertSource?.analystName ?? null,
    sourceKind: profile.expertSource?.sourceKind,
  });

  return { id: profile.id, active: input.active };
}

export async function updateExpertAnalystMetadata(input: {
  universalProfileId: string;
  analystName?: string;
  publicationName?: string;
  sourceUrl?: string | null;
  positionsCovered?: ContestPosition[];
  notes?: string | null;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
  });
  if (!profile || profile.profileType !== "BENCHMARK") {
    throw new ExpertIdentityError("Expert profile not found");
  }

  let displayName = profile.displayName;
  if (input.analystName != null) {
    const nameResult = validateDisplayName(input.analystName);
    if (!nameResult.ok) throw new ExpertIdentityError(nameResult.error);
    displayName = nameResult.username;
    await prisma.universalProfile.update({
      where: { id: profile.id },
      data: { displayName },
    });
  }

  await upsertExpertSourceProfile({
    universalProfileId: profile.id,
    analystName: input.analystName != null ? displayName : undefined,
    publicationName: input.publicationName,
    sourceUrl: input.sourceUrl,
    sourceKind: isOfficialBenchmarkUsername(profile.username)
      ? EXPERT_SOURCE_KIND.PUBLISHER
      : EXPERT_SOURCE_KIND.ANALYST,
    positionsCovered: input.positionsCovered,
    notes: input.notes,
  });

  return prisma.universalProfile.findUniqueOrThrow({
    where: { id: profile.id },
    include: { expertSource: true },
  });
}
