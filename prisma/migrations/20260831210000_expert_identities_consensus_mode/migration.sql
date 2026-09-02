-- Expert source identities + consensus ALL mode audit field

CREATE TABLE "ExpertSourceProfile" (
    "id" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "publicationName" TEXT,
    "analystName" TEXT,
    "sourceUrl" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'PUBLISHER',
    "positionsCovered" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertSourceProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpertSourceProfile_universalProfileId_key" ON "ExpertSourceProfile"("universalProfileId");
CREATE INDEX "ExpertSourceProfile_active_idx" ON "ExpertSourceProfile"("active");

ALTER TABLE "ExpertSourceProfile" ADD CONSTRAINT "ExpertSourceProfile_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContestPregameSnapshot" ADD COLUMN "allConsensusMode" TEXT NOT NULL DEFAULT 'group_weighted';
