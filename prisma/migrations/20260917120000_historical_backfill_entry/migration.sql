-- Admin Historical / Backfill Entry audit fields.
ALTER TABLE "BenchmarkSnapshot" ADD COLUMN IF NOT EXISTS "historicalBackfill" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BenchmarkSnapshot" ADD COLUMN IF NOT EXISTS "backfilledAt" TIMESTAMP(3);
ALTER TABLE "BenchmarkSnapshot" ADD COLUMN IF NOT EXISTS "enteredAfterFullLock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BenchmarkSnapshot" ADD COLUMN IF NOT EXISTS "enteredAfterWeekComplete" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RankingSubmission" ADD COLUMN IF NOT EXISTS "historicalBackfill" BOOLEAN NOT NULL DEFAULT false;
