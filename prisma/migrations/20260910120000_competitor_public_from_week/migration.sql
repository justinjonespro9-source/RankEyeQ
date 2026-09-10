-- AlterTable
ALTER TABLE "UniversalProfile" ADD COLUMN "publicFromWeekId" TEXT;

-- AddForeignKey
ALTER TABLE "UniversalProfile" ADD CONSTRAINT "UniversalProfile_publicFromWeekId_fkey" FOREIGN KEY ("publicFromWeekId") REFERENCES "Week"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "UniversalProfile_publicFromWeekId_idx" ON "UniversalProfile"("publicFromWeekId");
