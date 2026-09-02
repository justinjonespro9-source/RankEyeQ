-- AlterTable
ALTER TABLE "Season" ADD COLUMN "rosterSyncSource" TEXT;
ALTER TABLE "Season" ADD COLUMN "rosterSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SeasonPlayer" ADD COLUMN "sourcePosition" TEXT;
ALTER TABLE "SeasonPlayer" ADD COLUMN "sourceNflStatus" TEXT;
