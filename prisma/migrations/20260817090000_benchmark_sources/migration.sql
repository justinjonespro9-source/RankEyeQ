-- AlterEnum
ALTER TYPE "ProfileType" ADD VALUE 'BENCHMARK';

-- CreateEnum
CREATE TYPE "BenchmarkCaptureType" AS ENUM ('THURSDAY', 'SUNDAY', 'MANUAL_FINAL');

-- CreateEnum
CREATE TYPE "BenchmarkSnapshotStatus" AS ENUM ('DRAFT', 'CAPTURED', 'LOCKED', 'GRADED', 'NOT_AVAILABLE', 'LATE');

-- AlterTable
ALTER TABLE "RankingPick" ADD COLUMN "sourceRank" INTEGER;

-- CreateTable
CREATE TABLE "BenchmarkSnapshot" (
    "id" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "captureType" "BenchmarkCaptureType" NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "sourcePublishedAt" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "notes" TEXT,
    "rawText" TEXT,
    "status" "BenchmarkSnapshotStatus" NOT NULL DEFAULT 'CAPTURED',
    "publicBoardAllowed" BOOLEAN NOT NULL DEFAULT true,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "adminUserId" TEXT NOT NULL,
    "correctionOfId" TEXT,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkSnapshotPick" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rankableEntryId" TEXT,
    "rawName" TEXT NOT NULL,
    "sourceRank" INTEGER NOT NULL,
    "rankIqRank" INTEGER,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "issue" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "slotLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedRank" INTEGER,
    "kickoffAt" TIMESTAMP(3),

    CONSTRAINT "BenchmarkSnapshotPick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenchmarkSnapshot_contestId_universalProfileId_capturedAt_idx" ON "BenchmarkSnapshot"("contestId", "universalProfileId", "capturedAt");

-- CreateIndex
CREATE INDEX "BenchmarkSnapshot_weekId_universalProfileId_idx" ON "BenchmarkSnapshot"("weekId", "universalProfileId");

-- CreateIndex
CREATE INDEX "BenchmarkSnapshot_correctionOfId_idx" ON "BenchmarkSnapshot"("correctionOfId");

-- CreateIndex
CREATE INDEX "BenchmarkSnapshotPick_snapshotId_sourceRank_idx" ON "BenchmarkSnapshotPick"("snapshotId", "sourceRank");

-- CreateIndex
CREATE INDEX "BenchmarkSnapshotPick_rankableEntryId_idx" ON "BenchmarkSnapshotPick"("rankableEntryId");

-- AddForeignKey
ALTER TABLE "BenchmarkSnapshot" ADD CONSTRAINT "BenchmarkSnapshot_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkSnapshot" ADD CONSTRAINT "BenchmarkSnapshot_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkSnapshot" ADD CONSTRAINT "BenchmarkSnapshot_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkSnapshot" ADD CONSTRAINT "BenchmarkSnapshot_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkSnapshot" ADD CONSTRAINT "BenchmarkSnapshot_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "BenchmarkSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkSnapshotPick" ADD CONSTRAINT "BenchmarkSnapshotPick_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "BenchmarkSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkSnapshotPick" ADD CONSTRAINT "BenchmarkSnapshotPick_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
