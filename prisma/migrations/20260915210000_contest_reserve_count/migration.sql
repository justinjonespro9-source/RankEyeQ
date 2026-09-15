-- Contest-scoped reserve depth (legacy Week 1 = 0; current weeks = 2).
ALTER TABLE "RankIQContest" ADD COLUMN IF NOT EXISTS "reserveCount" INTEGER NOT NULL DEFAULT 2;

-- Contests created before the reserve-snapshots migration were submitted at
-- scoring depth only (QB/RB/TE/DEF = 10, WR = 15). Do not require +2 reserves.
UPDATE "RankIQContest"
SET "reserveCount" = 0
WHERE "createdAt" < TIMESTAMPTZ '2026-09-12 00:00:00+00';
