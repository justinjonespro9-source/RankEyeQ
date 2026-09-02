-- League-wide actual finishes + immutable pregame consensus snapshots

ALTER TABLE "PlayerWeekStat" ADD COLUMN "leagueActualRank" INTEGER;
ALTER TABLE "DefenseWeekStat" ADD COLUMN "leagueActualRank" INTEGER;

CREATE INDEX "PlayerWeekStat_weekId_leagueActualRank_idx" ON "PlayerWeekStat"("weekId", "leagueActualRank");
CREATE INDEX "DefenseWeekStat_weekId_leagueActualRank_idx" ON "DefenseWeekStat"("weekId", "leagueActualRank");

CREATE TABLE "ContestPregameSnapshot" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL,
    "sampleSizeAll" INTEGER NOT NULL DEFAULT 0,
    "sampleSizeHuman" INTEGER NOT NULL DEFAULT 0,
    "sampleSizeAi" INTEGER NOT NULL DEFAULT 0,
    "sampleSizeExpert" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestPregameSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContestPregameSnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "selectionRateAll" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageSelectedRankAll" DOUBLE PRECISION,
    "selectionRateHuman" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageSelectedRankHuman" DOUBLE PRECISION,
    "selectionRateAi" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageSelectedRankAi" DOUBLE PRECISION,
    "selectionRateExpert" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageSelectedRankExpert" DOUBLE PRECISION,
    "consensusRankAll" INTEGER,
    "consensusRankHuman" INTEGER,
    "consensusRankAi" INTEGER,
    "consensusRankExpert" INTEGER,

    CONSTRAINT "ContestPregameSnapshotEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContestPregameSnapshot_contestId_key" ON "ContestPregameSnapshot"("contestId");
CREATE INDEX "ContestPregameSnapshot_lockedAt_idx" ON "ContestPregameSnapshot"("lockedAt");

CREATE UNIQUE INDEX "ContestPregameSnapshotEntry_snapshotId_rankableEntryId_key" ON "ContestPregameSnapshotEntry"("snapshotId", "rankableEntryId");
CREATE INDEX "ContestPregameSnapshotEntry_snapshotId_consensusRankAll_idx" ON "ContestPregameSnapshotEntry"("snapshotId", "consensusRankAll");

ALTER TABLE "ContestPregameSnapshot" ADD CONSTRAINT "ContestPregameSnapshot_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "RankIQContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContestPregameSnapshotEntry" ADD CONSTRAINT "ContestPregameSnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ContestPregameSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContestPregameSnapshotEntry" ADD CONSTRAINT "ContestPregameSnapshotEntry_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
