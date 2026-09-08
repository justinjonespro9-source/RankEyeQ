-- Preserve raw per-segment ballot counts for Consensus BALLOTS (All = sum of individuals).

ALTER TABLE "ContestPregameSnapshot" ADD COLUMN "sampleSizeCreator" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN "selectedCountAll" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN "selectedCountHuman" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN "selectedCountAi" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN "selectedCountExpert" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN "selectedCountCreator" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN "selectionRateCreator" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN "averageSelectedRankCreator" DOUBLE PRECISION;
ALTER TABLE "ContestPregameSnapshotEntry" ADD COLUMN "consensusRankCreator" INTEGER;
