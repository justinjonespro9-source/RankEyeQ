-- Add CREATOR competitor class (distinct from monetization CreatorProfile).
ALTER TYPE "ProfileType" ADD VALUE 'CREATOR';

CREATE TABLE "CreatorCompetitorProfile" (
    "id" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "personName" TEXT,
    "brandName" TEXT,
    "sourceUrl" TEXT,
    "positionsCovered" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorCompetitorProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorCompetitorProfile_universalProfileId_key"
  ON "CreatorCompetitorProfile"("universalProfileId");

CREATE INDEX "CreatorCompetitorProfile_active_idx"
  ON "CreatorCompetitorProfile"("active");

ALTER TABLE "CreatorCompetitorProfile"
  ADD CONSTRAINT "CreatorCompetitorProfile_universalProfileId_fkey"
  FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
