-- AlterTable
ALTER TABLE "RankableEntry" ADD COLUMN "adminNotes" TEXT;

-- CreateIndex
CREATE INDEX "RankableEntry_active_position_idx" ON "RankableEntry"("active", "position");

-- CreateTable
CREATE TABLE "ManualImportLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "weekId" TEXT,
    "importType" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualImportLog_weekId_createdAt_idx" ON "ManualImportLog"("weekId", "createdAt");

-- CreateIndex
CREATE INDEX "ManualImportLog_adminUserId_createdAt_idx" ON "ManualImportLog"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ManualImportLog_importType_idx" ON "ManualImportLog"("importType");

-- AddForeignKey
ALTER TABLE "ManualImportLog" ADD CONSTRAINT "ManualImportLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualImportLog" ADD CONSTRAINT "ManualImportLog_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE SET NULL ON UPDATE CASCADE;
