-- New canonical fantasy scoring default: Half PPR.
-- Existing Season/Week rows keep their stored fantasyScoringVersion until
-- explicitly updated (see scripts/set-fantasy-scoring-version.ts).

ALTER TABLE "Season"
  ALTER COLUMN "fantasyScoringVersion"
  SET DEFAULT 'FANTASYTRACK_NFL_HALF_PPR_V1';

ALTER TABLE "Week"
  ALTER COLUMN "fantasyScoringVersion"
  SET DEFAULT 'FANTASYTRACK_NFL_HALF_PPR_V1';
