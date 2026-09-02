-- AlterTable
ALTER TABLE "Week" ADD COLUMN     "fantasyScoringVersion" TEXT NOT NULL DEFAULT 'RANKIQ_NFL_PPR_V1';

-- CreateTable
CREATE TABLE "PlayerWeekStat" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "rankableEntryId" TEXT,
    "gameId" TEXT,
    "externalPlayerId" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "passingYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passingTds" INTEGER NOT NULL DEFAULT 0,
    "interceptions" INTEGER NOT NULL DEFAULT 0,
    "rushingYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rushingTds" INTEGER NOT NULL DEFAULT 0,
    "receptions" INTEGER NOT NULL DEFAULT 0,
    "receivingYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receivingTds" INTEGER NOT NULL DEFAULT 0,
    "twoPointConversions" INTEGER NOT NULL DEFAULT 0,
    "fumblesLost" INTEGER NOT NULL DEFAULT 0,
    "returnTds" INTEGER NOT NULL DEFAULT 0,
    "fantasyPoints" DOUBLE PRECISION NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerWeekStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefenseWeekStat" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "rankableEntryId" TEXT,
    "gameId" TEXT,
    "team" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "sacks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interceptions" INTEGER NOT NULL DEFAULT 0,
    "fumbleRecoveries" INTEGER NOT NULL DEFAULT 0,
    "defensiveTds" INTEGER NOT NULL DEFAULT 0,
    "specialTeamsTds" INTEGER NOT NULL DEFAULT 0,
    "safeties" INTEGER NOT NULL DEFAULT 0,
    "blockedKicks" INTEGER NOT NULL DEFAULT 0,
    "pointsAllowed" INTEGER NOT NULL DEFAULT 0,
    "fantasyPoints" DOUBLE PRECISION NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefenseWeekStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerWeekStat_weekId_fantasyPoints_idx" ON "PlayerWeekStat"("weekId", "fantasyPoints");

-- CreateIndex
CREATE INDEX "PlayerWeekStat_rankableEntryId_idx" ON "PlayerWeekStat"("rankableEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerWeekStat_provider_weekId_externalPlayerId_key" ON "PlayerWeekStat"("provider", "weekId", "externalPlayerId");

-- CreateIndex
CREATE INDEX "DefenseWeekStat_weekId_fantasyPoints_idx" ON "DefenseWeekStat"("weekId", "fantasyPoints");

-- CreateIndex
CREATE INDEX "DefenseWeekStat_rankableEntryId_idx" ON "DefenseWeekStat"("rankableEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "DefenseWeekStat_provider_weekId_team_key" ON "DefenseWeekStat"("provider", "weekId", "team");

-- AddForeignKey
ALTER TABLE "PlayerWeekStat" ADD CONSTRAINT "PlayerWeekStat_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerWeekStat" ADD CONSTRAINT "PlayerWeekStat_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerWeekStat" ADD CONSTRAINT "PlayerWeekStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "NflGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefenseWeekStat" ADD CONSTRAINT "DefenseWeekStat_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefenseWeekStat" ADD CONSTRAINT "DefenseWeekStat_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefenseWeekStat" ADD CONSTRAINT "DefenseWeekStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "NflGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

