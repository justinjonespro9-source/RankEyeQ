-- CreateEnum
CREATE TYPE "WeeklyAvailabilityDesignation" AS ENUM ('AVAILABLE', 'QUESTIONABLE', 'DOUBTFUL', 'OUT', 'INACTIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WeeklyAvailabilitySourceType" AS ENUM ('MANUAL', 'NFL_SYNC', 'IMPORT');

-- CreateTable
CREATE TABLE "PlayerWeekAvailability" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "designation" "WeeklyAvailabilityDesignation" NOT NULL DEFAULT 'UNKNOWN',
    "injuryDescription" TEXT,
    "sourceUrl" TEXT,
    "sourcePublishedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" "WeeklyAvailabilitySourceType" NOT NULL DEFAULT 'MANUAL',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerWeekAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerWeekAvailability_weekId_designation_idx" ON "PlayerWeekAvailability"("weekId", "designation");

-- CreateIndex
CREATE INDEX "PlayerWeekAvailability_rankableEntryId_idx" ON "PlayerWeekAvailability"("rankableEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerWeekAvailability_weekId_rankableEntryId_key" ON "PlayerWeekAvailability"("weekId", "rankableEntryId");

-- AddForeignKey
ALTER TABLE "PlayerWeekAvailability" ADD CONSTRAINT "PlayerWeekAvailability_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerWeekAvailability" ADD CONSTRAINT "PlayerWeekAvailability_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerWeekAvailability" ADD CONSTRAINT "PlayerWeekAvailability_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
