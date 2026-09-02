-- AlterTable
ALTER TABLE "Week" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

-- DropForeignKey
ALTER TABLE "RankingSubmission" DROP CONSTRAINT "RankingSubmission_universalProfileId_fkey";

-- AddForeignKey
ALTER TABLE "RankingSubmission" ADD CONSTRAINT "RankingSubmission_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
