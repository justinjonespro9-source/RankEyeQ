-- CreateEnum
CREATE TYPE "WaiverConflictKind" AS ENUM ('BYE_VS_SCHEDULED', 'TEAM_CHANGED');

-- CreateEnum
CREATE TYPE "WaiverConflictResolutionTreatment" AS ENUM ('SCORE_AS_RANKED', 'NON_PARTICIPANT_ZERO', 'NEUTRALIZED');

-- CreateEnum
CREATE TYPE "WaiverPoolMemberCategory" AS ENUM ('ELIGIBLE_POOL_MEMBER', 'INVALIDATED_CALLED_PLAYER');

-- CreateEnum
CREATE TYPE "WaiverCanonicalResultClass" AS ENUM ('RANKED', 'NON_PARTICIPANT', 'SYSTEMIC_NEUTRALIZE', 'SNAPSHOT_CONFLICT');

-- CreateEnum
CREATE TYPE "WaiverResultTreatment" AS ENUM ('RANKED', 'NON_PARTICIPANT_ZERO', 'NEUTRALIZED', 'INVALIDATED_PRE_LOCK');

-- CreateEnum
CREATE TYPE "WaiverNeutralizationPrecedence" AS ENUM ('D2_NEUTRALIZATION_OVER_C2_INVALIDATION', 'D3_NEUTRALIZATION_OVER_C2_INVALIDATION');

-- CreateEnum
CREATE TYPE "WaiverInvalidationBasis" AS ENUM ('NOT_ELIGIBLE_IN_PINNED_SNAPSHOT', 'ABSENT_FROM_PINNED_SNAPSHOT');

-- CreateEnum
CREATE TYPE "WaiverBoardResultKind" AS ENUM ('SCORED', 'NA_ZERO_CALL', 'NA_ALL_NEUTRALIZED', 'NA_NO_EFFECTIVE_SLOTS');

-- CreateEnum
CREATE TYPE "WaiverUngradableReason" AS ENUM ('CORRECTED_POOL_EMPTY', 'NEUTRALIZATIONS_CONSUMED_SLOTS');

-- CreateEnum
CREATE TYPE "WaiverHonor" AS ENUM ('PERFECT_CALL', 'PERFECT_PODIUM', 'PERFECT_FIVE');

-- CreateEnum
CREATE TYPE "WaiverGradeInitiator" AS ENUM ('OPERATOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WaiverGradeApprovalPolicy" AS ENUM ('SINGLE_ADMIN_EXPLICIT', 'SEPARATE_APPROVER');

-- CreateEnum
CREATE TYPE "WaiverGradeAuthorityChangeType" AS ENUM ('INITIAL_GRADE', 'REGRADE');

-- CreateTable
CREATE TABLE "WaiverConflictResolution" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "snapshotEntryId" TEXT NOT NULL,
    "artifactRowId" TEXT NOT NULL,
    "artifactRevision" INTEGER NOT NULL,
    "artifactContentChecksum" TEXT NOT NULL,
    "sngParticipantId" TEXT NOT NULL,
    "conflictKey" TEXT NOT NULL,
    "conflictKind" "WaiverConflictKind" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "supersedesResolutionId" TEXT,
    "reconfirmsResolutionId" TEXT,
    "resolution" "WaiverConflictResolutionTreatment" NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "resolvedByUserId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverConflictResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverContestResult" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "artifactRowId" TEXT NOT NULL,
    "artifactContentChecksum" TEXT NOT NULL,
    "resultVersion" INTEGER NOT NULL,
    "resultsPolicyVersion" TEXT NOT NULL,
    "sngResultSetChecksum" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "snapshotFingerprint" TEXT NOT NULL,
    "resolutionSetFingerprint" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "resultFingerprint" TEXT NOT NULL,
    "resultFieldSize" INTEGER NOT NULL,
    "eligiblePoolSize" INTEGER NOT NULL,
    "effectivePoolSize" INTEGER NOT NULL,
    "effectiveFieldSize" INTEGER NOT NULL,
    "effectiveAvailableSlots" INTEGER NOT NULL,
    "invalidatedCalledCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverContestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverPoolResult" (
    "id" TEXT NOT NULL,
    "contestResultId" TEXT NOT NULL,
    "category" "WaiverPoolMemberCategory" NOT NULL,
    "snapshotEntryId" TEXT,
    "rankableEntryId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "identityProvider" TEXT NOT NULL,
    "identityExternalId" TEXT NOT NULL,
    "sngParticipantId" TEXT NOT NULL,
    "participationState" TEXT NOT NULL,
    "participantDisposition" TEXT NOT NULL,
    "canonicalClass" "WaiverCanonicalResultClass" NOT NULL,
    "canonicalPointsHundredths" INTEGER,
    "canonicalPositionRank" INTEGER,
    "sngResultFingerprint" TEXT,
    "treatment" "WaiverResultTreatment" NOT NULL,
    "fpHundredths" INTEGER,
    "waiverPoolRank" INTEGER,
    "neutralizationPrecedence" "WaiverNeutralizationPrecedence",
    "conflictResolutionId" TEXT,
    "invalidationBasis" "WaiverInvalidationBasis",
    "invalidatedBySnapshotId" TEXT,
    "rowFingerprint" TEXT NOT NULL,

    CONSTRAINT "WaiverPoolResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverGradeRun" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "artifactRowId" TEXT NOT NULL,
    "artifactContentChecksum" TEXT NOT NULL,
    "qbContestResultId" TEXT,
    "rbContestResultId" TEXT,
    "wrContestResultId" TEXT,
    "teContestResultId" TEXT,
    "defContestResultId" TEXT,
    "qbEmptyPositionResultId" TEXT,
    "rbEmptyPositionResultId" TEXT,
    "wrEmptyPositionResultId" TEXT,
    "teEmptyPositionResultId" TEXT,
    "defEmptyPositionResultId" TEXT,
    "snapshotSetFingerprint" TEXT NOT NULL,
    "resolutionSetFingerprint" TEXT NOT NULL,
    "gradingRulesetVersion" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "outputFingerprint" TEXT NOT NULL,
    "boardGradeCount" INTEGER NOT NULL,
    "initiator" "WaiverGradeInitiator" NOT NULL,
    "initiatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverGradeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverEmptyPositionResult" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "snapshotFingerprint" TEXT NOT NULL,
    "eligiblePoolSize" INTEGER NOT NULL,
    "resultsPolicyVersion" TEXT NOT NULL,
    "resultFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverEmptyPositionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverBoardGrade" (
    "id" TEXT NOT NULL,
    "gradeRunId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "contestResultId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "submissionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "submittedCallCount" INTEGER NOT NULL,
    "scoreableCallCount" INTEGER NOT NULL,
    "neutralizedCallCount" INTEGER NOT NULL,
    "invalidatedCallCount" INTEGER NOT NULL,
    "exactCallCount" INTEGER NOT NULL,
    "availableSlots" INTEGER NOT NULL,
    "effectiveAvailableSlots" INTEGER NOT NULL,
    "coverageCallCount" INTEGER NOT NULL,
    "slotOverflow" BOOLEAN NOT NULL,
    "earnedRawPoints" INTEGER NOT NULL,
    "maxRawPoints" INTEGER NOT NULL,
    "coverageModifierNumerator" INTEGER,
    "coverageModifierDenominator" INTEGER,
    "eyeqHundredths" INTEGER,
    "totalFpHundredths" INTEGER NOT NULL,
    "fpPerCallHundredths" INTEGER,
    "fpPerCallDenominator" INTEGER NOT NULL,
    "fpPerAvailableSlotHundredths" INTEGER,
    "fpPerAvailableSlotDenominator" INTEGER NOT NULL,
    "resultKind" "WaiverBoardResultKind" NOT NULL,
    "ungradableReason" "WaiverUngradableReason",
    "played" BOOLEAN NOT NULL,
    "honorEligible" BOOLEAN NOT NULL,
    "honorIneligibleReason" TEXT,
    "awardedHonor" "WaiverHonor",
    "inputFingerprint" TEXT NOT NULL,
    "outputFingerprint" TEXT NOT NULL,

    CONSTRAINT "WaiverBoardGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverCallGrade" (
    "id" TEXT NOT NULL,
    "boardGradeId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "snapshotEntryId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "poolResultId" TEXT NOT NULL,
    "treatment" "WaiverResultTreatment" NOT NULL,
    "scored" BOOLEAN NOT NULL,
    "waiverPoolRank" INTEGER,
    "canonicalPositionRank" INTEGER,
    "fpHundredths" INTEGER,
    "inResultField" BOOLEAN NOT NULL,
    "exact" BOOLEAN NOT NULL,
    "earnedRawPoints" INTEGER,
    "maxRawPoints" INTEGER,
    "honorCreditEligible" BOOLEAN NOT NULL,
    "invalidatedPreLock" BOOLEAN NOT NULL,
    "neutralizationPrecedence" "WaiverNeutralizationPrecedence",
    "conflictResolutionId" TEXT,
    "inputFingerprint" TEXT NOT NULL,
    "outputFingerprint" TEXT NOT NULL,

    CONSTRAINT "WaiverCallGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverGradeApproval" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "gradeRunId" TEXT NOT NULL,
    "artifactRowId" TEXT NOT NULL,
    "artifactRevision" INTEGER NOT NULL,
    "artifactContentChecksum" TEXT NOT NULL,
    "snapshotSetFingerprint" TEXT NOT NULL,
    "resolutionSetFingerprint" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "outputFingerprint" TEXT NOT NULL,
    "defCrosswalkVersion" TEXT NOT NULL,
    "defCrosswalkAcknowledged" BOOLEAN NOT NULL,
    "approvalPolicy" "WaiverGradeApprovalPolicy" NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "artifactImportedByUserId" TEXT NOT NULL,
    "gradeRunInitiatedByUserId" TEXT,
    "attestationVersion" TEXT NOT NULL,
    "attestationText" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverGradeApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverGradeAuthorityChange" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "changeType" "WaiverGradeAuthorityChangeType" NOT NULL,
    "priorChangeId" TEXT,
    "priorGradeRunId" TEXT,
    "newGradeRunId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "outputFingerprint" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverGradeAuthorityChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverWeekGradeAuthority" (
    "weekId" TEXT NOT NULL,
    "gradeRunId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "outputFingerprint" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverWeekGradeAuthority_pkey" PRIMARY KEY ("weekId")
);

-- CreateTable
CREATE TABLE "WaiverContestResultAuthority" (
    "contestId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "contestResultId" TEXT NOT NULL,
    "artifactRowId" TEXT NOT NULL,
    "gradeRunId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverContestResultAuthority_pkey" PRIMARY KEY ("contestId")
);

-- CreateTable
CREATE TABLE "WaiverBoardGradeAuthority" (
    "submissionId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "boardGradeId" TEXT NOT NULL,
    "gradeRunId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverBoardGradeAuthority_pkey" PRIMARY KEY ("submissionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaiverConflictResolution_supersedesResolutionId_key" ON "WaiverConflictResolution"("supersedesResolutionId");

-- CreateIndex
CREATE INDEX "WaiverConflictResolution_contestId_artifactRowId_idx" ON "WaiverConflictResolution"("contestId", "artifactRowId");

-- CreateIndex
CREATE INDEX "WaiverConflictResolution_snapshotId_idx" ON "WaiverConflictResolution"("snapshotId");

-- CreateIndex
CREATE INDEX "WaiverConflictResolution_snapshotEntryId_idx" ON "WaiverConflictResolution"("snapshotEntryId");

-- CreateIndex
CREATE INDEX "WaiverConflictResolution_reconfirmsResolutionId_idx" ON "WaiverConflictResolution"("reconfirmsResolutionId");

-- CreateIndex
CREATE INDEX "WaiverConflictResolution_resolvedByUserId_idx" ON "WaiverConflictResolution"("resolvedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverConflictResolution_artifactRowId_conflictKey_sequence_key" ON "WaiverConflictResolution"("artifactRowId", "conflictKey", "sequence");

-- CreateIndex
CREATE INDEX "WaiverContestResult_weekId_idx" ON "WaiverContestResult"("weekId");

-- CreateIndex
CREATE INDEX "WaiverContestResult_snapshotId_idx" ON "WaiverContestResult"("snapshotId");

-- CreateIndex
CREATE INDEX "WaiverContestResult_artifactRowId_idx" ON "WaiverContestResult"("artifactRowId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverContestResult_contestId_resultVersion_key" ON "WaiverContestResult"("contestId", "resultVersion");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverContestResult_contestId_inputFingerprint_key" ON "WaiverContestResult"("contestId", "inputFingerprint");

-- CreateIndex
CREATE INDEX "WaiverPoolResult_snapshotEntryId_idx" ON "WaiverPoolResult"("snapshotEntryId");

-- CreateIndex
CREATE INDEX "WaiverPoolResult_rankableEntryId_idx" ON "WaiverPoolResult"("rankableEntryId");

-- CreateIndex
CREATE INDEX "WaiverPoolResult_conflictResolutionId_idx" ON "WaiverPoolResult"("conflictResolutionId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverPoolResult_contestResultId_rankableEntryId_key" ON "WaiverPoolResult"("contestResultId", "rankableEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverPoolResult_contestResultId_snapshotEntryId_key" ON "WaiverPoolResult"("contestResultId", "snapshotEntryId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_artifactRowId_idx" ON "WaiverGradeRun"("artifactRowId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_qbContestResultId_idx" ON "WaiverGradeRun"("qbContestResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_rbContestResultId_idx" ON "WaiverGradeRun"("rbContestResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_wrContestResultId_idx" ON "WaiverGradeRun"("wrContestResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_teContestResultId_idx" ON "WaiverGradeRun"("teContestResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_defContestResultId_idx" ON "WaiverGradeRun"("defContestResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_qbEmptyPositionResultId_idx" ON "WaiverGradeRun"("qbEmptyPositionResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_rbEmptyPositionResultId_idx" ON "WaiverGradeRun"("rbEmptyPositionResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_wrEmptyPositionResultId_idx" ON "WaiverGradeRun"("wrEmptyPositionResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_teEmptyPositionResultId_idx" ON "WaiverGradeRun"("teEmptyPositionResultId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_defEmptyPositionResultId_idx" ON "WaiverGradeRun"("defEmptyPositionResultId");

-- CreateIndex
CREATE INDEX "WaiverEmptyPositionResult_snapshotId_idx" ON "WaiverEmptyPositionResult"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverEmptyPositionResult_weekId_position_snapshotId_key" ON "WaiverEmptyPositionResult"("weekId", "position", "snapshotId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_initiatedByUserId_idx" ON "WaiverGradeRun"("initiatedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverGradeRun_weekId_runNumber_key" ON "WaiverGradeRun"("weekId", "runNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverGradeRun_weekId_inputFingerprint_key" ON "WaiverGradeRun"("weekId", "inputFingerprint");

-- CreateIndex
CREATE INDEX "WaiverBoardGrade_submissionId_idx" ON "WaiverBoardGrade"("submissionId");

-- CreateIndex
CREATE INDEX "WaiverBoardGrade_contestId_idx" ON "WaiverBoardGrade"("contestId");

-- CreateIndex
CREATE INDEX "WaiverBoardGrade_contestResultId_idx" ON "WaiverBoardGrade"("contestResultId");

-- CreateIndex
CREATE INDEX "WaiverBoardGrade_revisionId_idx" ON "WaiverBoardGrade"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverBoardGrade_gradeRunId_submissionId_key" ON "WaiverBoardGrade"("gradeRunId", "submissionId");

-- CreateIndex
CREATE INDEX "WaiverCallGrade_callId_idx" ON "WaiverCallGrade"("callId");

-- CreateIndex
CREATE INDEX "WaiverCallGrade_poolResultId_idx" ON "WaiverCallGrade"("poolResultId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCallGrade_boardGradeId_slot_key" ON "WaiverCallGrade"("boardGradeId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCallGrade_boardGradeId_callId_key" ON "WaiverCallGrade"("boardGradeId", "callId");

-- CreateIndex
CREATE INDEX "WaiverGradeApproval_weekId_idx" ON "WaiverGradeApproval"("weekId");

-- CreateIndex
CREATE INDEX "WaiverGradeApproval_artifactRowId_idx" ON "WaiverGradeApproval"("artifactRowId");

-- CreateIndex
CREATE INDEX "WaiverGradeApproval_approvedByUserId_idx" ON "WaiverGradeApproval"("approvedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverGradeApproval_gradeRunId_approvedByUserId_key" ON "WaiverGradeApproval"("gradeRunId", "approvedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverGradeAuthorityChange_priorChangeId_key" ON "WaiverGradeAuthorityChange"("priorChangeId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverGradeAuthorityChange_approvalId_key" ON "WaiverGradeAuthorityChange"("approvalId");

-- CreateIndex
CREATE INDEX "WaiverGradeAuthorityChange_priorGradeRunId_idx" ON "WaiverGradeAuthorityChange"("priorGradeRunId");

-- CreateIndex
CREATE INDEX "WaiverGradeAuthorityChange_newGradeRunId_idx" ON "WaiverGradeAuthorityChange"("newGradeRunId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverGradeAuthorityChange_weekId_sequence_key" ON "WaiverGradeAuthorityChange"("weekId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverWeekGradeAuthority_changeId_key" ON "WaiverWeekGradeAuthority"("changeId");

-- CreateIndex
CREATE INDEX "WaiverWeekGradeAuthority_gradeRunId_idx" ON "WaiverWeekGradeAuthority"("gradeRunId");

-- CreateIndex
CREATE INDEX "WaiverContestResultAuthority_weekId_idx" ON "WaiverContestResultAuthority"("weekId");

-- CreateIndex
CREATE INDEX "WaiverContestResultAuthority_contestResultId_idx" ON "WaiverContestResultAuthority"("contestResultId");

-- CreateIndex
CREATE INDEX "WaiverContestResultAuthority_gradeRunId_idx" ON "WaiverContestResultAuthority"("gradeRunId");

-- CreateIndex
CREATE INDEX "WaiverContestResultAuthority_changeId_idx" ON "WaiverContestResultAuthority"("changeId");

-- CreateIndex
CREATE INDEX "WaiverBoardGradeAuthority_weekId_idx" ON "WaiverBoardGradeAuthority"("weekId");

-- CreateIndex
CREATE INDEX "WaiverBoardGradeAuthority_boardGradeId_idx" ON "WaiverBoardGradeAuthority"("boardGradeId");

-- CreateIndex
CREATE INDEX "WaiverBoardGradeAuthority_gradeRunId_idx" ON "WaiverBoardGradeAuthority"("gradeRunId");

-- CreateIndex
CREATE INDEX "WaiverBoardGradeAuthority_changeId_idx" ON "WaiverBoardGradeAuthority"("changeId");

-- AddForeignKey
ALTER TABLE "WaiverConflictResolution" ADD CONSTRAINT "WaiverConflictResolution_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverConflictResolution" ADD CONSTRAINT "WaiverConflictResolution_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverConflictResolution" ADD CONSTRAINT "WaiverConflictResolution_snapshotEntryId_fkey" FOREIGN KEY ("snapshotEntryId") REFERENCES "WaiverSnapshotEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverConflictResolution" ADD CONSTRAINT "WaiverConflictResolution_artifactRowId_fkey" FOREIGN KEY ("artifactRowId") REFERENCES "WaiverCanonicalArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverConflictResolution" ADD CONSTRAINT "WaiverConflictResolution_supersedesResolutionId_fkey" FOREIGN KEY ("supersedesResolutionId") REFERENCES "WaiverConflictResolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverConflictResolution" ADD CONSTRAINT "WaiverConflictResolution_reconfirmsResolutionId_fkey" FOREIGN KEY ("reconfirmsResolutionId") REFERENCES "WaiverConflictResolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverConflictResolution" ADD CONSTRAINT "WaiverConflictResolution_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContestResult" ADD CONSTRAINT "WaiverContestResult_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContestResult" ADD CONSTRAINT "WaiverContestResult_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContestResult" ADD CONSTRAINT "WaiverContestResult_artifactRowId_fkey" FOREIGN KEY ("artifactRowId") REFERENCES "WaiverCanonicalArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverPoolResult" ADD CONSTRAINT "WaiverPoolResult_contestResultId_fkey" FOREIGN KEY ("contestResultId") REFERENCES "WaiverContestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverPoolResult" ADD CONSTRAINT "WaiverPoolResult_snapshotEntryId_fkey" FOREIGN KEY ("snapshotEntryId") REFERENCES "WaiverSnapshotEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverPoolResult" ADD CONSTRAINT "WaiverPoolResult_rankableEntryId_fkey" FOREIGN KEY ("rankableEntryId") REFERENCES "RankableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverPoolResult" ADD CONSTRAINT "WaiverPoolResult_conflictResolutionId_fkey" FOREIGN KEY ("conflictResolutionId") REFERENCES "WaiverConflictResolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_artifactRowId_fkey" FOREIGN KEY ("artifactRowId") REFERENCES "WaiverCanonicalArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_qbContestResultId_fkey" FOREIGN KEY ("qbContestResultId") REFERENCES "WaiverContestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_rbContestResultId_fkey" FOREIGN KEY ("rbContestResultId") REFERENCES "WaiverContestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_wrContestResultId_fkey" FOREIGN KEY ("wrContestResultId") REFERENCES "WaiverContestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_teContestResultId_fkey" FOREIGN KEY ("teContestResultId") REFERENCES "WaiverContestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_defContestResultId_fkey" FOREIGN KEY ("defContestResultId") REFERENCES "WaiverContestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_qbEmptyPositionResultId_fkey" FOREIGN KEY ("qbEmptyPositionResultId") REFERENCES "WaiverEmptyPositionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_rbEmptyPositionResultId_fkey" FOREIGN KEY ("rbEmptyPositionResultId") REFERENCES "WaiverEmptyPositionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_wrEmptyPositionResultId_fkey" FOREIGN KEY ("wrEmptyPositionResultId") REFERENCES "WaiverEmptyPositionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_teEmptyPositionResultId_fkey" FOREIGN KEY ("teEmptyPositionResultId") REFERENCES "WaiverEmptyPositionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_defEmptyPositionResultId_fkey" FOREIGN KEY ("defEmptyPositionResultId") REFERENCES "WaiverEmptyPositionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverEmptyPositionResult" ADD CONSTRAINT "WaiverEmptyPositionResult_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverEmptyPositionResult" ADD CONSTRAINT "WaiverEmptyPositionResult_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "WaiverGradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_contestResultId_fkey" FOREIGN KEY ("contestResultId") REFERENCES "WaiverContestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WaiverSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "WaiverSubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCallGrade" ADD CONSTRAINT "WaiverCallGrade_boardGradeId_fkey" FOREIGN KEY ("boardGradeId") REFERENCES "WaiverBoardGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCallGrade" ADD CONSTRAINT "WaiverCallGrade_callId_fkey" FOREIGN KEY ("callId") REFERENCES "WaiverCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCallGrade" ADD CONSTRAINT "WaiverCallGrade_poolResultId_fkey" FOREIGN KEY ("poolResultId") REFERENCES "WaiverPoolResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeApproval" ADD CONSTRAINT "WaiverGradeApproval_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeApproval" ADD CONSTRAINT "WaiverGradeApproval_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "WaiverGradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeApproval" ADD CONSTRAINT "WaiverGradeApproval_artifactRowId_fkey" FOREIGN KEY ("artifactRowId") REFERENCES "WaiverCanonicalArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeApproval" ADD CONSTRAINT "WaiverGradeApproval_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeAuthorityChange" ADD CONSTRAINT "WaiverGradeAuthorityChange_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeAuthorityChange" ADD CONSTRAINT "WaiverGradeAuthorityChange_priorChangeId_fkey" FOREIGN KEY ("priorChangeId") REFERENCES "WaiverGradeAuthorityChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeAuthorityChange" ADD CONSTRAINT "WaiverGradeAuthorityChange_priorGradeRunId_fkey" FOREIGN KEY ("priorGradeRunId") REFERENCES "WaiverGradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeAuthorityChange" ADD CONSTRAINT "WaiverGradeAuthorityChange_newGradeRunId_fkey" FOREIGN KEY ("newGradeRunId") REFERENCES "WaiverGradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeAuthorityChange" ADD CONSTRAINT "WaiverGradeAuthorityChange_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "WaiverGradeApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverWeekGradeAuthority" ADD CONSTRAINT "WaiverWeekGradeAuthority_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverWeekGradeAuthority" ADD CONSTRAINT "WaiverWeekGradeAuthority_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "WaiverGradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverWeekGradeAuthority" ADD CONSTRAINT "WaiverWeekGradeAuthority_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "WaiverGradeAuthorityChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContestResultAuthority" ADD CONSTRAINT "WaiverContestResultAuthority_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContestResultAuthority" ADD CONSTRAINT "WaiverContestResultAuthority_contestResultId_fkey" FOREIGN KEY ("contestResultId") REFERENCES "WaiverContestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContestResultAuthority" ADD CONSTRAINT "WaiverContestResultAuthority_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "WaiverGradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContestResultAuthority" ADD CONSTRAINT "WaiverContestResultAuthority_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "WaiverGradeAuthorityChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGradeAuthority" ADD CONSTRAINT "WaiverBoardGradeAuthority_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WaiverSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGradeAuthority" ADD CONSTRAINT "WaiverBoardGradeAuthority_boardGradeId_fkey" FOREIGN KEY ("boardGradeId") REFERENCES "WaiverBoardGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGradeAuthority" ADD CONSTRAINT "WaiverBoardGradeAuthority_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "WaiverGradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverBoardGradeAuthority" ADD CONSTRAINT "WaiverBoardGradeAuthority_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "WaiverGradeAuthorityChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: results and grading authority integrity backstops (Stage
-- 4B.3). No service writes these tables yet; the future grading services
-- (Stage 4B.4+) will be the primary authority. These guards make the stored
-- evidence internally consistent and immutable:
--   * CHECK constraints on digests, versions, counts, treatment shapes, the
--     WAIVER_EYEQ_V1 EyeQ / coverage / FP arithmetic and N/A board shapes;
--   * D3 resolutions, contest results, pool rows, grade runs, board grades,
--     call grades, approvals and authority changes are immutable (no UPDATE;
--     DELETE only under the fixture-maintenance switch documented in the
--     Phase 2 migration);
--   * every timestamp is the database clock (waiver_utc_now());
--   * cross-table bindings (week, contest, position, pinned snapshot,
--     artifact revision and checksum, locked submission and revision, call,
--     pool row, approval) are verified on insert;
--   * checked at COMMIT: a contest result holds exactly its eligible frozen
--     pool plus its invalidated called players, with competition ranks over
--     the post-treatment RANKED set and every current D3 resolution applied;
--     a board grade's call grades add up; a grade run grades exactly the
--     locked submitted boards of its contests; and the week, contest and
--     board authority pointers all name the week's latest authority change
--     (week-atomic authority);
--   * a grade run represents all five positions: each by its contest result,
--     or by an explicit empty-position result when the week's current frozen
--     snapshot has no eligible candidate there (no contest, no pool, no
--     grades are fabricated);
--   * a shrunken pool (a pre-lock snapshot correction leaving fewer slots
--     than an original submission's calls) keeps the submitted board intact;
--     only pre-lock invalidated calls may exceed the corrected slots, and
--     coverage is capped at the effective available slots.
-- Current-authority pointers are the only mutable rows: they may move only to
-- the latest append-only authority change, which requires an explicit
-- grading approval of the exact grade run.
-- Errors use the Phase 2 prefixes WAIVER_INVALID / WAIVER_IMMUTABLE.
-- ---------------------------------------------------------------------------

-- Latest publication state of a canonical artifact (NULL when unknown).
CREATE FUNCTION "waiver_canonical_artifact_state"(p_artifact text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT e."state"::text FROM "WaiverCanonicalArtifactEvent" e
  WHERE e."artifactRowId" = p_artifact ORDER BY e."sequence" DESC LIMIT 1
$$;

CREATE FUNCTION "waiver_require_admin"(p_user text, p_role_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "User" u WHERE u."id" = p_user AND u."role" = 'ADMIN';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: the % must be an ADMIN user', p_role_label;
  END IF;
END;
$$;

-- Serializes run numbering, approvals and authority movement for one week.
CREATE FUNCTION "waiver_grade_week_lock"(p_week text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('waiver_grade_week:' || p_week, 0))
$$;

-- True when a visible row's xmin is this transaction or one of its
-- subtransactions (savepoints, PL/pgSQL exception blocks), committed or not.
-- A visible row was inserted by a committed transaction or by this one;
-- pg_xact_status reports the latter as 'in progress'. The 32-bit xmin is
-- widened to the 64-bit xid within 2^31 of the current one (subtransaction
-- xids are above their parent's; wraparound protection keeps every unfrozen
-- xmin inside that window). An aliased frozen xmin can only read as
-- committed or raise, never as this transaction.
CREATE FUNCTION "waiver_xmin_is_current_transaction"(p_xmin bigint) RETURNS boolean LANGUAGE sql VOLATILE AS $$
  SELECT CASE WHEN p_xmin < 3 OR x.full_xid < 3 THEN false
              ELSE pg_xact_status(x.full_xid::text::xid8) IS NOT DISTINCT FROM 'in progress' END
  FROM (SELECT c.cur + ((p_xmin - (c.cur & 4294967295) + 6442450944) % 4294967296) - 2147483648 AS full_xid
        FROM (SELECT pg_current_xact_id()::text::bigint AS cur) c) x
$$;

-- A D3 resolution is current while no later resolution supersedes it.
CREATE FUNCTION "waiver_conflict_resolution_is_current"(p_resolution text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM "WaiverConflictResolution" x WHERE x."supersedesResolutionId" = p_resolution)
$$;

-- A contest result's D3 set is current when it references only current
-- resolutions and applies every current resolution recorded for its contest
-- and artifact revision.
CREATE FUNCTION "waiver_contest_result_resolutions_current"(p_result text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM "WaiverPoolResult" p
    WHERE p."contestResultId" = p_result AND p."conflictResolutionId" IS NOT NULL
      AND NOT "waiver_conflict_resolution_is_current"(p."conflictResolutionId")
  ) AND NOT EXISTS (
    SELECT 1 FROM "WaiverConflictResolution" x
    JOIN "WaiverContestResult" r ON r."contestId" = x."contestId" AND r."artifactRowId" = x."artifactRowId"
    WHERE r."id" = p_result AND "waiver_conflict_resolution_is_current"(x."id")
      AND NOT EXISTS (
        SELECT 1 FROM "WaiverPoolResult" p WHERE p."contestResultId" = p_result AND p."conflictResolutionId" = x."id"
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverConflictResolution" ADD CONSTRAINT "WaiverConflictResolution_shape_check" CHECK (
  "artifactContentChecksum" ~ '^[a-f0-9]{64}$' AND "conflictKey" ~ '^[a-f0-9]{64}$' AND "inputFingerprint" ~ '^[a-f0-9]{64}$'
  AND "artifactRevision" >= 1 AND "sequence" >= 1 AND ("sequence" = 1) = ("supersedesResolutionId" IS NULL)
  AND "supersedesResolutionId" IS DISTINCT FROM "id" AND "reconfirmsResolutionId" IS DISTINCT FROM "id"
  AND length(btrim("sngParticipantId")) > 0 AND length(btrim("evidenceReference")) > 0 AND length(btrim("reason")) > 0
);

ALTER TABLE "WaiverContestResult" ADD CONSTRAINT "WaiverContestResult_shape_check" CHECK (
  "artifactContentChecksum" ~ '^[a-f0-9]{64}$' AND "sngResultSetChecksum" ~ '^[a-f0-9]{64}$'
  AND "sourceFingerprint" ~ '^[a-f0-9]{64}$' AND "snapshotFingerprint" ~ '^[a-f0-9]{64}$'
  AND "resolutionSetFingerprint" ~ '^[a-f0-9]{64}$' AND "inputFingerprint" ~ '^[a-f0-9]{64}$'
  AND "resultFingerprint" ~ '^[a-f0-9]{64}$'
  AND "resultVersion" >= 1 AND "resultsPolicyVersion" = 'rankeyeq-waiver-results/1'
  AND "resultFieldSize" IN (3, 5) AND "eligiblePoolSize" >= 0 AND "invalidatedCalledCount" >= 0
  AND "effectivePoolSize" BETWEEN 0 AND "eligiblePoolSize"
  AND "effectiveFieldSize" = least("resultFieldSize", "effectivePoolSize")
  AND "effectiveAvailableSlots" BETWEEN 0 AND least("resultFieldSize", "eligiblePoolSize")
);

ALTER TABLE "WaiverPoolResult" ADD CONSTRAINT "WaiverPoolResult_canonical_check" CHECK (
  "rowFingerprint" ~ '^[a-f0-9]{64}$'
  AND length(btrim("identityProvider")) > 0 AND length(btrim("identityExternalId")) > 0 AND length(btrim("sngParticipantId")) > 0
  AND (
    ("canonicalClass" = 'RANKED' AND "participationState" IN ('PARTICIPATED_WITH_STATS', 'PARTICIPATED_ZERO') AND "participantDisposition" = 'PLAYED')
    OR ("canonicalClass" = 'NON_PARTICIPANT' AND "participationState" = 'VERIFIED_NON_PARTICIPANT' AND "participantDisposition" IN ('DNP', 'NO_ROSTER_ASSIGNMENT'))
    OR ("canonicalClass" = 'SYSTEMIC_NEUTRALIZE' AND "participationState" = 'VERIFIED_NON_PARTICIPANT' AND "participantDisposition" IN ('CANCELLED_GAME', 'MOVED_OUT_OF_WEEK'))
    OR ("canonicalClass" = 'SNAPSHOT_CONFLICT' AND "participationState" = 'VERIFIED_NON_PARTICIPANT' AND "participantDisposition" = 'BYE')
  )
  -- SNG publishes points, a competition rank and a result fingerprint only for scorable rows.
  AND ("canonicalClass" = 'RANKED') = ("canonicalPointsHundredths" IS NOT NULL)
  AND ("canonicalClass" = 'RANKED') = ("canonicalPositionRank" IS NOT NULL)
  AND ("canonicalClass" = 'RANKED') = ("sngResultFingerprint" IS NOT NULL)
  AND ("canonicalPositionRank" IS NULL OR "canonicalPositionRank" >= 1)
  AND ("sngResultFingerprint" IS NULL OR "sngResultFingerprint" ~ '^[a-f0-9]{64}$')
  AND ("canonicalClass" <> 'SNAPSHOT_CONFLICT' OR "conflictResolutionId" IS NOT NULL)
);

ALTER TABLE "WaiverPoolResult" ADD CONSTRAINT "WaiverPoolResult_treatment_check" CHECK (
  (
    ("treatment" = 'RANKED' AND "canonicalClass" = 'RANKED' AND "category" = 'ELIGIBLE_POOL_MEMBER'
      AND "fpHundredths" = "canonicalPointsHundredths" AND "waiverPoolRank" >= 1 AND "neutralizationPrecedence" IS NULL)
    OR ("treatment" = 'NON_PARTICIPANT_ZERO' AND "category" = 'ELIGIBLE_POOL_MEMBER'
      AND "fpHundredths" = 0 AND "waiverPoolRank" IS NULL AND "neutralizationPrecedence" IS NULL)
    OR ("treatment" = 'INVALIDATED_PRE_LOCK' AND "category" = 'INVALIDATED_CALLED_PLAYER'
      AND "fpHundredths" = 0 AND "waiverPoolRank" IS NULL AND "neutralizationPrecedence" IS NULL)
    OR ("treatment" = 'NEUTRALIZED' AND "fpHundredths" IS NULL AND "waiverPoolRank" IS NULL
      AND ("neutralizationPrecedence" IS NOT NULL) = ("category" = 'INVALIDATED_CALLED_PLAYER'))
  )
  AND ("neutralizationPrecedence" IS DISTINCT FROM 'D2_NEUTRALIZATION_OVER_C2_INVALIDATION'
       OR ("canonicalClass" = 'SYSTEMIC_NEUTRALIZE' AND "conflictResolutionId" IS NULL))
  AND ("neutralizationPrecedence" IS DISTINCT FROM 'D3_NEUTRALIZATION_OVER_C2_INVALIDATION'
       OR ("canonicalClass" <> 'SYSTEMIC_NEUTRALIZE' AND "conflictResolutionId" IS NOT NULL))
  -- Without a D3 resolution the treatment follows the canonical class (Stage 4A D1/D2/C2).
  AND ("conflictResolutionId" IS NOT NULL OR (
    ("category" = 'ELIGIBLE_POOL_MEMBER' AND (
      ("canonicalClass" = 'RANKED' AND "treatment" = 'RANKED')
      OR ("canonicalClass" = 'NON_PARTICIPANT' AND "treatment" = 'NON_PARTICIPANT_ZERO')
      OR ("canonicalClass" = 'SYSTEMIC_NEUTRALIZE' AND "treatment" = 'NEUTRALIZED')))
    OR ("category" = 'INVALIDATED_CALLED_PLAYER' AND (
      ("canonicalClass" = 'SYSTEMIC_NEUTRALIZE' AND "treatment" = 'NEUTRALIZED')
      OR ("canonicalClass" IN ('RANKED', 'NON_PARTICIPANT') AND "treatment" = 'INVALIDATED_PRE_LOCK')))
  ))
);

ALTER TABLE "WaiverPoolResult" ADD CONSTRAINT "WaiverPoolResult_category_check" CHECK (
  ("category" = 'ELIGIBLE_POOL_MEMBER' AND "snapshotEntryId" IS NOT NULL
    AND "invalidationBasis" IS NULL AND "invalidatedBySnapshotId" IS NULL)
  OR ("category" = 'INVALIDATED_CALLED_PLAYER' AND "invalidationBasis" IS NOT NULL AND "invalidatedBySnapshotId" IS NOT NULL
    AND ("invalidationBasis" = 'ABSENT_FROM_PINNED_SNAPSHOT') = ("snapshotEntryId" IS NULL))
);

-- Version gates: these arithmetic CHECKs encode WAIVER_EYEQ_V1 under
-- rankeyeq-waiver-grading/1; a new ruleset needs a migration.
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_shape_check" CHECK (
  "artifactContentChecksum" ~ '^[a-f0-9]{64}$' AND "snapshotSetFingerprint" ~ '^[a-f0-9]{64}$'
  AND "resolutionSetFingerprint" ~ '^[a-f0-9]{64}$' AND "inputFingerprint" ~ '^[a-f0-9]{64}$'
  AND "outputFingerprint" ~ '^[a-f0-9]{64}$'
  AND "runNumber" >= 1 AND "boardGradeCount" >= 0
  AND "gradingRulesetVersion" = 'rankeyeq-waiver-grading/1' AND "scoringVersion" = 'WAIVER_EYEQ_V1'
  AND ("initiator" = 'OPERATOR') = ("initiatedByUserId" IS NOT NULL)
  -- All five positions are represented: a contest result or an explicit empty-position result, never both.
  AND ("qbContestResultId" IS NULL) <> ("qbEmptyPositionResultId" IS NULL)
  AND ("rbContestResultId" IS NULL) <> ("rbEmptyPositionResultId" IS NULL)
  AND ("wrContestResultId" IS NULL) <> ("wrEmptyPositionResultId" IS NULL)
  AND ("teContestResultId" IS NULL) <> ("teEmptyPositionResultId" IS NULL)
  AND ("defContestResultId" IS NULL) <> ("defEmptyPositionResultId" IS NULL)
  AND num_nonnulls("qbContestResultId", "rbContestResultId", "wrContestResultId", "teContestResultId", "defContestResultId") >= 1
);

ALTER TABLE "WaiverEmptyPositionResult" ADD CONSTRAINT "WaiverEmptyPositionResult_shape_check" CHECK (
  "snapshotFingerprint" ~ '^[a-f0-9]{64}$' AND "resultFingerprint" ~ '^[a-f0-9]{64}$'
  AND "eligiblePoolSize" = 0 AND "resultsPolicyVersion" = 'rankeyeq-waiver-results/1'
);

ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_counts_check" CHECK (
  "inputFingerprint" ~ '^[a-f0-9]{64}$' AND "outputFingerprint" ~ '^[a-f0-9]{64}$'
  AND "scoreableCallCount" >= 0 AND "neutralizedCallCount" >= 0
  AND "submittedCallCount" = "scoreableCallCount" + "neutralizedCallCount"
  AND "exactCallCount" BETWEEN 0 AND "scoreableCallCount"
  AND "invalidatedCallCount" BETWEEN 0 AND "submittedCallCount"
  -- 0 only for a zero-field contest (its corrected eligible pool is empty).
  AND "availableSlots" BETWEEN 0 AND 5
  -- Shrunken pool: a pre-lock snapshot correction may leave the original
  -- submission with more calls than the corrected available slots. The board
  -- and its calls are kept as submitted; only pre-lock invalidated calls can
  -- exceed the corrected slots, and no slot is added.
  AND "submittedCallCount" - "invalidatedCallCount" <= "availableSlots"
  AND "slotOverflow" = ("submittedCallCount" > "availableSlots")
  -- D2: each neutralized slot leaves the denominator (floored at 0 so an
  -- all-neutralized board on a shrunken pool stays representable as N/A).
  AND "effectiveAvailableSlots" = greatest("availableSlots" - "neutralizedCallCount", 0)
  -- Coverage never exceeds 100%: k is capped at the effective available slots
  -- (the cap affects coverage only, never call quality or exact hits).
  AND "coverageCallCount" = least("scoreableCallCount", "effectiveAvailableSlots")
  AND "maxRawPoints" >= 0 AND "earnedRawPoints" BETWEEN 0 AND "maxRawPoints"
  AND ("scoreableCallCount" = 0) = ("maxRawPoints" = 0)
);

ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_eyeq_check" CHECK (
  -- N/A (no coverage, no EyeQ) without scoreable calls or without an effective slot.
  CASE WHEN "scoreableCallCount" = 0 OR "effectiveAvailableSlots" = 0 THEN
    "coverageModifierNumerator" IS NULL AND "coverageModifierDenominator" IS NULL AND "eyeqHundredths" IS NULL
  ELSE
    -- WAIVER_EYEQ_V1: modifier = (70·K + 30·k) / (100·K), K = effective available slots,
    -- k = coverage calls (= scoreable calls except on a shrunken pool, where k is capped at K).
    "coverageModifierNumerator" = 70 * "effectiveAvailableSlots" + 30 * "coverageCallCount"
    AND "coverageModifierDenominator" = 100 * "effectiveAvailableSlots"
    AND "eyeqHundredths" = floor(
      (2::numeric * "earnedRawPoints" * "coverageModifierNumerator" * 10000 + "maxRawPoints"::numeric * "coverageModifierDenominator")
      / (2::numeric * "maxRawPoints" * "coverageModifierDenominator")
    )
    AND "eyeqHundredths" BETWEEN 0 AND 10000
  END
);

ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_production_check" CHECK (
  "fpPerCallDenominator" = "scoreableCallCount"
  AND "fpPerAvailableSlotDenominator" = "effectiveAvailableSlots"
  AND "fpPerCallHundredths" IS NOT DISTINCT FROM
    CASE WHEN "scoreableCallCount" = 0 OR "effectiveAvailableSlots" = 0 THEN NULL
         ELSE round("totalFpHundredths"::numeric / "scoreableCallCount")::int END
  AND "fpPerAvailableSlotHundredths" IS NOT DISTINCT FROM
    CASE WHEN "resultKind" IN ('NA_ALL_NEUTRALIZED', 'NA_NO_EFFECTIVE_SLOTS') OR "effectiveAvailableSlots" = 0 THEN NULL
         ELSE round("totalFpHundredths"::numeric / "effectiveAvailableSlots")::int END
);

ALTER TABLE "WaiverBoardGrade" ADD CONSTRAINT "WaiverBoardGrade_kind_check" CHECK (
  (
    ("resultKind" = 'SCORED' AND "scoreableCallCount" > 0 AND "effectiveAvailableSlots" > 0)
    OR ("resultKind" = 'NA_ZERO_CALL' AND "submittedCallCount" = 0 AND "totalFpHundredths" = 0)
    OR ("resultKind" = 'NA_ALL_NEUTRALIZED' AND "submittedCallCount" > 0 AND "scoreableCallCount" = 0 AND "totalFpHundredths" = 0)
    -- Scoreable calls remain, but no effective slot does: the calls keep their
    -- individual outcomes; board EyeQ, FP/Call, FP/Slot and coverage are N/A.
    OR ("resultKind" = 'NA_NO_EFFECTIVE_SLOTS' AND "scoreableCallCount" > 0 AND "effectiveAvailableSlots" = 0)
  )
  AND "ungradableReason" IS NOT DISTINCT FROM CASE WHEN "resultKind" = 'NA_NO_EFFECTIVE_SLOTS' THEN
    (CASE WHEN "availableSlots" = 0 THEN 'CORRECTED_POOL_EMPTY' ELSE 'NEUTRALIZATIONS_CONSUMED_SLOTS' END)::"WaiverUngradableReason" END
  AND "played" = ("resultKind" IN ('SCORED', 'NA_ZERO_CALL'))
  AND "honorEligible" = ("resultKind" = 'SCORED')
  AND "honorIneligibleReason" IS NOT DISTINCT FROM
    CASE "resultKind" WHEN 'NA_ZERO_CALL' THEN 'ZERO_CALL_BOARD' WHEN 'NA_ALL_NEUTRALIZED' THEN 'ALL_CALLS_NEUTRALIZED'
      WHEN 'NA_NO_EFFECTIVE_SLOTS' THEN 'NO_EFFECTIVE_SLOTS' ELSE NULL END
  AND ("awardedHonor" IS NULL OR ("honorEligible" AND "exactCallCount" = "scoreableCallCount"))
  AND ("awardedHonor" IS NULL OR "awardedHonor" = 'PERFECT_CALL'
       OR ("neutralizedCallCount" = 0 AND "exactCallCount" = "submittedCallCount"))
);

ALTER TABLE "WaiverCallGrade" ADD CONSTRAINT "WaiverCallGrade_shape_check" CHECK (
  "inputFingerprint" ~ '^[a-f0-9]{64}$' AND "outputFingerprint" ~ '^[a-f0-9]{64}$'
  AND "slot" BETWEEN 1 AND 5
  AND "scored" = ("treatment" <> 'NEUTRALIZED')
  AND "honorCreditEligible" = ("treatment" = 'RANKED')
  AND "invalidatedPreLock" = ("treatment" = 'INVALIDATED_PRE_LOCK' OR "neutralizationPrecedence" IS NOT NULL)
  AND ("neutralizationPrecedence" IS NULL OR "treatment" = 'NEUTRALIZED')
  AND ("treatment" = 'RANKED') = ("waiverPoolRank" IS NOT NULL)
  AND (NOT "inResultField" OR "waiverPoolRank" IS NOT NULL)
  AND "exact" = ("inResultField" AND "waiverPoolRank" = "slot")
  AND CASE WHEN "scored" THEN
    "fpHundredths" IS NOT NULL AND "earnedRawPoints" IS NOT NULL AND "maxRawPoints" > 0
    AND "earnedRawPoints" BETWEEN 0 AND "maxRawPoints"
    AND ("treatment" = 'RANKED' OR ("fpHundredths" = 0 AND "earnedRawPoints" = 0))
  ELSE
    "fpHundredths" IS NULL AND "earnedRawPoints" IS NULL AND "maxRawPoints" IS NULL
  END
);

ALTER TABLE "WaiverGradeApproval" ADD CONSTRAINT "WaiverGradeApproval_shape_check" CHECK (
  "artifactContentChecksum" ~ '^[a-f0-9]{64}$' AND "snapshotSetFingerprint" ~ '^[a-f0-9]{64}$'
  AND "resolutionSetFingerprint" ~ '^[a-f0-9]{64}$' AND "inputFingerprint" ~ '^[a-f0-9]{64}$'
  AND "outputFingerprint" ~ '^[a-f0-9]{64}$' AND "artifactRevision" >= 1
  AND "defCrosswalkAcknowledged" AND length(btrim("defCrosswalkVersion")) > 0
  AND "attestationVersion" LIKE 'rankeyeq-waiver-grading-approval/%'
  AND length(btrim("attestationText")) > 0 AND length(btrim("reason")) > 0
  AND ("approvalPolicy" <> 'SEPARATE_APPROVER'
       OR ("approvedByUserId" <> "artifactImportedByUserId" AND "approvedByUserId" IS DISTINCT FROM "gradeRunInitiatedByUserId"))
);

ALTER TABLE "WaiverGradeAuthorityChange" ADD CONSTRAINT "WaiverGradeAuthorityChange_shape_check" CHECK (
  "inputFingerprint" ~ '^[a-f0-9]{64}$' AND "outputFingerprint" ~ '^[a-f0-9]{64}$'
  AND "sequence" >= 1 AND length(btrim("reason")) > 0
  AND ("sequence" = 1) = ("changeType" = 'INITIAL_GRADE')
  AND ("sequence" = 1) = ("priorChangeId" IS NULL)
  AND ("sequence" = 1) = ("priorGradeRunId" IS NULL)
  AND "priorGradeRunId" IS DISTINCT FROM "newGradeRunId"
);

ALTER TABLE "WaiverWeekGradeAuthority" ADD CONSTRAINT "WaiverWeekGradeAuthority_shape_check" CHECK (
  "outputFingerprint" ~ '^[a-f0-9]{64}$'
);

-- ---------------------------------------------------------------------------
-- D3 conflict resolutions
-- ---------------------------------------------------------------------------

CREATE FUNCTION "waiver_conflict_resolution_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_contest "WaiverContest"%ROWTYPE;
  v_artifact "WaiverCanonicalArtifact"%ROWTYPE;
  v_entry "WaiverSnapshotEntry"%ROWTYPE;
  v_prev "WaiverConflictResolution"%ROWTYPE;
  v_reconfirmed "WaiverConflictResolution"%ROWTYPE;
  v_prior_artifact "WaiverCanonicalArtifact"%ROWTYPE;
  v_prior_player text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: D3 conflict resolutions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: D3 conflict resolutions cannot be deleted';
  END IF;

  NEW."resolvedAt" := "waiver_utc_now"();
  PERFORM "waiver_require_admin"(NEW."resolvedByUserId", 'resolving operator');

  SELECT * INTO v_contest FROM "WaiverContest" c WHERE c."id" = NEW."contestId";
  IF NOT FOUND OR v_contest."weekId" <> NEW."weekId" OR v_contest."position" <> NEW."position" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a D3 resolution must match its contest week and position';
  END IF;
  IF NEW."resolvedAt" < v_contest."locksAt" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a D3 resolution cannot be recorded before the contest locks';
  END IF;

  SELECT * INTO v_artifact FROM "WaiverCanonicalArtifact" a WHERE a."id" = NEW."artifactRowId";
  IF NOT FOUND OR v_artifact."weekId" <> NEW."weekId" OR v_artifact."revision" <> NEW."artifactRevision"
     OR v_artifact."contentChecksum" <> NEW."artifactContentChecksum" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a D3 resolution must bind the exact artifact revision and checksum of its week';
  END IF;
  IF "waiver_canonical_artifact_state"(NEW."artifactRowId") IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a D3 resolution requires an ACCEPTED canonical artifact';
  END IF;

  -- The entry is an eligible frozen pool member of the pinned snapshot, or
  -- the frozen evidence of a player called on a locked board of the contest.
  SELECT * INTO v_entry FROM "WaiverSnapshotEntry" e
  WHERE e."id" = NEW."snapshotEntryId" AND e."snapshotId" = NEW."snapshotId" AND e."position" = NEW."position";
  IF NOT FOUND OR NOT (
    (v_entry."snapshotId" = v_contest."snapshotId" AND v_entry."evidenceRole" = 'CANDIDATE' AND v_entry."eligibility" = 'ELIGIBLE')
    OR EXISTS (
      SELECT 1 FROM "WaiverSubmission" s
      JOIN "WaiverCall" w ON w."revisionId" = s."lockedRevisionId"
      JOIN "WaiverSnapshotEntry" ce ON ce."id" = w."snapshotEntryId"
      WHERE s."contestId" = NEW."contestId" AND ce."rankableEntryId" = v_entry."rankableEntryId"
        AND (w."snapshotEntryId" = v_entry."id" OR v_entry."snapshotId" = v_contest."snapshotId")
    )
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a D3 resolution must concern an eligible pool member or a locked called player of its contest';
  END IF;
  IF NEW."conflictKind" = 'BYE_VS_SCHEDULED' AND v_entry."isByeAtFreeze" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: BYE_VS_SCHEDULED requires a frozen entry with a scheduled game';
  END IF;

  IF NEW."supersedesResolutionId" IS NOT NULL THEN
    SELECT * INTO v_prev FROM "WaiverConflictResolution" x WHERE x."id" = NEW."supersedesResolutionId";
    IF NOT FOUND OR v_prev."artifactRowId" <> NEW."artifactRowId" OR v_prev."conflictKey" <> NEW."conflictKey"
       OR v_prev."conflictKind" <> NEW."conflictKind" OR v_prev."contestId" <> NEW."contestId"
       OR v_prev."snapshotEntryId" <> NEW."snapshotEntryId" OR v_prev."sngParticipantId" <> NEW."sngParticipantId"
       OR v_prev."sequence" <> NEW."sequence" - 1 THEN
      RAISE EXCEPTION 'WAIVER_INVALID: resolution n must supersede resolution n-1 of the same conflict and artifact revision';
    END IF;
  END IF;

  IF NEW."reconfirmsResolutionId" IS NOT NULL THEN
    SELECT * INTO v_reconfirmed FROM "WaiverConflictResolution" x WHERE x."id" = NEW."reconfirmsResolutionId";
    SELECT * INTO v_prior_artifact FROM "WaiverCanonicalArtifact" a WHERE a."id" = v_reconfirmed."artifactRowId";
    SELECT e."rankableEntryId" INTO v_prior_player FROM "WaiverSnapshotEntry" e WHERE e."id" = v_reconfirmed."snapshotEntryId";
    IF v_reconfirmed."id" IS NULL OR v_reconfirmed."contestId" <> NEW."contestId" OR v_reconfirmed."conflictKind" <> NEW."conflictKind"
       OR v_prior_player IS DISTINCT FROM v_entry."rankableEntryId"
       OR v_prior_artifact."seriesKey" <> v_artifact."seriesKey" OR v_prior_artifact."revision" >= v_artifact."revision" THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a reconfirmation must reference the same contest, player and conflict kind on an earlier revision of the artifact series';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverConflictResolution_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverConflictResolution"
  FOR EACH ROW EXECUTE FUNCTION "waiver_conflict_resolution_guard"();

-- ---------------------------------------------------------------------------
-- Contest results and pool rows
-- ---------------------------------------------------------------------------

CREATE FUNCTION "waiver_contest_result_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_contest "WaiverContest"%ROWTYPE;
  v_eligible int;
  v_invalidated int;
  v_next int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver contest results are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver contest results cannot be deleted';
  END IF;

  NEW."createdAt" := "waiver_utc_now"();
  -- Row lock serializes result versions for the contest.
  SELECT * INTO v_contest FROM "WaiverContest" c WHERE c."id" = NEW."contestId" FOR UPDATE;
  IF NOT FOUND OR v_contest."weekId" <> NEW."weekId" OR v_contest."position" <> NEW."position"
     OR v_contest."snapshotId" <> NEW."snapshotId" OR v_contest."resultFieldSize" <> NEW."resultFieldSize" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a contest result must match its contest week, position, pinned snapshot and result field';
  END IF;
  IF v_contest."status" <> 'LOCKED' OR NEW."createdAt" < v_contest."locksAt" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a contest result requires a LOCKED contest';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverSubmission" s WHERE s."contestId" = NEW."contestId" AND s."status" = 'SUBMITTED') THEN
    RAISE EXCEPTION 'WAIVER_INVALID: every submitted board must carry its lock stamp before a contest result is stored';
  END IF;

  PERFORM 1 FROM "WaiverCanonicalArtifact" a
  WHERE a."id" = NEW."artifactRowId" AND a."weekId" = NEW."weekId" AND a."contentChecksum" = NEW."artifactContentChecksum";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a contest result must bind an artifact of its week by checksum';
  END IF;
  IF "waiver_canonical_artifact_state"(NEW."artifactRowId") IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a contest result requires an ACCEPTED canonical artifact';
  END IF;

  SELECT count(*) INTO v_eligible FROM "WaiverSnapshotEntry" e
  WHERE e."snapshotId" = NEW."snapshotId" AND e."position" = NEW."position"
    AND e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'ELIGIBLE';
  IF NEW."eligiblePoolSize" <> v_eligible OR NEW."effectiveAvailableSlots" <> least(v_contest."maxCalls", v_eligible) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: eligible pool size and effective available slots must match the pinned snapshot';
  END IF;

  SELECT count(DISTINCT ce."rankableEntryId") INTO v_invalidated
  FROM "WaiverSubmission" s
  JOIN "WaiverCall" w ON w."revisionId" = s."lockedRevisionId"
  JOIN "WaiverSnapshotEntry" ce ON ce."id" = w."snapshotEntryId"
  WHERE s."contestId" = NEW."contestId" AND NOT EXISTS (
    SELECT 1 FROM "WaiverSnapshotEntry" e
    WHERE e."snapshotId" = NEW."snapshotId" AND e."rankableEntryId" = ce."rankableEntryId" AND e."position" = NEW."position"
      AND e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'ELIGIBLE'
  );
  IF NEW."invalidatedCalledCount" <> v_invalidated THEN
    RAISE EXCEPTION 'WAIVER_INVALID: invalidated called count must match the locked calls outside the eligible pool';
  END IF;

  SELECT coalesce(max(r."resultVersion"), 0) + 1 INTO v_next FROM "WaiverContestResult" r WHERE r."contestId" = NEW."contestId";
  IF NEW."resultVersion" <> v_next THEN
    RAISE EXCEPTION 'WAIVER_INVALID: contest result versions must be contiguous';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverContestResult_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverContestResult"
  FOR EACH ROW EXECUTE FUNCTION "waiver_contest_result_guard"();

CREATE FUNCTION "waiver_pool_result_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_result "WaiverContestResult"%ROWTYPE;
  v_entry "WaiverSnapshotEntry"%ROWTYPE;
  v_player "RankableEntry"%ROWTYPE;
  v_resolution "WaiverConflictResolution"%ROWTYPE;
  v_pinned_entry text;
  v_resolution_player text;
  v_result_xmin bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver pool results are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver pool results cannot be deleted';
  END IF;

  SELECT * INTO v_result FROM "WaiverContestResult" r WHERE r."id" = NEW."contestResultId";
  IF NOT FOUND OR v_result."position" <> NEW."position" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a pool row must match its contest result position';
  END IF;
  -- The contest result's completeness pass must see every pool row.
  SELECT r.xmin::text::bigint INTO v_result_xmin FROM "WaiverContestResult" r WHERE r."id" = NEW."contestResultId";
  IF NOT "waiver_xmin_is_current_transaction"(v_result_xmin)
     OR current_setting('rankeyeq.waiver_contest_result_' || md5(NEW."contestResultId"), true) IS NOT DISTINCT FROM 'validated' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: pool rows must be written in the contest result''s transaction before its completeness check';
  END IF;
  SELECT * INTO v_player FROM "RankableEntry" re WHERE re."id" = NEW."rankableEntryId";

  IF NEW."category" = 'ELIGIBLE_POOL_MEMBER' THEN
    SELECT * INTO v_entry FROM "WaiverSnapshotEntry" e
    WHERE e."id" = NEW."snapshotEntryId" AND e."snapshotId" = v_result."snapshotId" AND e."position" = v_result."position"
      AND e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'ELIGIBLE' AND e."rankableEntryId" = NEW."rankableEntryId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAIVER_INVALID: an eligible pool row must reference an eligible candidate of the pinned snapshot';
    END IF;
  ELSE
    IF NEW."invalidatedBySnapshotId" <> v_result."snapshotId" THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a pre-lock invalidation must cite the contest''s pinned snapshot';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "WaiverSubmission" s
      JOIN "WaiverCall" w ON w."revisionId" = s."lockedRevisionId"
      JOIN "WaiverSnapshotEntry" ce ON ce."id" = w."snapshotEntryId"
      WHERE s."contestId" = v_result."contestId" AND ce."rankableEntryId" = NEW."rankableEntryId"
    ) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: an invalidated pool row must be a player called on a locked board of the contest';
    END IF;
    SELECT e."id" INTO v_pinned_entry FROM "WaiverSnapshotEntry" e
    WHERE e."snapshotId" = v_result."snapshotId" AND e."rankableEntryId" = NEW."rankableEntryId";
    IF EXISTS (
      SELECT 1 FROM "WaiverSnapshotEntry" e
      WHERE e."id" = v_pinned_entry AND e."position" = v_result."position"
        AND e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'ELIGIBLE'
    ) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: an eligible pool member cannot be recorded as invalidated';
    END IF;
    IF NEW."snapshotEntryId" IS DISTINCT FROM v_pinned_entry
       OR NEW."invalidationBasis"::text <> (CASE WHEN v_pinned_entry IS NULL THEN 'ABSENT_FROM_PINNED_SNAPSHOT' ELSE 'NOT_ELIGIBLE_IN_PINNED_SNAPSHOT' END) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: an invalidated pool row must cite its pinned-snapshot entry when one exists';
    END IF;
    IF v_pinned_entry IS NOT NULL THEN
      SELECT * INTO v_entry FROM "WaiverSnapshotEntry" e WHERE e."id" = v_pinned_entry;
    END IF;
  END IF;

  -- Identity is the frozen identity (live identity only where none was frozen).
  IF NEW."snapshotEntryId" IS NOT NULL THEN
    IF NEW."identityProvider" <> coalesce(v_entry."identityProviderAtFreeze", v_player."provider")
       OR NEW."identityExternalId" <> coalesce(v_entry."identityExternalIdAtFreeze", v_player."externalId") THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a pool row identity must equal the frozen snapshot identity';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "WaiverSubmission" s
    JOIN "WaiverCall" w ON w."revisionId" = s."lockedRevisionId"
    JOIN "WaiverSnapshotEntry" ce ON ce."id" = w."snapshotEntryId"
    WHERE s."contestId" = v_result."contestId" AND ce."rankableEntryId" = NEW."rankableEntryId"
      AND coalesce(ce."identityProviderAtFreeze", v_player."provider") = NEW."identityProvider"
      AND coalesce(ce."identityExternalIdAtFreeze", v_player."externalId") = NEW."identityExternalId"
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a pool row identity must equal the frozen identity of the called entry';
  END IF;

  IF NEW."conflictResolutionId" IS NOT NULL THEN
    SELECT * INTO v_resolution FROM "WaiverConflictResolution" x WHERE x."id" = NEW."conflictResolutionId";
    SELECT e."rankableEntryId" INTO v_resolution_player FROM "WaiverSnapshotEntry" e WHERE e."id" = v_resolution."snapshotEntryId";
    IF v_resolution."id" IS NULL OR v_resolution."contestId" <> v_result."contestId"
       OR v_resolution."artifactRowId" <> v_result."artifactRowId"
       OR v_resolution_player IS DISTINCT FROM NEW."rankableEntryId"
       OR v_resolution."sngParticipantId" <> NEW."sngParticipantId" THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a pool row may only apply a D3 resolution for its own player, contest and artifact revision';
    END IF;
    IF NOT "waiver_conflict_resolution_is_current"(v_resolution."id") THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a pool row may only apply a current (unsuperseded) D3 resolution';
    END IF;
    IF (v_resolution."conflictKind" = 'BYE_VS_SCHEDULED' AND NEW."canonicalClass" <> 'SNAPSHOT_CONFLICT')
       OR (v_resolution."conflictKind" = 'TEAM_CHANGED'
           AND NOT (NEW."canonicalClass" = 'RANKED' OR NEW."participantDisposition" = 'DNP')) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: the D3 conflict kind does not match the canonical result';
    END IF;
    IF NEW."category" = 'ELIGIBLE_POOL_MEMBER' THEN
      IF NEW."treatment"::text <> (CASE v_resolution."resolution"
           WHEN 'SCORE_AS_RANKED' THEN 'RANKED' WHEN 'NON_PARTICIPANT_ZERO' THEN 'NON_PARTICIPANT_ZERO' ELSE 'NEUTRALIZED' END) THEN
        RAISE EXCEPTION 'WAIVER_INVALID: a resolved pool row must take the treatment its D3 resolution chose';
      END IF;
    ELSIF NEW."canonicalClass" = 'SYSTEMIC_NEUTRALIZE' OR NOT (
      (v_resolution."resolution" = 'NEUTRALIZED' AND NEW."treatment" = 'NEUTRALIZED')
      OR (v_resolution."resolution" <> 'NEUTRALIZED' AND NEW."treatment" = 'INVALIDATED_PRE_LOCK')
    ) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: only a D3 NEUTRALIZED resolution supersedes a pre-lock invalidation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverPoolResult_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverPoolResult"
  FOR EACH ROW EXECUTE FUNCTION "waiver_pool_result_guard"();

-- Checked once per contest result at COMMIT (or SET CONSTRAINTS IMMEDIATE),
-- in one set-based pass: exactly the eligible pool and the invalidated called
-- players, effective pool size, competition ranks (1, 1, 3; negative totals
-- included) over the post-treatment RANKED set (D3 and neutralization
-- exclusions applied before ranking), current D3 set. The pool guard refuses
-- every pool row this pass could not see (later transactions, or after the
-- pass ran), so pool rows need no deferred check of their own.
CREATE FUNCTION "waiver_contest_result_complete_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_result "WaiverContestResult"%ROWTYPE;
  v_eligible int;
  v_invalidated int;
  v_ranked int;
BEGIN
  SELECT * INTO v_result FROM "WaiverContestResult" r WHERE r."id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*) FILTER (WHERE p."category" = 'ELIGIBLE_POOL_MEMBER'),
         count(*) FILTER (WHERE p."category" = 'INVALIDATED_CALLED_PLAYER'),
         count(*) FILTER (WHERE p."treatment" = 'RANKED')
    INTO v_eligible, v_invalidated, v_ranked
  FROM "WaiverPoolResult" p WHERE p."contestResultId" = v_result."id";
  IF v_eligible <> v_result."eligiblePoolSize" OR v_invalidated <> v_result."invalidatedCalledCount" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a contest result must hold every eligible pool member and every invalidated called player exactly once';
  END IF;
  IF v_ranked <> v_result."effectivePoolSize" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: effective pool size must equal the RANKED pool rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT p."waiverPoolRank" AS stored_rank, rank() OVER (ORDER BY p."fpHundredths" DESC) AS expected_rank
      FROM "WaiverPoolResult" p
      WHERE p."contestResultId" = v_result."id" AND p."treatment" = 'RANKED'
    ) ranked
    WHERE ranked.stored_rank IS DISTINCT FROM ranked.expected_rank
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: Waiver pool ranks must be competition ranks over the RANKED pool rows';
  END IF;
  IF NOT "waiver_contest_result_resolutions_current"(v_result."id") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a contest result must apply exactly the current D3 resolutions of its contest and artifact revision';
  END IF;
  -- Transaction-local (reverts with an aborted savepoint, as does this event).
  PERFORM set_config('rankeyeq.waiver_contest_result_' || md5(v_result."id"), 'validated', true);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverContestResult_complete"
  AFTER INSERT ON "WaiverContestResult"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_contest_result_complete_check"();

-- ---------------------------------------------------------------------------
-- Empty positions: no contest because the current frozen snapshot has no
-- eligible candidate (contest opening refused EMPTY_ELIGIBLE_POOL). No
-- players, pool rows or grades are fabricated. A contest whose corrected
-- pool emptied after opening keeps its contest and submissions and is
-- represented by a zero-field contest result instead.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "waiver_empty_position_result_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_eligible int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver empty-position results are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver empty-position results cannot be deleted';
  END IF;

  NEW."createdAt" := "waiver_utc_now"();
  PERFORM 1 FROM "WaiverSnapshot" s
  WHERE s."id" = NEW."snapshotId" AND s."weekId" = NEW."weekId" AND s."status" = 'FROZEN' AND s."currentForWeekId" = NEW."weekId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an empty-position result must cite the week''s current frozen snapshot';
  END IF;
  SELECT count(*) INTO v_eligible FROM "WaiverSnapshotEntry" e
  WHERE e."snapshotId" = NEW."snapshotId" AND e."position" = NEW."position"
    AND e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'ELIGIBLE';
  IF v_eligible <> 0 OR NEW."eligiblePoolSize" <> v_eligible THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an empty position must have no eligible candidate in the cited snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverContest" c WHERE c."weekId" = NEW."weekId" AND c."position" = NEW."position") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a position with a Waiver contest is represented by its contest result';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverEmptyPositionResult_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverEmptyPositionResult"
  FOR EACH ROW EXECUTE FUNCTION "waiver_empty_position_result_guard"();

-- ---------------------------------------------------------------------------
-- Grade runs, board grades and call grades
-- ---------------------------------------------------------------------------

CREATE FUNCTION "waiver_grade_run_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_next int;
  v_results text[];
  v_contests text[];
  v_boards int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver grade runs are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver grade runs cannot be deleted';
  END IF;

  PERFORM "waiver_grade_week_lock"(NEW."weekId");
  NEW."createdAt" := "waiver_utc_now"();
  IF NEW."initiatedByUserId" IS NOT NULL THEN
    PERFORM "waiver_require_admin"(NEW."initiatedByUserId", 'grade run initiator');
  END IF;

  SELECT coalesce(max(g."runNumber"), 0) + 1 INTO v_next FROM "WaiverGradeRun" g WHERE g."weekId" = NEW."weekId";
  IF NEW."runNumber" <> v_next THEN
    RAISE EXCEPTION 'WAIVER_INVALID: grade run numbers must be contiguous per week';
  END IF;

  PERFORM 1 FROM "WaiverCanonicalArtifact" a
  WHERE a."id" = NEW."artifactRowId" AND a."weekId" = NEW."weekId" AND a."contentChecksum" = NEW."artifactContentChecksum";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run must bind an artifact of its week by checksum';
  END IF;
  IF "waiver_canonical_artifact_state"(NEW."artifactRowId") IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run requires an ACCEPTED canonical artifact';
  END IF;

  v_results := array_remove(
    ARRAY[NEW."qbContestResultId", NEW."rbContestResultId", NEW."wrContestResultId", NEW."teContestResultId", NEW."defContestResultId"], NULL);
  IF (
    SELECT count(*) FROM "WaiverContestResult" r
    JOIN unnest(ARRAY[NEW."qbContestResultId", NEW."rbContestResultId", NEW."wrContestResultId", NEW."teContestResultId", NEW."defContestResultId"],
                ARRAY['QB', 'RB', 'WR', 'TE', 'DEF']) AS x(result_id, position) ON x.result_id = r."id"
    WHERE r."weekId" = NEW."weekId" AND r."position"::text = x.position AND r."artifactRowId" = NEW."artifactRowId"
  ) <> cardinality(v_results) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run needs one contest result of its week and artifact for each of the five positions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[NEW."qbEmptyPositionResultId", NEW."rbEmptyPositionResultId", NEW."wrEmptyPositionResultId",
                               NEW."teEmptyPositionResultId", NEW."defEmptyPositionResultId"],
                         ARRAY['QB', 'RB', 'WR', 'TE', 'DEF']) AS x(empty_id, position)
    WHERE x.empty_id IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM "WaiverEmptyPositionResult" e
                  WHERE e."id" = x.empty_id AND e."weekId" = NEW."weekId" AND e."position"::text = x.position)
      OR EXISTS (SELECT 1 FROM "WaiverContest" c WHERE c."weekId" = NEW."weekId" AND c."position"::text = x.position)
    )
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an empty-position result must be of its week and position, with no contest at that position';
  END IF;
  SELECT array_agg(r."contestId") INTO v_contests FROM "WaiverContestResult" r WHERE r."id" = ANY (v_results);
  IF EXISTS (SELECT 1 FROM "WaiverContest" c WHERE c."weekId" = NEW."weekId" AND NOT (c."id" = ANY (v_contests))) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run must cover every Waiver contest of its week';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "WaiverContest" c
    WHERE c."id" = ANY (v_contests) AND (c."status" <> 'LOCKED' OR c."scoringVersion" <> NEW."scoringVersion")
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run requires LOCKED contests on its scoring version';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_results) AS x(result_id) WHERE NOT "waiver_contest_result_resolutions_current"(x.result_id)) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run requires contest results with a current D3 resolution set';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverSubmission" s WHERE s."contestId" = ANY (v_contests) AND s."status" = 'SUBMITTED') THEN
    RAISE EXCEPTION 'WAIVER_INVALID: every submitted board must carry its lock stamp before grading';
  END IF;
  SELECT count(*) INTO v_boards FROM "WaiverSubmission" s
  WHERE s."contestId" = ANY (v_contests) AND s."lockedRevisionId" IS NOT NULL;
  IF NEW."boardGradeCount" <> v_boards THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run must grade every locked submitted board of its week';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverGradeRun_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverGradeRun"
  FOR EACH ROW EXECUTE FUNCTION "waiver_grade_run_guard"();

-- Checked at COMMIT: the run grades exactly its week's locked submitted boards.
CREATE FUNCTION "waiver_grade_run_complete_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
  v_expected int;
  v_found int;
BEGIN
  IF TG_TABLE_NAME = 'WaiverBoardGrade' THEN
    v_id := NEW."gradeRunId";
  ELSE
    v_id := NEW."id";
  END IF;
  SELECT g."boardGradeCount" INTO v_expected FROM "WaiverGradeRun" g WHERE g."id" = v_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_found FROM "WaiverBoardGrade" b WHERE b."gradeRunId" = v_id;
  IF v_found <> v_expected THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run must hold exactly % board grades (found %)', v_expected, v_found;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverGradeRun_complete"
  AFTER INSERT ON "WaiverGradeRun"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_grade_run_complete_check"();

CREATE CONSTRAINT TRIGGER "WaiverBoardGrade_run_complete"
  AFTER INSERT ON "WaiverBoardGrade"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_grade_run_complete_check"();

CREATE FUNCTION "waiver_board_grade_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_run "WaiverGradeRun"%ROWTYPE;
  v_result "WaiverContestResult"%ROWTYPE;
  v_expected_honor text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver board grades are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver board grades cannot be deleted';
  END IF;

  SELECT * INTO v_run FROM "WaiverGradeRun" g WHERE g."id" = NEW."gradeRunId";
  IF NOT FOUND OR NEW."contestResultId" IS DISTINCT FROM (CASE NEW."position"
      WHEN 'QB' THEN v_run."qbContestResultId" WHEN 'RB' THEN v_run."rbContestResultId"
      WHEN 'WR' THEN v_run."wrContestResultId" WHEN 'TE' THEN v_run."teContestResultId"
      WHEN 'DEF' THEN v_run."defContestResultId" END) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a board grade must use its grade run''s contest result for its position';
  END IF;
  SELECT * INTO v_result FROM "WaiverContestResult" r WHERE r."id" = NEW."contestResultId";
  IF v_result."contestId" <> NEW."contestId" OR v_result."position" <> NEW."position" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a board grade must match its contest result';
  END IF;

  PERFORM 1 FROM "WaiverSubmission" s
  JOIN "WaiverSubmissionRevision" r ON r."id" = s."lockedRevisionId"
  WHERE s."id" = NEW."submissionId" AND s."contestId" = NEW."contestId" AND s."status" = 'LOCKED'
    AND s."lockedRevisionId" = NEW."revisionId" AND r."kind" = 'SUBMISSION' AND r."callCount" = NEW."submittedCallCount";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a board grade must grade the locked SUBMISSION revision of a submission in its contest';
  END IF;
  IF NEW."availableSlots" <> v_result."effectiveAvailableSlots" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: board available slots must equal the contest result''s effective available slots';
  END IF;

  -- Stage 4A honors: all scored calls exact; full board (every result-field slot submitted, scored, exact) upgrades.
  v_expected_honor := CASE
    WHEN NEW."resultKind" <> 'SCORED' OR NEW."scoreableCallCount" = 0 OR NEW."exactCallCount" <> NEW."scoreableCallCount" THEN NULL
    WHEN NEW."neutralizedCallCount" = 0 AND NEW."exactCallCount" = v_result."resultFieldSize" THEN
      CASE v_result."resultFieldSize" WHEN 3 THEN 'PERFECT_PODIUM' WHEN 5 THEN 'PERFECT_FIVE' END
    ELSE 'PERFECT_CALL' END;
  IF NEW."awardedHonor"::text IS DISTINCT FROM v_expected_honor THEN
    RAISE EXCEPTION 'WAIVER_INVALID: awarded honor must follow the Stage 4A honor rules';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverBoardGrade_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverBoardGrade"
  FOR EACH ROW EXECUTE FUNCTION "waiver_board_grade_guard"();

-- Checked at COMMIT: a board grade's call grades add up to its totals.
CREATE FUNCTION "waiver_board_grade_complete_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
  v_board "WaiverBoardGrade"%ROWTYPE;
  v_calls int;
  v_neutralized int;
  v_invalidated int;
  v_exact int;
  v_earned int;
  v_max int;
  v_fp int;
  v_max_slot int;
BEGIN
  IF TG_TABLE_NAME = 'WaiverCallGrade' THEN
    v_id := NEW."boardGradeId";
  ELSE
    v_id := NEW."id";
  END IF;
  SELECT * INTO v_board FROM "WaiverBoardGrade" b WHERE b."id" = v_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE NOT c."scored"), count(*) FILTER (WHERE c."invalidatedPreLock"),
         count(*) FILTER (WHERE c."exact"),
         coalesce(sum(c."earnedRawPoints"), 0), coalesce(sum(c."maxRawPoints"), 0),
         coalesce(sum(c."fpHundredths"), 0), coalesce(max(c."slot"), 0)
    INTO v_calls, v_neutralized, v_invalidated, v_exact, v_earned, v_max, v_fp, v_max_slot
  FROM "WaiverCallGrade" c WHERE c."boardGradeId" = v_id;
  IF v_calls <> v_board."submittedCallCount" OR v_max_slot <> v_calls
     OR v_neutralized <> v_board."neutralizedCallCount" OR v_invalidated <> v_board."invalidatedCallCount"
     OR v_exact <> v_board."exactCallCount"
     OR v_earned <> v_board."earnedRawPoints" OR v_max <> v_board."maxRawPoints" OR v_fp <> v_board."totalFpHundredths" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a board grade must equal the sum of its call grades';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverBoardGrade_complete"
  AFTER INSERT ON "WaiverBoardGrade"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_board_grade_complete_check"();

CREATE CONSTRAINT TRIGGER "WaiverCallGrade_complete"
  AFTER INSERT ON "WaiverCallGrade"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_board_grade_complete_check"();

CREATE FUNCTION "waiver_call_grade_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_board "WaiverBoardGrade"%ROWTYPE;
  v_pool "WaiverPoolResult"%ROWTYPE;
  v_field int;
  v_bonus int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver call grades are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver call grades cannot be deleted';
  END IF;

  SELECT * INTO v_board FROM "WaiverBoardGrade" b WHERE b."id" = NEW."boardGradeId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: unknown board grade';
  END IF;
  PERFORM 1 FROM "WaiverCall" w
  JOIN "WaiverSnapshotEntry" ce ON ce."id" = w."snapshotEntryId"
  WHERE w."id" = NEW."callId" AND w."revisionId" = v_board."revisionId" AND w."slot" = NEW."slot"
    AND w."snapshotEntryId" = NEW."snapshotEntryId" AND ce."rankableEntryId" = NEW."rankableEntryId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a call grade must grade a call of its board''s locked revision';
  END IF;

  SELECT * INTO v_pool FROM "WaiverPoolResult" p
  WHERE p."id" = NEW."poolResultId" AND p."contestResultId" = v_board."contestResultId" AND p."rankableEntryId" = NEW."rankableEntryId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a call grade must use its player''s row of the board''s contest result';
  END IF;
  IF NEW."treatment" <> v_pool."treatment"
     OR NEW."waiverPoolRank" IS DISTINCT FROM v_pool."waiverPoolRank"
     OR NEW."canonicalPositionRank" IS DISTINCT FROM v_pool."canonicalPositionRank"
     OR NEW."fpHundredths" IS DISTINCT FROM v_pool."fpHundredths"
     OR NEW."neutralizationPrecedence" IS DISTINCT FROM v_pool."neutralizationPrecedence"
     OR NEW."conflictResolutionId" IS DISTINCT FROM v_pool."conflictResolutionId"
     OR NEW."invalidatedPreLock" <> (v_pool."category" = 'INVALIDATED_CALLED_PLAYER') THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a call grade must carry its pool row''s treatment evidence exactly';
  END IF;

  -- WAIVER_EYEQ_V1 call scoring (base 10, accuracy F - |slot - rank|, exact bonus 20/15/10).
  SELECT r."resultFieldSize" INTO v_field FROM "WaiverContestResult" r WHERE r."id" = v_board."contestResultId";
  v_bonus := CASE NEW."slot" WHEN 1 THEN 20 WHEN 2 THEN 15 WHEN 3 THEN 10 ELSE 0 END;
  IF NEW."inResultField" <> coalesce(NEW."waiverPoolRank" <= v_field, false) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: in-result-field must follow the Waiver pool rank';
  END IF;
  IF NEW."scored" AND (
    NEW."maxRawPoints" <> 10 + v_field + v_bonus
    OR NEW."earnedRawPoints" <> CASE WHEN NOT NEW."inResultField" THEN 0
         ELSE 10 + (v_field - abs(NEW."slot" - NEW."waiverPoolRank")) + CASE WHEN NEW."exact" THEN v_bonus ELSE 0 END END
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: call raw points must follow WAIVER_EYEQ_V1';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverCallGrade_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverCallGrade"
  FOR EACH ROW EXECUTE FUNCTION "waiver_call_grade_guard"();

-- ---------------------------------------------------------------------------
-- Grading approvals (never implied by import)
-- ---------------------------------------------------------------------------

CREATE FUNCTION "waiver_grade_approval_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_run "WaiverGradeRun"%ROWTYPE;
  v_artifact "WaiverCanonicalArtifact"%ROWTYPE;
  v_artifact_xid bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver grading approvals are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver grading approvals cannot be deleted';
  END IF;

  PERFORM "waiver_grade_week_lock"(NEW."weekId");
  NEW."approvedAt" := "waiver_utc_now"();
  PERFORM "waiver_require_admin"(NEW."approvedByUserId", 'grading approver');

  SELECT * INTO v_run FROM "WaiverGradeRun" g WHERE g."id" = NEW."gradeRunId";
  IF NOT FOUND OR v_run."weekId" <> NEW."weekId" OR v_run."artifactRowId" <> NEW."artifactRowId"
     OR v_run."artifactContentChecksum" <> NEW."artifactContentChecksum"
     OR v_run."snapshotSetFingerprint" <> NEW."snapshotSetFingerprint"
     OR v_run."resolutionSetFingerprint" <> NEW."resolutionSetFingerprint"
     OR v_run."inputFingerprint" <> NEW."inputFingerprint" OR v_run."outputFingerprint" <> NEW."outputFingerprint"
     OR v_run."initiatedByUserId" IS DISTINCT FROM NEW."gradeRunInitiatedByUserId" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grading approval must bind its grade run''s exact artifact, snapshots, D3 set and output';
  END IF;

  SELECT * INTO v_artifact FROM "WaiverCanonicalArtifact" a WHERE a."id" = NEW."artifactRowId";
  SELECT a.xmin::text::bigint INTO v_artifact_xid FROM "WaiverCanonicalArtifact" a WHERE a."id" = NEW."artifactRowId";
  IF v_artifact."revision" <> NEW."artifactRevision" OR v_artifact."defCrosswalkVersion" <> NEW."defCrosswalkVersion"
     OR v_artifact."importedByUserId" <> NEW."artifactImportedByUserId" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grading approval must copy its artifact revision, DEF crosswalk and importer exactly';
  END IF;
  IF "waiver_canonical_artifact_state"(NEW."artifactRowId") IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grading approval requires an ACCEPTED canonical artifact';
  END IF;
  -- Import and approval never share a transaction, including through a savepoint.
  IF "waiver_xmin_is_current_transaction"(v_artifact_xid) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: grading approval cannot be recorded in the artifact import transaction';
  END IF;
  IF NEW."approvalPolicy" = 'SINGLE_ADMIN_EXPLICIT' AND EXISTS (
    SELECT 1 FROM "WaiverGradeApproval" x WHERE x."weekId" = NEW."weekId" AND x."approvalPolicy" = 'SEPARATE_APPROVER'
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a week approved under SEPARATE_APPROVER cannot be downgraded to SINGLE_ADMIN_EXPLICIT';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverGradeApproval_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverGradeApproval"
  FOR EACH ROW EXECUTE FUNCTION "waiver_grade_approval_guard"();

-- ---------------------------------------------------------------------------
-- Append-only authority changes and week-atomic authority pointers
-- ---------------------------------------------------------------------------

CREATE FUNCTION "waiver_grade_authority_change_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_last "WaiverGradeAuthorityChange"%ROWTYPE;
  v_approval "WaiverGradeApproval"%ROWTYPE;
  v_run "WaiverGradeRun"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver grade authority changes are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver grade authority changes cannot be deleted';
  END IF;

  PERFORM "waiver_grade_week_lock"(NEW."weekId");
  NEW."recordedAt" := "waiver_utc_now"();

  SELECT * INTO v_last FROM "WaiverGradeAuthorityChange" x WHERE x."weekId" = NEW."weekId" ORDER BY x."sequence" DESC LIMIT 1;
  IF NOT FOUND THEN
    IF NEW."sequence" <> 1 THEN
      RAISE EXCEPTION 'WAIVER_INVALID: the first authority change of a week is sequence 1';
    END IF;
  ELSIF NEW."sequence" <> v_last."sequence" + 1 OR NEW."priorChangeId" IS DISTINCT FROM v_last."id"
        OR NEW."priorGradeRunId" IS DISTINCT FROM v_last."newGradeRunId" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an authority change must follow the week''s latest change and name its grade run';
  END IF;

  SELECT * INTO v_approval FROM "WaiverGradeApproval" ap WHERE ap."id" = NEW."approvalId";
  IF NOT FOUND OR v_approval."gradeRunId" <> NEW."newGradeRunId" OR v_approval."weekId" <> NEW."weekId"
     OR v_approval."approvedByUserId" <> NEW."approvedByUserId"
     OR v_approval."inputFingerprint" <> NEW."inputFingerprint" OR v_approval."outputFingerprint" <> NEW."outputFingerprint" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an authority change requires an explicit grading approval of the exact grade run';
  END IF;
  SELECT * INTO v_run FROM "WaiverGradeRun" g WHERE g."id" = NEW."newGradeRunId";
  IF v_run."weekId" <> NEW."weekId" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an authority change must name a grade run of its week';
  END IF;
  IF "waiver_canonical_artifact_state"(v_run."artifactRowId") IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: grading authority requires an ACCEPTED canonical artifact';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[v_run."qbContestResultId", v_run."rbContestResultId", v_run."wrContestResultId",
                               v_run."teContestResultId", v_run."defContestResultId"]) AS x(result_id)
    WHERE x.result_id IS NOT NULL AND NOT "waiver_contest_result_resolutions_current"(x.result_id)
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: grading authority requires contest results with a current D3 resolution set';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "WaiverEmptyPositionResult" e JOIN "WaiverContest" c ON c."weekId" = e."weekId" AND c."position" = e."position"
    WHERE e."id" IN (v_run."qbEmptyPositionResultId", v_run."rbEmptyPositionResultId", v_run."wrEmptyPositionResultId",
                     v_run."teEmptyPositionResultId", v_run."defEmptyPositionResultId")
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: grading authority requires every empty position of the run to still have no contest';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverGradeAuthorityChange_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverGradeAuthorityChange"
  FOR EACH ROW EXECUTE FUNCTION "waiver_grade_authority_change_guard"();

-- Pointer rows may only name the week's latest authority change and its run.
CREATE FUNCTION "waiver_grade_authority_pointer_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_change "WaiverGradeAuthorityChange"%ROWTYPE;
  v_run "WaiverGradeRun"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: grading authority pointers cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."weekId" <> OLD."weekId" THEN
      RAISE EXCEPTION 'WAIVER_IMMUTABLE: a grading authority pointer cannot change week';
    END IF;
    IF TG_TABLE_NAME = 'WaiverContestResultAuthority' THEN
      IF NEW."contestId" <> OLD."contestId" THEN
        RAISE EXCEPTION 'WAIVER_IMMUTABLE: a contest authority pointer cannot change contest';
      END IF;
    ELSIF TG_TABLE_NAME = 'WaiverBoardGradeAuthority' THEN
      IF NEW."submissionId" <> OLD."submissionId" THEN
        RAISE EXCEPTION 'WAIVER_IMMUTABLE: a board authority pointer cannot change submission';
      END IF;
    END IF;
  END IF;

  PERFORM "waiver_grade_week_lock"(NEW."weekId");
  NEW."updatedAt" := "waiver_utc_now"();

  SELECT * INTO v_change FROM "WaiverGradeAuthorityChange" x WHERE x."id" = NEW."changeId";
  IF NOT FOUND OR v_change."weekId" <> NEW."weekId" OR v_change."newGradeRunId" <> NEW."gradeRunId"
     OR EXISTS (SELECT 1 FROM "WaiverGradeAuthorityChange" y WHERE y."weekId" = NEW."weekId" AND y."sequence" > v_change."sequence") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grading authority pointer may only name the week''s latest authority change and its grade run';
  END IF;
  SELECT * INTO v_run FROM "WaiverGradeRun" g WHERE g."id" = NEW."gradeRunId";

  IF TG_TABLE_NAME = 'WaiverWeekGradeAuthority' THEN
    IF NEW."outputFingerprint" <> v_change."outputFingerprint" THEN
      RAISE EXCEPTION 'WAIVER_INVALID: week authority must carry the authority change output fingerprint';
    END IF;
  ELSIF TG_TABLE_NAME = 'WaiverContestResultAuthority' THEN
    PERFORM 1 FROM "WaiverContestResult" r
    WHERE r."id" = NEW."contestResultId" AND r."contestId" = NEW."contestId" AND r."weekId" = NEW."weekId"
      AND r."artifactRowId" = NEW."artifactRowId"
      AND r."id" IN (v_run."qbContestResultId", v_run."rbContestResultId", v_run."wrContestResultId",
                     v_run."teContestResultId", v_run."defContestResultId");
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a contest authority pointer must name its own contest''s result in the authoritative grade run';
    END IF;
  ELSE
    PERFORM 1 FROM "WaiverBoardGrade" b
    WHERE b."id" = NEW."boardGradeId" AND b."submissionId" = NEW."submissionId" AND b."contestId" = NEW."contestId"
      AND b."gradeRunId" = NEW."gradeRunId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a board authority pointer must name its own submission''s grade in the authoritative grade run';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverWeekGradeAuthority_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverWeekGradeAuthority"
  FOR EACH ROW EXECUTE FUNCTION "waiver_grade_authority_pointer_guard"();

CREATE TRIGGER "WaiverContestResultAuthority_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverContestResultAuthority"
  FOR EACH ROW EXECUTE FUNCTION "waiver_grade_authority_pointer_guard"();

CREATE TRIGGER "WaiverBoardGradeAuthority_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverBoardGradeAuthority"
  FOR EACH ROW EXECUTE FUNCTION "waiver_grade_authority_pointer_guard"();

-- Checked at COMMIT: week authority is atomic. After any authority change or
-- pointer write, the week pointer, every contest pointer of the run and every board
-- pointer name the week's latest change and its grade run, or the
-- transaction fails and the prior authority stays intact.
CREATE FUNCTION "waiver_week_grade_authority_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_week text := NEW."weekId";
  v_last "WaiverGradeAuthorityChange"%ROWTYPE;
  v_run "WaiverGradeRun"%ROWTYPE;
  v_contests int;
  v_boards int;
BEGIN
  SELECT * INTO v_last FROM "WaiverGradeAuthorityChange" x WHERE x."weekId" = v_week ORDER BY x."sequence" DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_run FROM "WaiverGradeRun" g WHERE g."id" = v_last."newGradeRunId";

  PERFORM 1 FROM "WaiverWeekGradeAuthority" w
  WHERE w."weekId" = v_week AND w."changeId" = v_last."id" AND w."gradeRunId" = v_run."id"
    AND w."outputFingerprint" = v_last."outputFingerprint";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: week grading authority must name the latest authority change';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "WaiverContestResultAuthority" c
    WHERE c."weekId" = v_week AND (c."changeId" <> v_last."id" OR c."gradeRunId" <> v_run."id")
  ) OR EXISTS (
    SELECT 1 FROM "WaiverBoardGradeAuthority" b
    WHERE b."weekId" = v_week AND (b."changeId" <> v_last."id" OR b."gradeRunId" <> v_run."id")
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: grading authority must move week-atomically (stale contest or board pointer)';
  END IF;
  SELECT count(*) INTO v_contests FROM "WaiverContestResultAuthority" c WHERE c."weekId" = v_week;
  SELECT count(*) INTO v_boards FROM "WaiverBoardGradeAuthority" b WHERE b."weekId" = v_week;
  IF v_contests <> num_nonnulls(v_run."qbContestResultId", v_run."rbContestResultId", v_run."wrContestResultId",
                                v_run."teContestResultId", v_run."defContestResultId")
     OR v_boards <> v_run."boardGradeCount" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: grading authority must cover every contest of the run and every graded board (contests %, boards % of %)',
      v_contests, v_boards, v_run."boardGradeCount";
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverGradeAuthorityChange_week_atomic"
  AFTER INSERT ON "WaiverGradeAuthorityChange"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_week_grade_authority_check"();

CREATE CONSTRAINT TRIGGER "WaiverWeekGradeAuthority_week_atomic"
  AFTER INSERT OR UPDATE ON "WaiverWeekGradeAuthority"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_week_grade_authority_check"();

CREATE CONSTRAINT TRIGGER "WaiverContestResultAuthority_week_atomic"
  AFTER INSERT OR UPDATE ON "WaiverContestResultAuthority"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_week_grade_authority_check"();

CREATE CONSTRAINT TRIGGER "WaiverBoardGradeAuthority_week_atomic"
  AFTER INSERT OR UPDATE ON "WaiverBoardGradeAuthority"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_week_grade_authority_check"();

-- ---------------------------------------------------------------------------
-- TRUNCATE skips row-level DELETE guards and the table owner always holds the
-- privilege, so refuse it (directly or through another table's CASCADE)
-- outside fixture maintenance.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "waiver_grading_truncate_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "waiver_fixture_maintenance"() THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver results and grading records cannot be truncated';
END;
$$;

CREATE TRIGGER "WaiverConflictResolution_no_truncate" BEFORE TRUNCATE ON "WaiverConflictResolution"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverContestResult_no_truncate" BEFORE TRUNCATE ON "WaiverContestResult"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverPoolResult_no_truncate" BEFORE TRUNCATE ON "WaiverPoolResult"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverEmptyPositionResult_no_truncate" BEFORE TRUNCATE ON "WaiverEmptyPositionResult"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverGradeRun_no_truncate" BEFORE TRUNCATE ON "WaiverGradeRun"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverBoardGrade_no_truncate" BEFORE TRUNCATE ON "WaiverBoardGrade"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverCallGrade_no_truncate" BEFORE TRUNCATE ON "WaiverCallGrade"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverGradeApproval_no_truncate" BEFORE TRUNCATE ON "WaiverGradeApproval"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverGradeAuthorityChange_no_truncate" BEFORE TRUNCATE ON "WaiverGradeAuthorityChange"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverWeekGradeAuthority_no_truncate" BEFORE TRUNCATE ON "WaiverWeekGradeAuthority"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverContestResultAuthority_no_truncate" BEFORE TRUNCATE ON "WaiverContestResultAuthority"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
CREATE TRIGGER "WaiverBoardGradeAuthority_no_truncate" BEFORE TRUNCATE ON "WaiverBoardGradeAuthority"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
