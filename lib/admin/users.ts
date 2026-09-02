import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  OFFICIAL_AI_USERNAMES,
  RETIRED_AI_USERNAMES,
} from "@/lib/ai-competitors";
import { OFFICIAL_BENCHMARK_USERNAMES } from "@/lib/benchmark-sources";
import type {
  ProfileStatus,
  ProfileType,
  UserRole,
} from "@/lib/generated/prisma/client";
import {
  normalizeUsername,
  validateDisplayName,
  validateUsername,
} from "@/lib/username";

export class AdminUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminUserError";
  }
}

const AI_ALLOWED_RESERVED = new Set([
  ...OFFICIAL_AI_USERNAMES,
  ...RETIRED_AI_USERNAMES,
]);

export function validateAdminUsername(
  raw: string,
  options?: { allowAiReserved?: boolean; allowBenchmarkReserved?: boolean },
) {
  const username = normalizeUsername(raw);
  if (options?.allowBenchmarkReserved && OFFICIAL_BENCHMARK_USERNAMES.has(username)) {
    if (!/^[a-z0-9-]{3,24}$/.test(username)) {
      return { ok: false as const, error: "Invalid username" };
    }
    return { ok: true as const, username };
  }
  if (options?.allowAiReserved && AI_ALLOWED_RESERVED.has(username)) {
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return { ok: false as const, error: "Invalid username" };
    }
    return { ok: true as const, username };
  }
  return validateUsername(raw);
}

export async function searchAdminUsers(input: {
  query?: string;
  profileType?: ProfileType | "ALL";
  role?: UserRole | "ALL";
  status?: ProfileStatus | "ALL";
}) {
  const query = input.query?.trim() ?? "";
  const profileType =
    input.profileType && input.profileType !== "ALL"
      ? input.profileType
      : undefined;
  const role = input.role && input.role !== "ALL" ? input.role : undefined;
  const status =
    input.status && input.status !== "ALL" ? input.status : undefined;

  const profiles = await prisma.universalProfile.findMany({
    where: {
      ...(profileType ? { profileType } : {}),
      ...(status ? { status } : {}),
      ...(query
        ? {
            OR: [
              { username: { contains: query, mode: "insensitive" } },
              { displayName: { contains: query, mode: "insensitive" } },
              {
                authUser: {
                  email: { contains: query, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
      ...(role
        ? {
            authUser: { is: { role } },
          }
        : {}),
    },
    include: {
      authUser: {
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          submissions: {
            where: { status: { in: ["SUBMITTED", "LOCKED", "GRADED"] } },
          },
        },
      },
    },
    orderBy: [{ profileType: "asc" }, { displayName: "asc" }],
    take: 100,
  });

  return profiles.map((profile) => ({
    profileId: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    profileType: profile.profileType,
    status: profile.status,
    createdAt: profile.createdAt,
    contestCount: profile._count.submissions,
    userId: profile.authUser?.id ?? null,
    email: profile.authUser?.email ?? null,
    role: profile.authUser?.role ?? null,
    accountCreatedAt: profile.authUser?.createdAt ?? null,
  }));
}

export async function createAiUniversalProfile(input: {
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}) {
  const usernameResult = validateAdminUsername(input.username, {
    allowAiReserved: true,
  });
  if (!usernameResult.ok) throw new AdminUserError(usernameResult.error);
  const displayResult = validateDisplayName(input.displayName);
  if (!displayResult.ok) throw new AdminUserError(displayResult.error);

  const exists = await prisma.universalProfile.findUnique({
    where: { username: usernameResult.username },
  });
  if (exists) {
    throw new AdminUserError("That username is already taken");
  }

  return prisma.universalProfile.create({
    data: {
      username: usernameResult.username,
      displayName: displayResult.username,
      avatarUrl: input.avatarUrl?.trim() || null,
      profileType: "AI",
      status: "ACTIVE",
      competitorActive: OFFICIAL_AI_USERNAMES.has(usernameResult.username),
    },
  });
}

export async function updateUniversalProfileAdmin(input: {
  profileId: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.profileId },
  });
  if (!profile) throw new AdminUserError("Profile not found");

  const data: {
    displayName?: string;
    username?: string;
    avatarUrl?: string | null;
  } = {};

  if (input.displayName != null) {
    const displayResult = validateDisplayName(input.displayName);
    if (!displayResult.ok) throw new AdminUserError(displayResult.error);
    data.displayName = displayResult.username;
  }
  if (input.username != null && input.username !== profile.username) {
    const usernameResult = validateAdminUsername(input.username, {
      allowAiReserved: profile.profileType === "AI",
      allowBenchmarkReserved: profile.profileType === "BENCHMARK",
    });
    if (!usernameResult.ok) throw new AdminUserError(usernameResult.error);
    const taken = await prisma.universalProfile.findUnique({
      where: { username: usernameResult.username },
    });
    if (taken && taken.id !== profile.id) {
      throw new AdminUserError("That username is already taken");
    }
    data.username = usernameResult.username;
  }
  if (input.avatarUrl !== undefined) {
    data.avatarUrl = input.avatarUrl?.trim() || null;
  }

  return prisma.universalProfile.update({
    where: { id: input.profileId },
    data,
  });
}

export async function setProfileStatus(input: {
  profileId: string;
  status: ProfileStatus;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.profileId },
  });
  if (!profile) throw new AdminUserError("Profile not found");

  return prisma.universalProfile.update({
    where: { id: input.profileId },
    data: { status: input.status },
  });
}

export async function changeUserRole(input: {
  actorUserId: string;
  targetUserId: string;
  role: UserRole;
}) {
  if (input.actorUserId === input.targetUserId && input.role !== "ADMIN") {
    throw new AdminUserError("You cannot remove your own admin role");
  }

  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
  });
  if (!target) throw new AdminUserError("User not found");

  if (target.role === "ADMIN" && input.role !== "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      throw new AdminUserError("Cannot remove the last admin");
    }
  }

  return prisma.user.update({
    where: { id: input.targetUserId },
    data: { role: input.role },
  });
}

export function assertNotSelfDemotion(
  actorUserId: string,
  targetUserId: string,
  nextRole: UserRole,
) {
  if (actorUserId === targetUserId && nextRole !== "ADMIN") {
    throw new ForbiddenError("Cannot change your own admin role");
  }
}
