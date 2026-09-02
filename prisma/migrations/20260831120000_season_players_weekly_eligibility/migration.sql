-- Season player universe + weekly contest eligibility fields

CREATE TABLE "SeasonPlayer" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "nflStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activeOnNFLRoster" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonPlayer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeasonPlayer_seasonId_rankableEntryId_key" ON "SeasonPlayer"("seasonId", "rankableEntryId");
CREATE INDEX "SeasonPlayer_seasonId_position_team_idx" ON "SeasonPlayer"("seasonId", "position", "team");
CREATE INDEX "SeasonPlayer_rankableEntryId_idx" ON "SeasonPlayer"("rankableEntryId");

ALTER TABLE "SeasonPlayer" ADD CONSTRAINT "SeasonPlayer_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeasonPlayer" ADD CONSTRAINT "SeasonPlayer_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContestEntry" ADD COLUMN "weekTeam" TEXT;
ALTER TABLE "ContestEntry" ADD COLUMN "suggested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ContestEntry" ADD COLUMN "seedRank" INTEGER;
ALTER TABLE "ContestEntry" ADD COLUMN "inactiveReason" TEXT;
