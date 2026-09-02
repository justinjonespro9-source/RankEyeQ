-- CreateEnum
CREATE TYPE "BoardRevealPreference" AS ENUM ('FREE_REVEAL', 'PREMIUM_REVEAL');

-- CreateEnum
CREATE TYPE "EntitlementType" AS ENUM ('SINGLE_BOARD', 'CREATOR_WEEK', 'POSITION_WEEK', 'WEEK_ALL_ACCESS', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "UnlockAccessType" AS ENUM ('FREE_REVEAL', 'PREMIUM_ENTITLEMENT', 'PUBLIC_AFTER_RELEASE', 'OWNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('TEST', 'BOARD_UNLOCK', 'SUBSCRIPTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('PENDING', 'EARNED', 'PAYABLE', 'PAID', 'REVERSED');

-- AlterTable
ALTER TABLE "RankingSubmission" ADD COLUMN "revealPreference" "BoardRevealPreference" NOT NULL DEFAULT 'FREE_REVEAL';

-- CreateTable
CREATE TABLE "ProfileFollow" (
    "id" TEXT NOT NULL,
    "followerProfileId" TEXT NOT NULL,
    "followedProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultRevealPreference" "BoardRevealPreference" NOT NULL DEFAULT 'FREE_REVEAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardEntitlement" (
    "id" TEXT NOT NULL,
    "viewerProfileId" TEXT NOT NULL,
    "entitlementType" "EntitlementType" NOT NULL,
    "contestId" TEXT,
    "creatorProfileId" TEXT,
    "weekId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardUnlockEvent" (
    "id" TEXT NOT NULL,
    "viewerProfileId" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "entitlementId" TEXT,
    "accessType" "UnlockAccessType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardUnlockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorLedgerEntry" (
    "id" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "viewerProfileId" TEXT,
    "contestId" TEXT,
    "entitlementId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "grossAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "platformFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "creatorAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileFollow_followerProfileId_followedProfileId_key" ON "ProfileFollow"("followerProfileId", "followedProfileId");

-- CreateIndex
CREATE INDEX "ProfileFollow_followedProfileId_idx" ON "ProfileFollow"("followedProfileId");

-- CreateIndex
CREATE INDEX "ProfileFollow_followerProfileId_createdAt_idx" ON "ProfileFollow"("followerProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_universalProfileId_key" ON "CreatorProfile"("universalProfileId");

-- CreateIndex
CREATE INDEX "BoardEntitlement_viewerProfileId_revokedAt_idx" ON "BoardEntitlement"("viewerProfileId", "revokedAt");

-- CreateIndex
CREATE INDEX "BoardEntitlement_creatorProfileId_idx" ON "BoardEntitlement"("creatorProfileId");

-- CreateIndex
CREATE INDEX "BoardEntitlement_contestId_idx" ON "BoardEntitlement"("contestId");

-- CreateIndex
CREATE INDEX "BoardEntitlement_weekId_idx" ON "BoardEntitlement"("weekId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardUnlockEvent_viewerProfileId_creatorProfileId_contestId_key" ON "BoardUnlockEvent"("viewerProfileId", "creatorProfileId", "contestId");

-- CreateIndex
CREATE INDEX "BoardUnlockEvent_creatorProfileId_createdAt_idx" ON "BoardUnlockEvent"("creatorProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "BoardUnlockEvent_contestId_idx" ON "BoardUnlockEvent"("contestId");

-- CreateIndex
CREATE INDEX "CreatorLedgerEntry_creatorProfileId_createdAt_idx" ON "CreatorLedgerEntry"("creatorProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "CreatorLedgerEntry_status_idx" ON "CreatorLedgerEntry"("status");

-- AddForeignKey
ALTER TABLE "ProfileFollow" ADD CONSTRAINT "ProfileFollow_followerProfileId_fkey" FOREIGN KEY ("followerProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileFollow" ADD CONSTRAINT "ProfileFollow_followedProfileId_fkey" FOREIGN KEY ("followedProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardEntitlement" ADD CONSTRAINT "BoardEntitlement_viewerProfileId_fkey" FOREIGN KEY ("viewerProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardEntitlement" ADD CONSTRAINT "BoardEntitlement_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "UniversalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardEntitlement" ADD CONSTRAINT "BoardEntitlement_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardEntitlement" ADD CONSTRAINT "BoardEntitlement_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardUnlockEvent" ADD CONSTRAINT "BoardUnlockEvent_viewerProfileId_fkey" FOREIGN KEY ("viewerProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardUnlockEvent" ADD CONSTRAINT "BoardUnlockEvent_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardUnlockEvent" ADD CONSTRAINT "BoardUnlockEvent_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardUnlockEvent" ADD CONSTRAINT "BoardUnlockEvent_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "BoardEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLedgerEntry" ADD CONSTRAINT "CreatorLedgerEntry_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLedgerEntry" ADD CONSTRAINT "CreatorLedgerEntry_viewerProfileId_fkey" FOREIGN KEY ("viewerProfileId") REFERENCES "UniversalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLedgerEntry" ADD CONSTRAINT "CreatorLedgerEntry_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLedgerEntry" ADD CONSTRAINT "CreatorLedgerEntry_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "BoardEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
