-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "WeekStatus" AS ENUM ('UPCOMING', 'OPEN', 'LOCKED', 'COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContestPosition" AS ENUM ('QB', 'RB', 'WR', 'TE', 'DEF');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'OPEN', 'LOCKED', 'LIVE', 'GRADING', 'FINAL', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RankableEntryType" AS ENUM ('PLAYER', 'DEFENSE');

-- CreateEnum
CREATE TYPE "EntryAvailability" AS ENUM ('ACTIVE', 'QUESTIONABLE', 'DOUBTFUL', 'OUT', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED', 'GRADED');

-- CreateTable
CREATE TABLE "UniversalProfile" (
    "id" TEXT NOT NULL,
    "universalUserId" TEXT,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "profileType" "ProfileType" NOT NULL DEFAULT 'HUMAN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'NFL',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Week" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "WeekStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Week_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankIQContest" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'NFL',
    "position" "ContestPosition" NOT NULL,
    "title" TEXT NOT NULL,
    "rankingDepth" INTEGER NOT NULL,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "locksAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankIQContest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankableEntry" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "type" "RankableEntryType" NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "headshotUrl" TEXT,
    "gameStartsAt" TIMESTAMP(3) NOT NULL,
    "availability" "EntryAvailability" NOT NULL DEFAULT 'ACTIVE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankableEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestEntry" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "fantasyPoints" DOUBLE PRECISION,
    "actualRank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSubmission" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "rawScore" DOUBLE PRECISION,
    "normalizedScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingPick" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "predictedRank" INTEGER NOT NULL,
    "actualRank" INTEGER,
    "fantasyPoints" DOUBLE PRECISION,
    "basePoints" DOUBLE PRECISION,
    "accuracyPoints" DOUBLE PRECISION,
    "podiumPoints" DOUBLE PRECISION,
    "totalPoints" DOUBLE PRECISION,

    CONSTRAINT "RankingPick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UniversalProfile_universalUserId_key" ON "UniversalProfile"("universalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UniversalProfile_username_key" ON "UniversalProfile"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Season_year_sport_key" ON "Season"("year", "sport");

-- CreateIndex
CREATE UNIQUE INDEX "Week_seasonId_weekNumber_key" ON "Week"("seasonId", "weekNumber");

-- CreateIndex
CREATE INDEX "RankIQContest_seasonId_status_idx" ON "RankIQContest"("seasonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RankIQContest_weekId_position_key" ON "RankIQContest"("weekId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RankableEntry_externalId_key" ON "RankableEntry"("externalId");

-- CreateIndex
CREATE INDEX "RankableEntry_position_team_idx" ON "RankableEntry"("position", "team");

-- CreateIndex
CREATE INDEX "ContestEntry_contestId_actualRank_idx" ON "ContestEntry"("contestId", "actualRank");

-- CreateIndex
CREATE UNIQUE INDEX "ContestEntry_contestId_rankableEntryId_key" ON "ContestEntry"("contestId", "rankableEntryId");

-- CreateIndex
CREATE INDEX "RankingSubmission_contestId_status_idx" ON "RankingSubmission"("contestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSubmission_contestId_universalProfileId_key" ON "RankingSubmission"("contestId", "universalProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingPick_submissionId_predictedRank_key" ON "RankingPick"("submissionId", "predictedRank");

-- CreateIndex
CREATE UNIQUE INDEX "RankingPick_submissionId_rankableEntryId_key" ON "RankingPick"("submissionId", "rankableEntryId");

-- AddForeignKey
ALTER TABLE "Week" ADD CONSTRAINT "Week_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankIQContest" ADD CONSTRAINT "RankIQContest_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankIQContest" ADD CONSTRAINT "RankIQContest_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestEntry" ADD CONSTRAINT "ContestEntry_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestEntry" ADD CONSTRAINT "ContestEntry_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSubmission" ADD CONSTRAINT "RankingSubmission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSubmission" ADD CONSTRAINT "RankingSubmission_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingPick" ADD CONSTRAINT "RankingPick_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "RankingSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingPick" ADD CONSTRAINT "RankingPick_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
