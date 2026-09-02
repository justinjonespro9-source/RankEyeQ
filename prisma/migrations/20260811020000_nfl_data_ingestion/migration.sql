-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "NflGameStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FINAL', 'POSTPONED', 'CANCELED', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- DropIndex
DROP INDEX IF EXISTS "RankableEntry_externalId_key";

-- Backfill null external ids before tightening constraint
UPDATE "RankableEntry"
SET "externalId" = 'legacy-' || "id"
WHERE "externalId" IS NULL;

-- ContestEntry columns
ALTER TABLE "ContestEntry" ADD COLUMN IF NOT EXISTS "excluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ContestEntry" ADD COLUMN IF NOT EXISTS "gameId" TEXT;
ALTER TABLE "ContestEntry" ADD COLUMN IF NOT EXISTS "manuallyAdded" BOOLEAN NOT NULL DEFAULT false;

-- RankableEntry columns / nullability
ALTER TABLE "RankableEntry" ADD COLUMN IF NOT EXISTS "gameId" TEXT;
ALTER TABLE "RankableEntry" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'mock';
ALTER TABLE "RankableEntry" ALTER COLUMN "externalId" SET NOT NULL;
ALTER TABLE "RankableEntry" ALTER COLUMN "opponent" SET DEFAULT 'TBD';
ALTER TABLE "RankableEntry" ALTER COLUMN "gameStartsAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "NflGame" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "seasonId" TEXT,
    "weekId" TEXT,
    "seasonYear" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" "NflGameStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NflGame_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NflGame_seasonYear_weekNumber_idx" ON "NflGame"("seasonYear", "weekNumber");
CREATE INDEX IF NOT EXISTS "NflGame_weekId_idx" ON "NflGame"("weekId");
CREATE UNIQUE INDEX IF NOT EXISTS "NflGame_provider_externalId_key" ON "NflGame"("provider", "externalId");
CREATE INDEX IF NOT EXISTS "ContestEntry_contestId_excluded_idx" ON "ContestEntry"("contestId", "excluded");
CREATE INDEX IF NOT EXISTS "RankableEntry_provider_position_idx" ON "RankableEntry"("provider", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "RankableEntry_provider_externalId_key" ON "RankableEntry"("provider", "externalId");

DO $$ BEGIN
  ALTER TABLE "NflGame" ADD CONSTRAINT "NflGame_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "NflGame" ADD CONSTRAINT "NflGame_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RankableEntry" ADD CONSTRAINT "RankableEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "NflGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ContestEntry" ADD CONSTRAINT "ContestEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "NflGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
