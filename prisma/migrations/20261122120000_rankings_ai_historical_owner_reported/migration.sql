-- Simplify Rankings AI historical entry: optional evidence + OWNER_REPORTED/VERIFIED.
-- Additive only; existing provenance rows keep their evidence and become OWNER_REPORTED
-- until an owner separately reclassifies (this migration does not rewrite rows to VERIFIED).

CREATE TYPE "RankingAiHistoricalProvenanceClass" AS ENUM (
  'OWNER_REPORTED',
  'VERIFIED'
);

ALTER TABLE "RankingAiHistoricalProvenance"
  ADD COLUMN "provenanceClass" "RankingAiHistoricalProvenanceClass" NOT NULL DEFAULT 'OWNER_REPORTED';

ALTER TABLE "RankingAiHistoricalProvenance"
  ALTER COLUMN "evidenceType" DROP NOT NULL;

ALTER TABLE "RankingAiHistoricalProvenance"
  ALTER COLUMN "evidenceReference" DROP NOT NULL;

CREATE INDEX "RankingAiHistoricalProvenance_provenanceClass_idx"
  ON "RankingAiHistoricalProvenance"("provenanceClass");
