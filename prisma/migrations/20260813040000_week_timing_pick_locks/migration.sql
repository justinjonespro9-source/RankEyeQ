-- AlterTable
ALTER TABLE "Week" ADD COLUMN "rankingsOpenAt" TIMESTAMP(3),
ADD COLUMN "fullLockAt" TIMESTAMP(3),
ADD COLUMN "revealStartsAt" TIMESTAMP(3),
ADD COLUMN "publicReleaseAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RankingPick" ADD COLUMN "committedAt" TIMESTAMP(3),
ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "lockedRank" INTEGER,
ADD COLUMN "slotLocked" BOOLEAN NOT NULL DEFAULT false;
