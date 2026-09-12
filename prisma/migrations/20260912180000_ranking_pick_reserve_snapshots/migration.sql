-- Reserve anti-hindsight + kickoff availability freeze (derived promotion).
ALTER TABLE "RankingPick" ADD COLUMN "reserveEligiblePredecessorIds" JSONB;
ALTER TABLE "RankingPick" ADD COLUMN "wasUnavailableAtKickoff" BOOLEAN;
