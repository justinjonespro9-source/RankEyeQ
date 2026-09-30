import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

export type WaiverDb = Prisma.TransactionClient | typeof prisma;

/**
 * The authoritative Waiver clock: the database's `waiver_utc_now()` (the same
 * function the lock triggers use). Read it inside the transaction that writes.
 * Always UTC `timestamp`; a timestamptz read would be shifted by the session
 * TimeZone through the driver adapter.
 */
export async function readWaiverClock(db: WaiverDb = prisma): Promise<Date> {
  const rows = await db.$queryRaw<{ now: Date }[]>`SELECT "waiver_utc_now"() AS now`;
  const now = rows[0]?.now;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("Waiver clock unavailable");
  }
  return now;
}

/** Share-lock the contest row: concurrent board writes proceed; re-pin and lock stamps wait. */
export async function shareLockWaiverContest(tx: Prisma.TransactionClient, contestId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "WaiverContest" WHERE "id" = ${contestId} FOR SHARE`;
  return rows.length > 0;
}

/** Exclusive contest lock for re-pin and lock stamping. */
export async function exclusiveLockWaiverContest(tx: Prisma.TransactionClient, contestId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "WaiverContest" WHERE "id" = ${contestId} FOR UPDATE`;
  return rows.length > 0;
}

export async function exclusiveLockWaiverSubmission(tx: Prisma.TransactionClient, submissionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "WaiverSubmission" WHERE "id" = ${submissionId} FOR UPDATE`;
}
