-- Publisher Consensus segment metrics + optional source scoring format.

ALTER TABLE "ExpertSourceProfile" ADD COLUMN IF NOT EXISTS "scoringFormat" TEXT;

ALTER TABLE "ContestPregameSnapshot" ADD COLUMN IF NOT EXISTS "sampleSizePublisher" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN IF NOT EXISTS "selectionRatePublisher" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN IF NOT EXISTS "averageSelectedRankPublisher" DOUBLE PRECISION;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN IF NOT EXISTS "selectedCountPublisher" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN IF NOT EXISTS "consensusRankPublisher" INTEGER;
