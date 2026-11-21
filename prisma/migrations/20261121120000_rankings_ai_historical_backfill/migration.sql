-- Rankings AI verified historical / backfill entry provenance (dual-clock).
CREATE TYPE "RankingAiHistoricalEvidenceType" AS ENUM (
  'PROVIDER_EXPORT',
  'CHAT_TRANSCRIPT',
  'API_LOG',
  'SCREENSHOT',
  'OTHER'
);

CREATE TABLE "RankingAiHistoricalProvenance" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "contestId" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "universalProfileId" TEXT NOT NULL,
  "originalPredictionAt" TIMESTAMP(3) NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "evidenceType" "RankingAiHistoricalEvidenceType" NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "sourceIdentifier" TEXT,
  "rawResponseText" TEXT,
  "responseSha256" TEXT NOT NULL,
  "rankedEntryIds" JSONB NOT NULL,
  "previewFingerprint" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "attestationAcceptedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RankingAiHistoricalProvenance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RankingAiHistoricalProvenance_submissionId_key"
  ON "RankingAiHistoricalProvenance"("submissionId");

CREATE INDEX "RankingAiHistoricalProvenance_weekId_contestId_idx"
  ON "RankingAiHistoricalProvenance"("weekId", "contestId");

CREATE INDEX "RankingAiHistoricalProvenance_universalProfileId_idx"
  ON "RankingAiHistoricalProvenance"("universalProfileId");

CREATE INDEX "RankingAiHistoricalProvenance_adminUserId_idx"
  ON "RankingAiHistoricalProvenance"("adminUserId");

CREATE INDEX "RankingAiHistoricalProvenance_originalPredictionAt_idx"
  ON "RankingAiHistoricalProvenance"("originalPredictionAt");

ALTER TABLE "RankingAiHistoricalProvenance"
  ADD CONSTRAINT "RankingAiHistoricalProvenance_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "RankingSubmission"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RankingAiHistoricalProvenance"
  ADD CONSTRAINT "RankingAiHistoricalProvenance_contestId_fkey"
  FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RankingAiHistoricalProvenance"
  ADD CONSTRAINT "RankingAiHistoricalProvenance_weekId_fkey"
  FOREIGN KEY ("weekId") REFERENCES "Week"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RankingAiHistoricalProvenance"
  ADD CONSTRAINT "RankingAiHistoricalProvenance_universalProfileId_fkey"
  FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RankingAiHistoricalProvenance"
  ADD CONSTRAINT "RankingAiHistoricalProvenance_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
