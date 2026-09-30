-- CreateEnum
CREATE TYPE "WaiverSnapshotStatus" AS ENUM ('FROZEN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "WaiverEvidenceRole" AS ENUM ('CANDIDATE', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "WaiverEligibility" AS ENUM ('ELIGIBLE', 'EXCLUDED', 'OBSERVATION_ONLY');

-- CreateEnum
CREATE TYPE "WaiverExclusionReason" AS ENUM ('AT_OR_ABOVE_THRESHOLD', 'BYE', 'NO_SCHEDULED_GAME', 'HARD_UNAVAILABLE', 'NOT_ON_NFL_ROSTER', 'POSITION_MISMATCH', 'ADMIN_EXCLUDED');

-- CreateEnum
CREATE TYPE "WaiverMatchMethod" AS ENUM ('EXTERNAL_ID', 'EXACT_NAME_TEAM', 'ALIAS_TEAM', 'ADMIN_CONFIRMED');

-- CreateEnum
CREATE TYPE "WaiverCorrectionCase" AS ENUM ('PRE_SUBMISSION', 'OPEN_WITH_SUBMISSIONS', 'POST_LOCK', 'POST_GRADE');

-- CreateEnum
CREATE TYPE "WaiverCorrectionPolicy" AS ENUM ('NO_BOARD_EFFECT', 'AFFECTED_BOARDS_FLAGGED', 'POLICY_DECISION_REQUIRED');

-- CreateTable
CREATE TABLE "WaiverSnapshot" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WaiverSnapshotStatus" NOT NULL DEFAULT 'FROZEN',
    "currentForWeekId" TEXT,
    "thresholdBps" INTEGER NOT NULL DEFAULT 5000,
    "sourceLabel" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenByUserId" TEXT NOT NULL,
    "rawInputSha256" TEXT NOT NULL,
    "entriesFingerprint" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL,
    "followUpCount" INTEGER NOT NULL,
    "supersedesId" TEXT,
    "correctionCase" "WaiverCorrectionCase",
    "correctionReason" TEXT,
    "manualImportLogId" TEXT,

    CONSTRAINT "WaiverSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverSnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "evidenceRole" "WaiverEvidenceRole" NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "displayNameAtFreeze" TEXT NOT NULL,
    "teamAtFreeze" TEXT,
    "rosteredBps" INTEGER NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "inputLineNumber" INTEGER NOT NULL,
    "inputLine" TEXT NOT NULL,
    "matchMethod" "WaiverMatchMethod" NOT NULL,
    "eligibility" "WaiverEligibility" NOT NULL,
    "exclusionReason" "WaiverExclusionReason",
    "exclusionNote" TEXT,
    "nflGameId" TEXT,
    "opponentAtFreeze" TEXT,
    "kickoffAtFreeze" TIMESTAMP(3),
    "isByeAtFreeze" BOOLEAN NOT NULL,
    "availabilityDesignationAtFreeze" "WeeklyAvailabilityDesignation",
    "rosterStatusAtFreeze" TEXT,
    "availabilitySourceAtFreeze" TEXT,
    "hardUnavailableAtFreeze" BOOLEAN NOT NULL,

    CONSTRAINT "WaiverSnapshotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverSnapshotCorrection" (
    "id" TEXT NOT NULL,
    "fromSnapshotId" TEXT NOT NULL,
    "toSnapshotId" TEXT NOT NULL,
    "rankableEntryId" TEXT,
    "field" TEXT NOT NULL,
    "originalValue" JSONB NOT NULL,
    "correctedValue" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "correctionCase" "WaiverCorrectionCase" NOT NULL,
    "policy" "WaiverCorrectionPolicy" NOT NULL,
    "eligibilityBefore" "WaiverEligibility",
    "eligibilityAfter" "WaiverEligibility",
    "affectedSubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "affectedCallIds" JSONB,
    "operatorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverSnapshotCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSnapshot_currentForWeekId_key" ON "WaiverSnapshot"("currentForWeekId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSnapshot_supersedesId_key" ON "WaiverSnapshot"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSnapshot_manualImportLogId_key" ON "WaiverSnapshot"("manualImportLogId");

-- CreateIndex
CREATE INDEX "WaiverSnapshot_seasonId_weekId_idx" ON "WaiverSnapshot"("seasonId", "weekId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSnapshot_weekId_version_key" ON "WaiverSnapshot"("weekId", "version");

-- CreateIndex
CREATE INDEX "WaiverSnapshotEntry_rankableEntryId_snapshotId_idx" ON "WaiverSnapshotEntry"("rankableEntryId", "snapshotId");

-- CreateIndex
CREATE INDEX "WaiverSnapshotEntry_snapshotId_position_eligibility_idx" ON "WaiverSnapshotEntry"("snapshotId", "position", "eligibility");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSnapshotEntry_snapshotId_rankableEntryId_key" ON "WaiverSnapshotEntry"("snapshotId", "rankableEntryId");

-- CreateIndex
CREATE INDEX "WaiverSnapshotCorrection_toSnapshotId_idx" ON "WaiverSnapshotCorrection"("toSnapshotId");

-- CreateIndex
CREATE INDEX "WaiverSnapshotCorrection_fromSnapshotId_idx" ON "WaiverSnapshotCorrection"("fromSnapshotId");

-- CreateIndex
CREATE INDEX "WaiverSnapshotCorrection_rankableEntryId_idx" ON "WaiverSnapshotCorrection"("rankableEntryId");

-- AddForeignKey
ALTER TABLE "WaiverSnapshot" ADD CONSTRAINT "WaiverSnapshot_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshot" ADD CONSTRAINT "WaiverSnapshot_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshot" ADD CONSTRAINT "WaiverSnapshot_frozenByUserId_fkey" FOREIGN KEY ("frozenByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshot" ADD CONSTRAINT "WaiverSnapshot_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_nflGameId_fkey" FOREIGN KEY ("nflGameId") REFERENCES "NflGame"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshotCorrection" ADD CONSTRAINT "WaiverSnapshotCorrection_fromSnapshotId_fkey" FOREIGN KEY ("fromSnapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshotCorrection" ADD CONSTRAINT "WaiverSnapshotCorrection_toSnapshotId_fkey" FOREIGN KEY ("toSnapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshotCorrection" ADD CONSTRAINT "WaiverSnapshotCorrection_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSnapshotCorrection" ADD CONSTRAINT "WaiverSnapshotCorrection_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

