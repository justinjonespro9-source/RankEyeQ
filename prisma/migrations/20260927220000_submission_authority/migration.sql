-- CreateEnum
CREATE TYPE "SubmissionAuthority" AS ENUM ('OWNER_AUTHORED', 'RANKEYEQ_CAPTURED', 'SYSTEM_OPERATED');

-- AlterTable
ALTER TABLE "RankingSubmission" ADD COLUMN     "authority" "SubmissionAuthority";

