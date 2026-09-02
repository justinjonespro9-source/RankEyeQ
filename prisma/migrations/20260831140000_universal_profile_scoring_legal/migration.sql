-- Universal profile fields, ranking scoring versions, legal policy acceptance

CREATE TYPE "ScoringVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

ALTER TABLE "UniversalProfile" ADD COLUMN "bio" TEXT;
ALTER TABLE "UniversalProfile" ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Season" ADD COLUMN "activeRankingScoringVersionId" TEXT;

ALTER TABLE "RankIQContest" ADD COLUMN "rankingScoringVersionId" TEXT;

CREATE TABLE "RankingScoringVersion" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ScoringVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "config" JSONB NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingScoringVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyDocument" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyDocumentId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RankingScoringVersion_slug_key" ON "RankingScoringVersion"("slug");

CREATE UNIQUE INDEX "PolicyDocument_slug_version_key" ON "PolicyDocument"("slug", "version");

CREATE INDEX "PolicyDocument_slug_publishedAt_idx" ON "PolicyDocument"("slug", "publishedAt");

CREATE UNIQUE INDEX "PolicyAcceptance_userId_policyDocumentId_key" ON "PolicyAcceptance"("userId", "policyDocumentId");

CREATE INDEX "PolicyAcceptance_userId_idx" ON "PolicyAcceptance"("userId");

ALTER TABLE "Season" ADD CONSTRAINT "Season_activeRankingScoringVersionId_fkey" FOREIGN KEY ("activeRankingScoringVersionId") REFERENCES "RankingScoringVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RankIQContest" ADD CONSTRAINT "RankIQContest_rankingScoringVersionId_fkey" FOREIGN KEY ("rankingScoringVersionId") REFERENCES "RankingScoringVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PolicyAcceptance" ADD CONSTRAINT "PolicyAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyAcceptance" ADD CONSTRAINT "PolicyAcceptance_policyDocumentId_fkey" FOREIGN KEY ("policyDocumentId") REFERENCES "PolicyDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed production V1 scoring formula (matches lib/scoring.ts constants)
INSERT INTO "RankingScoringVersion" ("id", "slug", "label", "status", "description", "config", "activatedAt", "updatedAt")
VALUES (
  'rsc_v1_production',
  'rankeyeq-v1',
  'RankEyeQ V1 (Production)',
  'ACTIVE',
  'Podium pool scoring with fixed precision ladder and 0–100 normalization.',
  '{"baseHitPoints":10,"podiumCallBonus":10,"podiumPickSlots":3,"precisionExact":5,"precisionOffBy1":3,"precisionOffBy2":1,"actualPodiumPoints":{"1":20,"2":15,"3":10}}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

UPDATE "Season" SET "activeRankingScoringVersionId" = 'rsc_v1_production' WHERE "activeRankingScoringVersionId" IS NULL;
