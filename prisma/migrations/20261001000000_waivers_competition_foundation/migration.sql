-- CreateEnum
CREATE TYPE "WaiverContestStatus" AS ENUM ('OPEN', 'LOCKED');

-- CreateEnum
CREATE TYPE "WaiverSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "WaiverRevisionKind" AS ENUM ('DRAFT', 'SUBMISSION');

-- CreateTable
CREATE TABLE "WaiverContest" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "status" "WaiverContestStatus" NOT NULL DEFAULT 'OPEN',
    "maxCalls" INTEGER NOT NULL,
    "resultFieldSize" INTEGER NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "locksAt" TIMESTAMP(3) NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverContest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverSubmission" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "authority" "SubmissionAuthority" NOT NULL,
    "status" "WaiverSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" TEXT,
    "lockedRevisionId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverSubmissionRevision" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "kind" "WaiverRevisionKind" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverSubmissionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverCall" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "snapshotEntryId" TEXT NOT NULL,

    CONSTRAINT "WaiverCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaiverContest_snapshotId_idx" ON "WaiverContest"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverContest_weekId_position_key" ON "WaiverContest"("weekId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSubmission_currentRevisionId_key" ON "WaiverSubmission"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSubmission_lockedRevisionId_key" ON "WaiverSubmission"("lockedRevisionId");

-- CreateIndex
CREATE INDEX "WaiverSubmission_contestId_status_idx" ON "WaiverSubmission"("contestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSubmission_contestId_universalProfileId_key" ON "WaiverSubmission"("contestId", "universalProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSubmission_contestId_createdByUserId_key" ON "WaiverSubmission"("contestId", "createdByUserId");

-- CreateIndex
CREATE INDEX "WaiverSubmissionRevision_submissionId_kind_createdAt_idx" ON "WaiverSubmissionRevision"("submissionId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSubmissionRevision_submissionId_revisionNumber_key" ON "WaiverSubmissionRevision"("submissionId", "revisionNumber");

-- CreateIndex
CREATE INDEX "WaiverCall_snapshotEntryId_idx" ON "WaiverCall"("snapshotEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCall_revisionId_slot_key" ON "WaiverCall"("revisionId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCall_revisionId_snapshotEntryId_key" ON "WaiverCall"("revisionId", "snapshotEntryId");

-- AddForeignKey
ALTER TABLE "WaiverContest" ADD CONSTRAINT "WaiverContest_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContest" ADD CONSTRAINT "WaiverContest_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverContest" ADD CONSTRAINT "WaiverContest_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSubmission" ADD CONSTRAINT "WaiverSubmission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSubmission" ADD CONSTRAINT "WaiverSubmission_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSubmission" ADD CONSTRAINT "WaiverSubmission_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSubmission" ADD CONSTRAINT "WaiverSubmission_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "WaiverSubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSubmission" ADD CONSTRAINT "WaiverSubmission_lockedRevisionId_fkey" FOREIGN KEY ("lockedRevisionId") REFERENCES "WaiverSubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSubmissionRevision" ADD CONSTRAINT "WaiverSubmissionRevision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WaiverSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSubmissionRevision" ADD CONSTRAINT "WaiverSubmissionRevision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSubmissionRevision" ADD CONSTRAINT "WaiverSubmissionRevision_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCall" ADD CONSTRAINT "WaiverCall_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "WaiverSubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCall" ADD CONSTRAINT "WaiverCall_snapshotEntryId_fkey" FOREIGN KEY ("snapshotEntryId") REFERENCES "WaiverSnapshotEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: CHECK constraints (not expressible in schema.prisma).
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverContest" ADD CONSTRAINT "WaiverContest_maxCalls_check" CHECK ("maxCalls" IN (3, 5));
ALTER TABLE "WaiverContest" ADD CONSTRAINT "WaiverContest_resultFieldSize_check" CHECK ("resultFieldSize" IN (3, 5));
ALTER TABLE "WaiverContest" ADD CONSTRAINT "WaiverContest_window_check" CHECK ("opensAt" < "locksAt");
ALTER TABLE "WaiverSubmissionRevision" ADD CONSTRAINT "WaiverSubmissionRevision_revisionNumber_check" CHECK ("revisionNumber" >= 1);
ALTER TABLE "WaiverSubmissionRevision" ADD CONSTRAINT "WaiverSubmissionRevision_callCount_check" CHECK ("callCount" BETWEEN 0 AND 5);
ALTER TABLE "WaiverCall" ADD CONSTRAINT "WaiverCall_slot_check" CHECK ("slot" BETWEEN 1 AND 5);

-- ---------------------------------------------------------------------------
-- Hand-written: Waiver competitive-evidence backstops.
--
-- The application services are the primary authority. These triggers only
-- protect immutable evidence and lock authority from application bugs:
--   * the lock instant is judged by the database clock (UTC), never by status;
--   * no competitive write (new board, revision, call) at or after locksAt;
--   * revisions and calls are append-only (no UPDATE, no DELETE);
--   * after lock the only submission change is the SUBMITTED -> LOCKED stamp
--     naming the final SUBMISSION revision created before locksAt;
--   * a contest re-pins only, before lock, to a snapshot that directly
--     supersedes the pinned one; its defining fields never change.
--
-- Fixture maintenance: integration-test teardown (and any explicitly
-- authorized operator cleanup) may run `SET LOCAL
-- rankeyeq.waiver_fixture_maintenance = 'on'` inside a transaction to delete
-- rows or shift a contest's lock window. Application code never sets it.
-- Revision/call UPDATE and all INSERT checks are never bypassed.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "waiver_utc_now"() RETURNS timestamp LANGUAGE sql VOLATILE AS $$
  SELECT (clock_timestamp() AT TIME ZONE 'UTC')
$$;

CREATE FUNCTION "waiver_fixture_maintenance"() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('rankeyeq.waiver_fixture_maintenance', true), '') = 'on'
$$;

CREATE FUNCTION "waiver_contest_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a Waiver contest must be created OPEN';
    END IF;
    IF "waiver_utc_now"() >= NEW."locksAt" THEN
      RAISE EXCEPTION 'WAIVER_LOCKED: cannot open a Waiver contest at or after its lock';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "WaiverSnapshot" s
      WHERE s."id" = NEW."snapshotId" AND s."weekId" = NEW."weekId" AND s."currentForWeekId" = NEW."weekId"
    ) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a Waiver contest must pin the current snapshot of its week';
    END IF;
    RETURN NEW;
  END IF;

  IF "waiver_fixture_maintenance"() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver contests cannot be deleted';
  END IF;

  IF NEW."weekId" <> OLD."weekId" OR NEW."position" <> OLD."position"
     OR NEW."maxCalls" <> OLD."maxCalls" OR NEW."resultFieldSize" <> OLD."resultFieldSize"
     OR NEW."scoringVersion" <> OLD."scoringVersion" OR NEW."opensAt" <> OLD."opensAt"
     OR NEW."locksAt" <> OLD."locksAt" OR NEW."openedByUserId" <> OLD."openedByUserId"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver contest defining fields cannot change';
  END IF;

  IF NEW."snapshotId" <> OLD."snapshotId" THEN
    IF "waiver_utc_now"() >= OLD."locksAt" THEN
      RAISE EXCEPTION 'WAIVER_LOCKED: a locked Waiver contest cannot be re-pinned';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "WaiverSnapshot" s
      WHERE s."id" = NEW."snapshotId" AND s."supersedesId" = OLD."snapshotId"
        AND s."weekId" = OLD."weekId" AND s."currentForWeekId" = OLD."weekId"
    ) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: re-pin target must be the current snapshot directly superseding the pinned one';
    END IF;
  END IF;

  IF NEW."status" <> OLD."status" THEN
    IF NOT (OLD."status" = 'OPEN' AND NEW."status" = 'LOCKED' AND "waiver_utc_now"() >= OLD."locksAt") THEN
      RAISE EXCEPTION 'WAIVER_INVALID: Waiver contest status may only move OPEN -> LOCKED at or after locksAt';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverContest_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverContest"
  FOR EACH ROW EXECUTE FUNCTION "waiver_contest_guard"();

CREATE FUNCTION "waiver_submission_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_locks timestamp;
  v_now timestamp;
  v_final_submission text;
  v_current_kind "WaiverRevisionKind";
  v_current_created timestamp;
  v_current_number int;
  v_old_number int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver submissions cannot be deleted';
  END IF;

  SELECT c."locksAt" INTO v_locks FROM "WaiverContest" c WHERE c."id" = NEW."contestId";
  v_now := "waiver_utc_now"();

  IF TG_OP = 'INSERT' THEN
    IF v_now >= v_locks THEN
      RAISE EXCEPTION 'WAIVER_LOCKED: no new Waiver boards at or after lock';
    END IF;
    IF NEW."status" <> 'DRAFT' OR NEW."currentRevisionId" IS NOT NULL OR NEW."lockedRevisionId" IS NOT NULL
       OR NEW."submittedAt" IS NOT NULL OR NEW."lockedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a Waiver submission row starts empty as DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  IF "waiver_fixture_maintenance"() THEN
    RETURN NEW;
  END IF;

  IF NEW."contestId" <> OLD."contestId" OR NEW."universalProfileId" <> OLD."universalProfileId"
     OR NEW."createdByUserId" <> OLD."createdByUserId" OR NEW."authority" <> OLD."authority"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver submission identity cannot change';
  END IF;

  IF v_now >= v_locks THEN
    IF NEW."status" = OLD."status"
       AND NEW."currentRevisionId" IS NOT DISTINCT FROM OLD."currentRevisionId"
       AND NEW."lockedRevisionId" IS NOT DISTINCT FROM OLD."lockedRevisionId"
       AND NEW."submittedAt" IS NOT DISTINCT FROM OLD."submittedAt"
       AND NEW."lockedAt" IS NOT DISTINCT FROM OLD."lockedAt" THEN
      RETURN NEW;
    END IF;
    SELECT r."id" INTO v_final_submission FROM "WaiverSubmissionRevision" r
      WHERE r."submissionId" = OLD."id" AND r."kind" = 'SUBMISSION' AND r."createdAt" < v_locks
      ORDER BY r."revisionNumber" DESC LIMIT 1;
    IF OLD."status" = 'SUBMITTED' AND NEW."status" = 'LOCKED'
       AND NEW."currentRevisionId" IS NOT DISTINCT FROM OLD."currentRevisionId"
       AND NEW."submittedAt" IS NOT DISTINCT FROM OLD."submittedAt"
       AND NEW."lockedAt" = v_locks
       AND v_final_submission IS NOT NULL
       AND NEW."lockedRevisionId" = v_final_submission THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'WAIVER_LOCKED: a Waiver board cannot change at or after lock';
  END IF;

  IF NEW."status" = 'LOCKED' OR NEW."lockedRevisionId" IS NOT NULL OR NEW."lockedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a Waiver board cannot lock before locksAt';
  END IF;
  IF OLD."status" <> 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a submitted Waiver board cannot return to DRAFT';
  END IF;

  IF NEW."currentRevisionId" IS DISTINCT FROM OLD."currentRevisionId" THEN
    IF NEW."currentRevisionId" IS NULL THEN
      RAISE EXCEPTION 'WAIVER_INVALID: the current revision cannot be cleared';
    END IF;
    SELECT r."revisionNumber" INTO v_old_number FROM "WaiverSubmissionRevision" r WHERE r."id" = OLD."currentRevisionId";
    SELECT r."revisionNumber" INTO v_current_number FROM "WaiverSubmissionRevision" r
      WHERE r."id" = NEW."currentRevisionId" AND r."submissionId" = OLD."id";
    IF v_current_number IS NULL OR v_current_number <= coalesce(v_old_number, 0) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: the current revision must be a newer revision of this board';
    END IF;
  END IF;

  IF NEW."currentRevisionId" IS NOT NULL THEN
    SELECT r."kind", r."createdAt" INTO v_current_kind, v_current_created
      FROM "WaiverSubmissionRevision" r WHERE r."id" = NEW."currentRevisionId";
  END IF;
  IF NEW."status" = 'SUBMITTED' AND (v_current_kind IS DISTINCT FROM 'SUBMISSION' OR NEW."submittedAt" IS DISTINCT FROM v_current_created) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a SUBMITTED board must point at its latest SUBMISSION revision';
  END IF;
  IF NEW."status" = 'DRAFT' AND (NEW."submittedAt" IS NOT NULL OR (NEW."currentRevisionId" IS NOT NULL AND v_current_kind <> 'DRAFT')) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a DRAFT board may only point at a DRAFT revision';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverSubmission_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverSubmission"
  FOR EACH ROW EXECUTE FUNCTION "waiver_submission_guard"();

CREATE FUNCTION "waiver_revision_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_locks timestamp;
  v_pinned text;
  v_status "WaiverSubmissionStatus";
  v_next int;
  v_latest timestamp;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver revisions are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver revisions are append-only';
  END IF;

  SELECT c."locksAt", c."snapshotId", s."status" INTO v_locks, v_pinned, v_status
    FROM "WaiverSubmission" s JOIN "WaiverContest" c ON c."id" = s."contestId"
    WHERE s."id" = NEW."submissionId";

  IF "waiver_utc_now"() >= v_locks OR NEW."createdAt" >= v_locks THEN
    RAISE EXCEPTION 'WAIVER_LOCKED: no Waiver board revisions at or after lock';
  END IF;
  IF NEW."createdAt" > "waiver_utc_now"() THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a Waiver revision cannot be future-dated';
  END IF;
  IF NEW."snapshotId" <> v_pinned THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a Waiver revision must validate against the contest''s pinned snapshot';
  END IF;
  IF NEW."kind" = 'DRAFT' AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a submitted Waiver board cannot receive DRAFT revisions';
  END IF;

  SELECT coalesce(max(r."revisionNumber"), 0) + 1, max(r."createdAt") INTO v_next, v_latest
    FROM "WaiverSubmissionRevision" r WHERE r."submissionId" = NEW."submissionId";
  IF NEW."revisionNumber" <> v_next THEN
    RAISE EXCEPTION 'WAIVER_INVALID: Waiver revision numbers must be sequential';
  END IF;
  IF v_latest IS NOT NULL AND NEW."createdAt" < v_latest THEN
    RAISE EXCEPTION 'WAIVER_INVALID: Waiver revisions must be chronological';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverSubmissionRevision_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverSubmissionRevision"
  FOR EACH ROW EXECUTE FUNCTION "waiver_revision_guard"();

CREATE FUNCTION "waiver_call_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_locks timestamp;
  v_position "ContestPosition";
  v_max int;
  v_snapshot text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver calls are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver calls are append-only';
  END IF;

  SELECT c."locksAt", c."position", c."maxCalls", r."snapshotId" INTO v_locks, v_position, v_max, v_snapshot
    FROM "WaiverSubmissionRevision" r
    JOIN "WaiverSubmission" s ON s."id" = r."submissionId"
    JOIN "WaiverContest" c ON c."id" = s."contestId"
    WHERE r."id" = NEW."revisionId";

  IF "waiver_utc_now"() >= v_locks THEN
    RAISE EXCEPTION 'WAIVER_LOCKED: no Waiver calls at or after lock';
  END IF;
  IF NEW."slot" > v_max THEN
    RAISE EXCEPTION 'WAIVER_INVALID: Waiver call slot exceeds the contest maximum';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "WaiverSnapshotEntry" e
    WHERE e."id" = NEW."snapshotEntryId" AND e."snapshotId" = v_snapshot AND e."position" = v_position
      AND e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'ELIGIBLE'
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a Waiver call must reference an eligible candidate of the revision''s snapshot and position';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverCall_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverCall"
  FOR EACH ROW EXECUTE FUNCTION "waiver_call_guard"();

-- Checked at COMMIT: a revision holds exactly callCount calls in slots 1..n
-- (no gaps) and never more calls than the eligible pool.
CREATE FUNCTION "waiver_revision_shape_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_revision text;
  v_expected int;
  v_snapshot text;
  v_position "ContestPosition";
  v_count int;
  v_max_slot int;
  v_pool int;
BEGIN
  IF TG_TABLE_NAME = 'WaiverCall' THEN
    v_revision := NEW."revisionId";
  ELSE
    v_revision := NEW."id";
  END IF;

  SELECT r."callCount", r."snapshotId", c."position" INTO v_expected, v_snapshot, v_position
    FROM "WaiverSubmissionRevision" r
    JOIN "WaiverSubmission" s ON s."id" = r."submissionId"
    JOIN "WaiverContest" c ON c."id" = s."contestId"
    WHERE r."id" = v_revision;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*), coalesce(max(w."slot"), 0) INTO v_count, v_max_slot
    FROM "WaiverCall" w WHERE w."revisionId" = v_revision;
  IF v_count <> v_expected OR v_max_slot <> v_count THEN
    RAISE EXCEPTION 'WAIVER_INVALID: Waiver revision must hold exactly % contiguous calls (found %, highest slot %)', v_expected, v_count, v_max_slot;
  END IF;

  SELECT count(*) INTO v_pool FROM "WaiverSnapshotEntry" e
    WHERE e."snapshotId" = v_snapshot AND e."position" = v_position
      AND e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'ELIGIBLE';
  IF v_count > v_pool THEN
    RAISE EXCEPTION 'WAIVER_INVALID: Waiver revision exceeds the eligible pool size';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverSubmissionRevision_shape"
  AFTER INSERT ON "WaiverSubmissionRevision"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_revision_shape_check"();

CREATE CONSTRAINT TRIGGER "WaiverCall_shape"
  AFTER INSERT ON "WaiverCall"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_revision_shape_check"();

