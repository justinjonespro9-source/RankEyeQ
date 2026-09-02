import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAccessAdmin } from "@/lib/admin/access";
import { ForbiddenError } from "@/lib/auth/errors";
import { prisma } from "@/lib/db";
import type { UniversalProfile, User, UserRole } from "@/lib/generated/prisma/client";

export type AuthContext = {
  user: User;
  universalProfile: UniversalProfile | null;
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { universalProfile: true },
  });
  if (!user) return null;

  return {
    user,
    universalProfile: user.universalProfile,
  };
}

/** Active UniversalProfile for the signed-in account, or null. */
export async function getViewerProfile() {
  const ctx = await getAuthContext();
  return ctx?.universalProfile ?? null;
}

export async function requireAuthContext(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect("/signin");
  }
  return ctx;
}

export async function requireUniversalProfile(): Promise<{
  user: User;
  universalProfile: UniversalProfile;
}> {
  const ctx = await requireAuthContext();
  if (!ctx.universalProfile) {
    redirect("/account/setup");
  }
  if (ctx.universalProfile.profileType !== "HUMAN") {
    throw new ForbiddenError("AI profiles cannot authenticate as participants");
  }
  return {
    user: ctx.user,
    universalProfile: ctx.universalProfile,
  };
}

/** Redirecting guard for admin pages. */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect("/signin?callbackUrl=/admin");
  }
  if (!canAccessAdmin(ctx.user.role)) {
    redirect("/");
  }
  return ctx;
}

/** Throwing guard for admin server actions / mutations. */
export async function assertAdmin(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx || !canAccessAdmin(ctx.user.role)) {
    throw new ForbiddenError("Admin access required");
  }
  return ctx;
}

export function isAdminRole(role: UserRole) {
  return canAccessAdmin(role);
}

/** Soft check for UI — never use alone for mutations. */
export async function getSessionSnapshot() {
  const session = await auth();
  return session?.user ?? null;
}
