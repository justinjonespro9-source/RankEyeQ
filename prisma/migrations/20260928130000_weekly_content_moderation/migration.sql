-- AlterTable
ALTER TABLE "WeeklyContent" ADD COLUMN     "suppressedAt" TIMESTAMP(3),
ADD COLUMN     "suppressedByUserId" TEXT,
ADD COLUMN     "suppressionReason" TEXT;

-- AddForeignKey
ALTER TABLE "WeeklyContent" ADD CONSTRAINT "WeeklyContent_suppressedByUserId_fkey" FOREIGN KEY ("suppressedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
