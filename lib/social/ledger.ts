import { assertAdminRole } from "@/lib/admin/access";
import { ForbiddenError } from "@/lib/auth/errors";
import { prisma } from "@/lib/db";
import type {
  LedgerEntryStatus,
  LedgerEntryType,
  UserRole,
} from "@/lib/generated/prisma/client";

export type CreateLedgerEntryInput = {
  creatorProfileId: string;
  viewerProfileId?: string | null;
  contestId?: string | null;
  entitlementId?: string | null;
  type?: LedgerEntryType;
  grossAmountMinor?: number;
  platformFeeMinor?: number;
  creatorAmountMinor?: number;
  currency?: string;
  status?: LedgerEntryStatus;
};

export async function createCreatorLedgerEntry(input: CreateLedgerEntryInput) {
  return prisma.creatorLedgerEntry.create({
    data: {
      creatorProfileId: input.creatorProfileId,
      viewerProfileId: input.viewerProfileId ?? null,
      contestId: input.contestId ?? null,
      entitlementId: input.entitlementId ?? null,
      type: input.type ?? "TEST",
      grossAmountMinor: input.grossAmountMinor ?? 0,
      platformFeeMinor: input.platformFeeMinor ?? 0,
      creatorAmountMinor: input.creatorAmountMinor ?? 0,
      currency: input.currency ?? "USD",
      status: input.status ?? "PENDING",
    },
  });
}

export async function createTestLedgerEntryAsActor(
  input: CreateLedgerEntryInput & { actorRole: UserRole },
) {
  assertAdminRole(input.actorRole);
  return createCreatorLedgerEntry(input);
}

export function assertUserCannotWriteLedger() {
  throw new ForbiddenError("Users cannot create earnings ledger entries");
}

export async function listCreatorLedgerEntries(
  creatorProfileId: string,
  limit = 50,
) {
  return prisma.creatorLedgerEntry.findMany({
    where: { creatorProfileId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function summarizeCreatorLedger(creatorProfileId: string) {
  const entries = await prisma.creatorLedgerEntry.findMany({
    where: { creatorProfileId },
    select: {
      status: true,
      creatorAmountMinor: true,
      grossAmountMinor: true,
    },
  });

  return {
    entryCount: entries.length,
    grossAmountMinor: entries.reduce((sum, row) => sum + row.grossAmountMinor, 0),
    creatorAmountMinor: entries.reduce(
      (sum, row) => sum + row.creatorAmountMinor,
      0,
    ),
    byStatus: entries.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
