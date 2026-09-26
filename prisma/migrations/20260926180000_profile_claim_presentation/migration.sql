-- Additive: owner-controlled profile presentation + generalized Expert/Creator claims.
-- No destructive ops. No submission rewrites.

CREATE TYPE "ProfileClaimStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

ALTER TABLE "UniversalProfile"
  ADD COLUMN "headline" TEXT,
  ADD COLUMN "affiliation" TEXT,
  ADD COLUMN "websiteUrl" TEXT,
  ADD COLUMN "xUrl" TEXT,
  ADD COLUMN "youtubeUrl" TEXT,
  ADD COLUMN "instagramUrl" TEXT,
  ADD COLUMN "tiktokUrl" TEXT,
  ADD COLUMN "podcastUrl" TEXT,
  ADD COLUMN "featuredLinkTitle" TEXT,
  ADD COLUMN "featuredLinkUrl" TEXT,
  ADD COLUMN "ownershipVerifiedAt" TIMESTAMP(3);

CREATE TABLE "ProfileClaimRequest" (
  "id" TEXT NOT NULL,
  "claimantUserId" TEXT NOT NULL,
  "claimantProfileId" TEXT NOT NULL,
  "targetProfileId" TEXT NOT NULL,
  "status" "ProfileClaimStatus" NOT NULL DEFAULT 'REQUESTED',
  "creatorSiteUrl" TEXT,
  "socialHandle" TEXT,
  "socialUrl" TEXT,
  "publicProofUrl" TEXT,
  "claimNote" TEXT,
  "verificationNotes" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProfileClaimRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProfileClaimRequest_status_requestedAt_idx"
  ON "ProfileClaimRequest"("status", "requestedAt");

CREATE INDEX "ProfileClaimRequest_targetProfileId_idx"
  ON "ProfileClaimRequest"("targetProfileId");

CREATE INDEX "ProfileClaimRequest_claimantProfileId_idx"
  ON "ProfileClaimRequest"("claimantProfileId");

CREATE INDEX "ProfileClaimRequest_claimantUserId_idx"
  ON "ProfileClaimRequest"("claimantUserId");

ALTER TABLE "ProfileClaimRequest"
  ADD CONSTRAINT "ProfileClaimRequest_claimantUserId_fkey"
  FOREIGN KEY ("claimantUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfileClaimRequest"
  ADD CONSTRAINT "ProfileClaimRequest_claimantProfileId_fkey"
  FOREIGN KEY ("claimantProfileId") REFERENCES "UniversalProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfileClaimRequest"
  ADD CONSTRAINT "ProfileClaimRequest_targetProfileId_fkey"
  FOREIGN KEY ("targetProfileId") REFERENCES "UniversalProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfileClaimRequest"
  ADD CONSTRAINT "ProfileClaimRequest_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
