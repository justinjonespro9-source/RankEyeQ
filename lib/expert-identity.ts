import { prisma } from "@/lib/db";
import type { ContestPosition, ProfileType } from "@/lib/generated/prisma/client";
import { isOfficialBenchmarkUsername } from "@/lib/benchmark-sources";
import { normalizeUsername, validateDisplayName } from "@/lib/username";

/** UI label for BENCHMARK profile type. */
export const EXPERT_PROFILE_TYPE: ProfileType = "BENCHMARK";

export const EXPERT_SOURCE_KIND = {
  ANALYST: "ANALYST",
  /** Legacy inactive affiliation shells (espn-fantasy, yahoo-fantasy, …). */
  PUBLISHER: "PUBLISHER",
  /** Active pooled publisher boards (Yahoo Consensus, FantasyPros ECR, …). */
  PUBLISHER_CONSENSUS: "PUBLISHER_CONSENSUS",
  SITE_CONSENSUS: "SITE_CONSENSUS",
} as const;

export type ExpertSourceKind =
  (typeof EXPERT_SOURCE_KIND)[keyof typeof EXPERT_SOURCE_KIND];

/** Optional disclosed scoring assumptions from the original publisher. */
export const BENCHMARK_SCORING_FORMAT = {
  HALF_PPR: "HALF_PPR",
  FULL_PPR: "FULL_PPR",
  STANDARD: "STANDARD",
  TE_PREMIUM: "TE_PREMIUM",
  OTHER: "OTHER",
  UNSPECIFIED: "UNSPECIFIED",
} as const;

export type BenchmarkScoringFormat =
  (typeof BENCHMARK_SCORING_FORMAT)[keyof typeof BENCHMARK_SCORING_FORMAT];

export const BENCHMARK_SCORING_FORMAT_LABELS: Record<
  BenchmarkScoringFormat,
  string
> = {
  HALF_PPR: "Half PPR",
  FULL_PPR: "Full PPR",
  STANDARD: "Standard",
  TE_PREMIUM: "TE Premium",
  OTHER: "Other",
  UNSPECIFIED: "Not specified",
};

export function parseBenchmarkScoringFormat(
  raw: string | null | undefined,
): BenchmarkScoringFormat | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (
    normalized === "HALF_PPR" ||
    normalized === "FULL_PPR" ||
    normalized === "STANDARD" ||
    normalized === "TE_PREMIUM" ||
    normalized === "OTHER" ||
    normalized === "UNSPECIFIED"
  ) {
    return normalized;
  }
  return null;
}

export function isExpertProfile(profileType: ProfileType): boolean {
  return profileType === "BENCHMARK";
}

/** Individual analyst Experts (not publisher shells / consensus boards). */
export function isAnalystExpertSource(
  sourceKind: string | null | undefined,
): boolean {
  return (
    sourceKind === EXPERT_SOURCE_KIND.ANALYST ||
    sourceKind == null ||
    sourceKind === ""
  );
}

/** Active Publisher Consensus benchmark class. */
export function isPublisherConsensusSource(
  sourceKind: string | null | undefined,
): boolean {
  return (
    sourceKind === EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS ||
    sourceKind === EXPERT_SOURCE_KIND.SITE_CONSENSUS
  );
}

/** Legacy inactive publisher affiliation shells. */
export function isLegacyPublisherShellSource(
  sourceKind: string | null | undefined,
): boolean {
  return sourceKind === EXPERT_SOURCE_KIND.PUBLISHER;
}

export const BENCHMARK_TRACKING_DISCLAIMER =
  "Tracked from public rankings and evaluated using RankEyeQ’s scoring standard. Original source scoring assumptions may differ.";

export function formatBenchmarkScoringDisclosure(input: {
  scoringFormat?: string | null;
}): string {
  const parsed = parseBenchmarkScoringFormat(input.scoringFormat);
  if (!parsed || parsed === "UNSPECIFIED") {
    return BENCHMARK_TRACKING_DISCLAIMER;
  }
  return `${BENCHMARK_TRACKING_DISCLAIMER} Source format: ${BENCHMARK_SCORING_FORMAT_LABELS[parsed]}.`;
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
 * Secondary affiliation badge.
 * Analysts: EXPERT · {publication}
 * Publisher Consensus: CONSENSUS · {publication}
 * Legacy shells: EXPERT · {publication} (inactive directory only)
 */
export function formatExpertAffiliationBadge(
  input: ExpertDisplayInput,
): string | null {
  const publication =
    input.publicationName?.trim() ||
    (input.sourceKind === EXPERT_SOURCE_KIND.ANALYST
      ? null
      : input.displayName.trim());

  if (isPublisherConsensusSource(input.sourceKind)) {
    if (!publication) return "CONSENSUS";
    return `CONSENSUS · ${publication}`;
  }

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
  scoringFormat?: string | null;
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

  const scoringFormat =
    input.scoringFormat === undefined
      ? undefined
      : parseBenchmarkScoringFormat(input.scoringFormat) ??
        BENCHMARK_SCORING_FORMAT.UNSPECIFIED;

  return prisma.expertSourceProfile.upsert({
    where: { universalProfileId: input.universalProfileId },
    update: {
      publicationName: input.publicationName ?? undefined,
      analystName: input.analystName ?? undefined,
      sourceUrl: input.sourceUrl ?? undefined,
      sourceKind: input.sourceKind ?? undefined,
      scoringFormat,
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
      scoringFormat: scoringFormat ?? null,
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
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
  positionsCovered?: ContestPosition[];
  competitorActive?: boolean;
  notes?: string | null;
  acknowledgeDuplicate?: boolean;
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
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
  positionsCovered?: ContestPosition[];
  competitorActive?: boolean;
  notes?: string | null;
  acknowledgeDuplicate?: boolean;
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
  const publicVisible = input.publicVisible ?? true;
  const sourceUrl = input.sourceUrl?.trim() || null;
  const avatarUrl = input.avatarUrl?.trim() || null;
  const bio = input.bio?.trim() ?? input.notes?.trim() ?? null;
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
      existing.publicVisible === publicVisible &&
      existing.status === "ACTIVE" &&
      (existing.avatarUrl ?? null) === avatarUrl &&
      (existing.bio ?? null) === bio &&
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
        publicVisible,
        avatarUrl,
        bio,
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

  const nameConflicts = await prisma.universalProfile.findMany({
    where: {
      profileType: "BENCHMARK",
      displayName: { equals: nameResult.username, mode: "insensitive" },
    },
    select: { username: true },
    take: 5,
  });
  if (nameConflicts.length > 0 && !input.acknowledgeDuplicate) {
    throw new ExpertIdentityError(
      `A similar Expert already exists (${nameConflicts
        .map((row) => `@${row.username}`)
        .join(", ")}). Check “Acknowledge existing name” to create anyway.`,
    );
  }

  const profile = await prisma.universalProfile.create({
    data: {
      username,
      displayName: nameResult.username,
      profileType: "BENCHMARK",
      status: "ACTIVE",
      competitorActive,
      universalUserId: `uu_expert_${username}`,
      publicVisible,
      avatarUrl,
      bio,
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

/** Update an existing Publisher Consensus competitor by profile id. */
export async function updatePublisherConsensusMetadata(input: {
  universalProfileId: string;
  displayName?: string;
  publisherName?: string;
  sourceUrl?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
  competitorActive?: boolean;
  positionsCovered?: ContestPosition[];
  scoringFormat?: string | null;
  notes?: string | null;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    include: { expertSource: true },
  });
  if (!profile || profile.profileType !== "BENCHMARK") {
    throw new ExpertIdentityError("Publisher Consensus profile not found");
  }
  if (!isPublisherConsensusSource(profile.expertSource?.sourceKind)) {
    throw new ExpertIdentityError(
      "Profile is not an active Publisher Consensus competitor",
    );
  }
  if (isOfficialBenchmarkUsername(profile.username)) {
    throw new ExpertIdentityError(
      "Refusing to edit a legacy publisher shell as Publisher Consensus",
    );
  }

  let displayName = profile.displayName;
  if (input.displayName != null) {
    const nameResult = validateDisplayName(input.displayName);
    if (!nameResult.ok) throw new ExpertIdentityError(nameResult.error);
    displayName = nameResult.username;
  }

  const publication =
    input.publisherName?.trim() ||
    profile.expertSource?.publicationName ||
    displayName;
  if (publication.length < 2) {
    throw new ExpertIdentityError("Publisher name is required");
  }

  const scoringFormat =
    input.scoringFormat === undefined
      ? profile.expertSource?.scoringFormat
      : parseBenchmarkScoringFormat(input.scoringFormat) ??
        BENCHMARK_SCORING_FORMAT.UNSPECIFIED;

  await prisma.universalProfile.update({
    where: { id: profile.id },
    data: {
      displayName,
      avatarUrl:
        input.avatarUrl === undefined
          ? profile.avatarUrl
          : input.avatarUrl?.trim() || null,
      bio:
        input.bio === undefined ? profile.bio : input.bio?.trim() || null,
      publicVisible: input.publicVisible ?? profile.publicVisible,
      competitorActive: input.competitorActive ?? profile.competitorActive,
    },
  });

  await upsertExpertSourceProfile({
    universalProfileId: profile.id,
    analystName: null,
    publicationName: publication,
    sourceUrl:
      input.sourceUrl === undefined
        ? profile.expertSource?.sourceUrl
        : input.sourceUrl,
    sourceKind: EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS,
    positionsCovered: input.positionsCovered,
    notes:
      input.notes === undefined ? profile.expertSource?.notes : input.notes,
    scoringFormat,
  });

  return prisma.universalProfile.findUniqueOrThrow({
    where: { id: profile.id },
    include: { expertSource: true },
  });
}

/**
 * Create an active Publisher Consensus competitor (BENCHMARK + PUBLISHER_CONSENSUS).
 * Does not convert or reactivate legacy official publisher shells.
 */
export async function createPublisherConsensusCompetitor(input: {
  displayName: string;
  publisherName: string;
  username?: string;
  sourceUrl?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
  positionsCovered?: ContestPosition[];
  competitorActive?: boolean;
  scoringFormat?: string | null;
  notes?: string | null;
  acknowledgeDuplicate?: boolean;
}) {
  const result = await upsertPublisherConsensusCompetitor(input);
  if (result.action !== "created") {
    throw new ExpertIdentityError(
      `Username @${result.profile.username} is already taken`,
    );
  }
  return result.profile;
}

export type UpsertPublisherConsensusResult = {
  action: "created" | "updated" | "unchanged";
  profile: {
    id: string;
    username: string;
    displayName: string;
    profileType: ProfileType;
    competitorActive: boolean;
  };
};

export async function upsertPublisherConsensusCompetitor(input: {
  displayName: string;
  publisherName: string;
  username?: string;
  sourceUrl?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  publicVisible?: boolean;
  positionsCovered?: ContestPosition[];
  competitorActive?: boolean;
  scoringFormat?: string | null;
  notes?: string | null;
  acknowledgeDuplicate?: boolean;
}): Promise<UpsertPublisherConsensusResult> {
  const nameResult = validateDisplayName(input.displayName);
  if (!nameResult.ok) throw new ExpertIdentityError(nameResult.error);
  const publication = input.publisherName.trim();
  if (publication.length < 2) {
    throw new ExpertIdentityError("Publisher name is required");
  }

  const username =
    input.username?.trim()
      ? slugifyExpertUsername(input.username)
      : slugifyExpertUsername(
          `${publication}-consensus`.replace(/consensus-consensus/g, "consensus"),
        );
  if (username.length < 3) {
    throw new ExpertIdentityError(
      "Username must be at least 3 characters after normalization",
    );
  }
  if (isOfficialBenchmarkUsername(username)) {
    throw new ExpertIdentityError(
      "That username is reserved for a legacy publisher shell. Use a distinct Publisher Consensus username (e.g. yahoo-consensus).",
    );
  }

  const competitorActive = input.competitorActive ?? true;
  const publicVisible = input.publicVisible ?? true;
  const sourceUrl = input.sourceUrl?.trim() || null;
  const avatarUrl = input.avatarUrl?.trim() || null;
  const bio = input.bio?.trim() ?? input.notes?.trim() ?? null;
  const positions = input.positionsCovered ?? [];
  const notes = input.notes ?? null;
  const scoringFormat =
    parseBenchmarkScoringFormat(input.scoringFormat) ??
    BENCHMARK_SCORING_FORMAT.UNSPECIFIED;

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
        `Refusing to convert legacy publisher shell @${existing.username} into Publisher Consensus`,
      );
    }
    if (
      existing.expertSource?.sourceKind === EXPERT_SOURCE_KIND.ANALYST
    ) {
      throw new ExpertIdentityError(
        `Refusing to convert Expert analyst @${existing.username} into Publisher Consensus`,
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
      existing.publicVisible === publicVisible &&
      existing.status === "ACTIVE" &&
      (existing.avatarUrl ?? null) === avatarUrl &&
      (existing.bio ?? null) === bio &&
      (existing.expertSource?.publicationName ?? null) === publication &&
      (existing.expertSource?.sourceUrl ?? null) === sourceUrl &&
      (existing.expertSource?.sourceKind ?? null) ===
        EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS &&
      (existing.expertSource?.scoringFormat ?? null) === scoringFormat &&
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
        publicVisible,
        avatarUrl,
        bio,
      },
    });
    await upsertExpertSourceProfile({
      universalProfileId: existing.id,
      analystName: null,
      publicationName: publication,
      sourceUrl,
      sourceKind: EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS,
      scoringFormat,
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

  const nameConflicts = await prisma.universalProfile.findMany({
    where: {
      profileType: "BENCHMARK",
      displayName: { equals: nameResult.username, mode: "insensitive" },
    },
    select: { username: true },
    take: 5,
  });
  if (nameConflicts.length > 0 && !input.acknowledgeDuplicate) {
    throw new ExpertIdentityError(
      `A similar publisher board already exists (${nameConflicts
        .map((row) => `@${row.username}`)
        .join(", ")}). Check “Acknowledge existing name” to create anyway.`,
    );
  }

  const profile = await prisma.universalProfile.create({
    data: {
      username,
      displayName: nameResult.username,
      profileType: "BENCHMARK",
      status: "ACTIVE",
      competitorActive,
      universalUserId: `uu_publisher_consensus_${username}`,
      publicVisible,
      avatarUrl,
      bio,
    },
  });

  await upsertExpertSourceProfile({
    universalProfileId: profile.id,
    analystName: null,
    publicationName: publication,
    sourceUrl,
    sourceKind: EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS,
    scoringFormat,
    positionsCovered: positions,
    active: true,
    notes,
  });

  return {
    action: "created",
    profile: {
      id: profile.id,
      username: profile.username,
      displayName: nameResult.username,
      profileType: "BENCHMARK",
      competitorActive,
    },
  };
}
