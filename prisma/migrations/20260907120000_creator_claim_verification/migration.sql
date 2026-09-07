-- Creator verification / claim status on CreatorCompetitorProfile
CREATE TYPE "CreatorClaimStatus" AS ENUM ('UNCLAIMED', 'REQUESTED', 'VERIFIED', 'REJECTED');

ALTER TABLE "CreatorCompetitorProfile"
  ADD COLUMN "claimStatus" "CreatorClaimStatus" NOT NULL DEFAULT 'UNCLAIMED',
  ADD COLUMN "claimRequestedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedByUserId" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "creatorSiteUrl" TEXT,
  ADD COLUMN "socialHandle" TEXT,
  ADD COLUMN "socialUrl" TEXT,
  ADD COLUMN "publicProofUrl" TEXT,
  ADD COLUMN "claimNote" TEXT,
  ADD COLUMN "verificationNotes" TEXT,
  ADD COLUMN "claimTargetProfileId" TEXT;

CREATE INDEX "CreatorCompetitorProfile_claimStatus_idx"
  ON "CreatorCompetitorProfile"("claimStatus");

CREATE INDEX "CreatorCompetitorProfile_claimTargetProfileId_idx"
  ON "CreatorCompetitorProfile"("claimTargetProfileId");

ALTER TABLE "CreatorCompetitorProfile"
  ADD CONSTRAINT "CreatorCompetitorProfile_claimTargetProfileId_fkey"
  FOREIGN KEY ("claimTargetProfileId") REFERENCES "UniversalProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CreatorCompetitorProfile"
  ADD CONSTRAINT "CreatorCompetitorProfile_verifiedByUserId_fkey"
  FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
