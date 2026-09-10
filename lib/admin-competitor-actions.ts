"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAdminAction } from "@/lib/admin/audit";
import {
  CompetitorAuthorizationError,
  authorizeCompetitorPublic,
  setCompetitorVisibilityState,
} from "@/lib/admin/competitor-authorization";
import {
  AiIdentityError,
  createAiCompetitor,
  setAiDirectoryActive,
  updateAiCompetitorMetadata,
} from "@/lib/ai-identity";
import { assertAdmin } from "@/lib/auth/session";
import {
  CreatorIdentityError,
  createCreatorCompetitor,
  setCreatorDirectoryActive,
  updateCreatorCompetitorMetadata,
} from "@/lib/creator-identity";
import type { AuthorizeHistoryMode } from "@/lib/competitor-visibility";
import {
  ExpertIdentityError,
  createExpertAnalyst,
  createPublisherConsensusCompetitor,
  setExpertDirectoryActive,
  updateExpertAnalystMetadata,
  updatePublisherConsensusMetadata,
} from "@/lib/expert-identity";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { CompetitorVisibilityState } from "@/lib/competitor-visibility";

function revalidateCompetitorSurfaces() {
  revalidatePath("/admin/competitors/new");
  revalidatePath("/admin/competitors/live");
  revalidatePath("/admin/ai");
  revalidatePath("/admin/creators");
  revalidatePath("/admin/creators/verification");
  revalidatePath("/admin/experts");
  revalidatePath("/admin/benchmarks");
  revalidatePath("/admin/users");
  revalidatePath("/rankers");
  revalidatePath("/leaderboards");
}

function parsePositions(formData: FormData): ContestPosition[] {
  const raw = formData.getAll("positions").map(String);
  const allowed = new Set(["QB", "RB", "WR", "TE", "DEF"]);
  return raw.filter((value): value is ContestPosition => allowed.has(value));
}

function flag(formData: FormData, name: string, defaultTrue = true) {
  const values = formData.getAll(name).map(String);
  if (values.length === 0) return defaultTrue;
  const last = values[values.length - 1];
  return last !== "false" && last !== "0";
}

function redirectCreateError(type: string, message: string): never {
  redirect(
    `/admin/competitors/new?type=${encodeURIComponent(type)}&error=${encodeURIComponent(message)}`,
  );
}

export async function createCompetitorAction(formData: FormData) {
  const admin = await assertAdmin();
  const type = String(formData.get("type") || "").toLowerCase();
  const acknowledgeDuplicate = formData.get("acknowledgeDuplicate") === "true";

  try {
    if (type === "ai") {
      const profile = await createAiCompetitor({
        displayName: String(formData.get("displayName") || ""),
        username: String(formData.get("username") || ""),
        avatarUrl: String(formData.get("avatarUrl") || "").trim() || null,
        bio: String(formData.get("bio") || "").trim() || null,
        competitorActive: flag(formData, "competitorActive", true),
        publicVisible: flag(formData, "publicVisible", true),
        acknowledgeDuplicate,
      });
      await logAdminAction({
        adminUserId: admin.user.id,
        action: "ai.competitor_created",
        entityType: "UniversalProfile",
        entityId: profile.id,
        metadata: { username: profile.username },
      });
      revalidateCompetitorSurfaces();
      redirect(`/admin/ai?created=1&username=${encodeURIComponent(profile.username)}`);
    }

    if (type === "creator") {
      const profile = await createCreatorCompetitor({
        personName: String(formData.get("displayName") || formData.get("personName") || ""),
        brandName: String(formData.get("brandName") || ""),
        username: String(formData.get("username") || "").trim() || undefined,
        creatorSiteUrl:
          String(formData.get("creatorSiteUrl") || "").trim() || null,
        socialUrl: String(formData.get("socialUrl") || "").trim() || null,
        socialHandle: String(formData.get("socialHandle") || "").trim() || null,
        sourceUrl: String(formData.get("sourceUrl") || "").trim() || null,
        avatarUrl: String(formData.get("avatarUrl") || "").trim() || null,
        bio: String(formData.get("bio") || "").trim() || null,
        competitorActive: flag(formData, "competitorActive", true),
        publicVisible: flag(formData, "publicVisible", false),
        positionsCovered: parsePositions(formData),
        acknowledgeDuplicate,
      });
      await logAdminAction({
        adminUserId: admin.user.id,
        action: "creator.competitor_created",
        entityType: "UniversalProfile",
        entityId: profile.id,
        metadata: { username: profile.username, claimStatus: "UNCLAIMED" },
      });
      revalidateCompetitorSurfaces();
      redirect(
        `/admin/creators?created=1&username=${encodeURIComponent(profile.username)}`,
      );
    }

    if (type === "expert") {
      const profile = await createExpertAnalyst({
        analystName: String(formData.get("displayName") || formData.get("analystName") || ""),
        publicationName: String(formData.get("publicationName") || ""),
        username: String(formData.get("username") || "").trim() || undefined,
        sourceUrl: String(formData.get("sourceUrl") || "").trim() || null,
        avatarUrl: String(formData.get("avatarUrl") || "").trim() || null,
        bio: String(formData.get("bio") || "").trim() || null,
        publicVisible: flag(formData, "publicVisible", false),
        positionsCovered: parsePositions(formData),
        competitorActive: flag(formData, "competitorActive", true),
        notes: String(formData.get("notes") || "").trim() || null,
        acknowledgeDuplicate,
      });
      await logAdminAction({
        adminUserId: admin.user.id,
        action: "expert.analyst_created",
        entityType: "UniversalProfile",
        entityId: profile.id,
        metadata: { username: profile.username, sourceKind: "ANALYST" },
      });
      revalidateCompetitorSurfaces();
      redirect(
        `/admin/experts?created=1&username=${encodeURIComponent(profile.username)}`,
      );
    }

    if (type === "publisher" || type === "publisher_consensus") {
      const profile = await createPublisherConsensusCompetitor({
        displayName: String(formData.get("displayName") || ""),
        publisherName: String(
          formData.get("publisherName") || formData.get("publicationName") || "",
        ),
        username: String(formData.get("username") || "").trim() || undefined,
        sourceUrl: String(formData.get("sourceUrl") || "").trim() || null,
        avatarUrl: String(formData.get("avatarUrl") || "").trim() || null,
        bio: String(formData.get("bio") || "").trim() || null,
        publicVisible: flag(formData, "publicVisible", true),
        positionsCovered: parsePositions(formData),
        competitorActive: flag(formData, "competitorActive", true),
        scoringFormat: String(formData.get("scoringFormat") || "").trim() || null,
        notes: String(formData.get("notes") || "").trim() || null,
        acknowledgeDuplicate,
      });
      await logAdminAction({
        adminUserId: admin.user.id,
        action: "publisher_consensus.created",
        entityType: "UniversalProfile",
        entityId: profile.id,
        metadata: {
          username: profile.username,
          sourceKind: "PUBLISHER_CONSENSUS",
        },
      });
      revalidateCompetitorSurfaces();
      redirect(
        `/admin/benchmarks?created=1&username=${encodeURIComponent(profile.username)}`,
      );
    }

    redirectCreateError(type || "ai", "Unknown competitor type");
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "digest" in error &&
      String((error as { digest?: string }).digest || "").startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const message =
      error instanceof AiIdentityError ||
      error instanceof CreatorIdentityError ||
      error instanceof ExpertIdentityError
        ? error.message
        : "Unable to create competitor";
    redirectCreateError(type || "ai", message);
  }
}

export async function setCompetitorActiveAction(formData: FormData) {
  const admin = await assertAdmin();
  const type = String(formData.get("type") || "").toLowerCase();
  const profileId = String(formData.get("universalProfileId") || "");
  const active = String(formData.get("active") || "") === "true";
  const returnTo = String(formData.get("returnTo") || `/admin/${type === "ai" ? "ai" : type === "creator" ? "creators" : "experts"}`);

  try {
    if (type === "ai") {
      await setAiDirectoryActive({ universalProfileId: profileId, active });
    } else if (type === "creator") {
      await setCreatorDirectoryActive({ universalProfileId: profileId, active });
    } else if (type === "expert") {
      await setExpertDirectoryActive({ universalProfileId: profileId, active });
    } else {
      throw new Error("Unknown competitor type");
    }
    await logAdminAction({
      adminUserId: admin.user.id,
      action: active ? `${type}.activated` : `${type}.deactivated`,
      entityType: "UniversalProfile",
      entityId: profileId,
    });
  } catch (error) {
    const message =
      error instanceof AiIdentityError ||
      error instanceof CreatorIdentityError ||
      error instanceof ExpertIdentityError
        ? error.message
        : "Unable to update competitor status";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }
  revalidateCompetitorSurfaces();
  redirect(returnTo);
}

export async function updateCompetitorMetadataAction(formData: FormData) {
  const admin = await assertAdmin();
  const type = String(formData.get("type") || "").toLowerCase();
  const profileId = String(formData.get("universalProfileId") || "");
  const returnTo = String(
    formData.get("returnTo") ||
      `/admin/${
        type === "ai"
          ? "ai"
          : type === "creator"
            ? "creators"
            : type === "publisher"
              ? "competitors/live"
              : "experts"
      }`,
  );

  try {
    if (type === "ai") {
      await updateAiCompetitorMetadata({
        universalProfileId: profileId,
        displayName: String(formData.get("displayName") || "") || undefined,
        avatarUrl: String(formData.get("avatarUrl") || "").trim() || null,
        bio: String(formData.get("bio") || "").trim() || null,
        publicVisible: flag(formData, "publicVisible", true),
      });
    } else if (type === "creator") {
      const positions = parsePositions(formData);
      await updateCreatorCompetitorMetadata({
        universalProfileId: profileId,
        personName: String(formData.get("displayName") || formData.get("personName") || "") || undefined,
        brandName: String(formData.get("brandName") || "") || undefined,
        creatorSiteUrl:
          String(formData.get("creatorSiteUrl") || "").trim() || null,
        socialUrl: String(formData.get("socialUrl") || "").trim() || null,
        socialHandle: String(formData.get("socialHandle") || "").trim() || null,
        sourceUrl: String(formData.get("sourceUrl") || "").trim() || null,
        avatarUrl: String(formData.get("avatarUrl") || "").trim() || null,
        bio: String(formData.get("bio") || "").trim() || null,
        publicVisible: flag(formData, "publicVisible", true),
        positionsCovered: positions.length > 0 ? positions : undefined,
      });
    } else if (type === "expert") {
      const positions = parsePositions(formData);
      await updateExpertAnalystMetadata({
        universalProfileId: profileId,
        analystName:
          String(formData.get("displayName") || formData.get("analystName") || "") ||
          undefined,
        publicationName:
          String(formData.get("publicationName") || "") || undefined,
        sourceUrl: String(formData.get("sourceUrl") || "").trim() || null,
        positionsCovered: positions.length > 0 ? positions : undefined,
        notes: String(formData.get("bio") || formData.get("notes") || "").trim() || null,
      });
      const { prisma } = await import("@/lib/db");
      await prisma.universalProfile.update({
        where: { id: profileId },
        data: {
          avatarUrl: String(formData.get("avatarUrl") || "").trim() || null,
          publicVisible: flag(formData, "publicVisible", true),
          bio: String(formData.get("bio") || "").trim() || null,
        },
      });
    } else if (type === "publisher") {
      const positions = parsePositions(formData);
      await updatePublisherConsensusMetadata({
        universalProfileId: profileId,
        displayName: String(formData.get("displayName") || "") || undefined,
        publisherName:
          String(
            formData.get("publisherName") ||
              formData.get("publicationName") ||
              "",
          ) || undefined,
        sourceUrl: String(formData.get("sourceUrl") || "").trim() || null,
        avatarUrl: String(formData.get("avatarUrl") || "").trim() || null,
        bio: String(formData.get("bio") || "").trim() || null,
        publicVisible: flag(formData, "publicVisible", true),
        competitorActive: flag(formData, "competitorActive", true),
        positionsCovered: positions.length > 0 ? positions : undefined,
        scoringFormat: String(formData.get("scoringFormat") || "") || null,
        notes: String(formData.get("notes") || "").trim() || null,
      });
    } else {
      throw new Error("Unknown competitor type");
    }
    await logAdminAction({
      adminUserId: admin.user.id,
      action: `${type}.metadata_updated`,
      entityType: "UniversalProfile",
      entityId: profileId,
    });
  } catch (error) {
    const message =
      error instanceof AiIdentityError ||
      error instanceof CreatorIdentityError ||
      error instanceof ExpertIdentityError
        ? error.message
        : "Unable to update competitor";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }
  revalidateCompetitorSurfaces();
  redirect(`${returnTo}?updated=1`);
}

/**
 * Explicit Make Public / Authorize — never silent.
 * historyMode: from_now (default) | expose_history
 */
export async function authorizeCompetitorPublicAction(formData: FormData) {
  const admin = await assertAdmin();
  const profileId = String(formData.get("universalProfileId") || "");
  const returnTo = String(formData.get("returnTo") || "/admin/competitors/live");
  const confirmed = formData.get("confirmAuthorize") === "true";
  const historyModeRaw = String(formData.get("historyMode") || "from_now");
  const historyMode: AuthorizeHistoryMode =
    historyModeRaw === "expose_history" ? "expose_history" : "from_now";
  const weekId = String(formData.get("weekId") || "").trim() || null;

  if (!confirmed) {
    redirect(
      `${returnTo}?error=${encodeURIComponent("Authorization requires explicit confirmation")}`,
    );
  }
  if (!profileId) {
    redirect(`${returnTo}?error=${encodeURIComponent("Missing profile")}`);
  }

  try {
    await authorizeCompetitorPublic({
      universalProfileId: profileId,
      historyMode,
      currentWeekId: weekId,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "competitor.authorized_public",
      entityType: "UniversalProfile",
      entityId: profileId,
      metadata: { historyMode, weekId },
    });
  } catch (error) {
    const message =
      error instanceof CompetitorAuthorizationError
        ? error.message
        : "Unable to authorize competitor";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }
  revalidateCompetitorSurfaces();
  redirect(`${returnTo}?authorized=1`);
}

export async function setCompetitorVisibilityAction(formData: FormData) {
  const admin = await assertAdmin();
  const profileId = String(formData.get("universalProfileId") || "");
  const returnTo = String(formData.get("returnTo") || "/admin/competitors/live");
  const stateRaw = String(formData.get("visibilityState") || "");
  const state = stateRaw as CompetitorVisibilityState;
  if (
    state !== "PRIVATE_TRACKED" &&
    state !== "AUTHORIZED_PUBLIC" &&
    state !== "INACTIVE"
  ) {
    redirect(
      `${returnTo}?error=${encodeURIComponent("Invalid visibility state")}`,
    );
  }
  const historyModeRaw = String(formData.get("historyMode") || "from_now");
  const historyMode: AuthorizeHistoryMode =
    historyModeRaw === "expose_history" ? "expose_history" : "from_now";
  const weekId = String(formData.get("weekId") || "").trim() || null;
  const confirmed = formData.get("confirmAuthorize") === "true";

  if (state === "AUTHORIZED_PUBLIC" && !confirmed) {
    redirect(
      `${returnTo}?error=${encodeURIComponent("Making public requires explicit confirmation")}`,
    );
  }

  try {
    await setCompetitorVisibilityState({
      universalProfileId: profileId,
      state,
      historyMode,
      currentWeekId: weekId,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "competitor.visibility_updated",
      entityType: "UniversalProfile",
      entityId: profileId,
      metadata: { state, historyMode },
    });
  } catch (error) {
    const message =
      error instanceof CompetitorAuthorizationError
        ? error.message
        : "Unable to update visibility";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }
  revalidateCompetitorSurfaces();
  redirect(`${returnTo}?updated=1`);
}
