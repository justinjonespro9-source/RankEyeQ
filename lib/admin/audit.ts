import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

export type AdminAuditInput = {
  adminUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function logAdminAction(input: AdminAuditInput) {
  return prisma.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
    },
  });
}

export async function listRecentAdminAudit(limit = 12) {
  return prisma.adminAuditLog.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      adminUser: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
    },
  });
}
