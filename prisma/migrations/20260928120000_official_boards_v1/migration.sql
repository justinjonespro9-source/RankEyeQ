-- CreateEnum
CREATE TYPE "OfficialBoardVersionKind" AS ENUM ('PUBLISHED', 'FINAL');

-- CreateEnum
CREATE TYPE "WeeklyContentType" AS ENUM ('VIDEO', 'ARTICLE', 'PODCAST', 'RANKINGS', 'OTHER');

-- CreateTable
CREATE TABLE "OfficialBoardPublication" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "firstPublishedAt" TIMESTAMP(3) NOT NULL,
    "lastPublishedAt" TIMESTAMP(3) NOT NULL,
    "latestPublishedVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficialBoardPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficialBoardVersion" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" "OfficialBoardVersionKind" NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "authorUserId" TEXT,
    "rankingDepth" INTEGER NOT NULL,
    "reserveCount" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "boardLockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficialBoardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficialBoardVersionPick" (
    "id" TEXT NOT NULL,
    "boardVersionId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "boardRank" INTEGER NOT NULL,
    "isReserve" BOOLEAN NOT NULL,
    "reserveSlot" INTEGER,
    "displayName" TEXT NOT NULL,
    "displayTeam" TEXT NOT NULL,
    "slotLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedRank" INTEGER,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "OfficialBoardVersionPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyContent" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "WeeklyContentType" NOT NULL,
    "position" "ContestPosition",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficialBoardPublication_submissionId_key" ON "OfficialBoardPublication"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "OfficialBoardPublication_latestPublishedVersionId_key" ON "OfficialBoardPublication"("latestPublishedVersionId");

-- CreateIndex
CREATE INDEX "OfficialBoardPublication_contestId_idx" ON "OfficialBoardPublication"("contestId");

-- CreateIndex
CREATE INDEX "OfficialBoardPublication_profileId_idx" ON "OfficialBoardPublication"("profileId");

-- CreateIndex
CREATE INDEX "OfficialBoardVersion_contestId_kind_idx" ON "OfficialBoardVersion"("contestId", "kind");

-- CreateIndex
CREATE INDEX "OfficialBoardVersion_profileId_idx" ON "OfficialBoardVersion"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "OfficialBoardVersion_submissionId_kind_versionNumber_key" ON "OfficialBoardVersion"("submissionId", "kind", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OfficialBoardVersionPick_boardVersionId_boardRank_key" ON "OfficialBoardVersionPick"("boardVersionId", "boardRank");

-- CreateIndex
CREATE UNIQUE INDEX "OfficialBoardVersionPick_boardVersionId_rankableEntryId_key" ON "OfficialBoardVersionPick"("boardVersionId", "rankableEntryId");

-- CreateIndex
CREATE INDEX "WeeklyContent_profileId_weekId_idx" ON "WeeklyContent"("profileId", "weekId");

-- CreateIndex
CREATE INDEX "WeeklyContent_weekId_idx" ON "WeeklyContent"("weekId");

-- AddForeignKey
ALTER TABLE "OfficialBoardPublication" ADD CONSTRAINT "OfficialBoardPublication_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "RankingSubmission"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardPublication" ADD CONSTRAINT "OfficialBoardPublication_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardPublication" ADD CONSTRAINT "OfficialBoardPublication_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UniversalProfile"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardPublication" ADD CONSTRAINT "OfficialBoardPublication_latestPublishedVersionId_fkey" FOREIGN KEY ("latestPublishedVersionId") REFERENCES "OfficialBoardVersion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardVersion" ADD CONSTRAINT "OfficialBoardVersion_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "RankingSubmission"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardVersion" ADD CONSTRAINT "OfficialBoardVersion_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardVersion" ADD CONSTRAINT "OfficialBoardVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UniversalProfile"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardVersion" ADD CONSTRAINT "OfficialBoardVersion_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardVersionPick" ADD CONSTRAINT "OfficialBoardVersionPick_boardVersionId_fkey" FOREIGN KEY ("boardVersionId") REFERENCES "OfficialBoardVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialBoardVersionPick" ADD CONSTRAINT "OfficialBoardVersionPick_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyContent" ADD CONSTRAINT "WeeklyContent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyContent" ADD CONSTRAINT "WeeklyContent_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- FINAL is always version 1, so the (submissionId, kind, versionNumber) unique index allows one FINAL per board.
ALTER TABLE "OfficialBoardVersion" ADD CONSTRAINT "OfficialBoardVersion_final_version_check" CHECK ("kind" <> 'FINAL' OR "versionNumber" = 1);

-- Version numbers start at 1.
ALTER TABLE "OfficialBoardVersion" ADD CONSTRAINT "OfficialBoardVersion_version_number_check" CHECK ("versionNumber" >= 1);
