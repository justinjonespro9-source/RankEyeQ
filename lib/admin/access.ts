import { ForbiddenError } from "@/lib/auth/errors";
import type { UserRole } from "@/lib/generated/prisma/client";

export function canAccessAdmin(role: UserRole | null | undefined) {
  return role === "ADMIN";
}

export function assertAdminRole(role: UserRole | null | undefined) {
  if (!canAccessAdmin(role)) {
    throw new ForbiddenError("Admin access required");
  }
}
