-- CreateTable
CREATE TABLE "WaiverAiCompetitiveOverride" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "evidenceId" TEXT,
    "responseSha256" TEXT NOT NULL,
    "boardFingerprint" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "modelLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceReference" TEXT,
    "submissionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "confirmation" TEXT NOT NULL,
    "authorizedByUserId" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverAiCompetitiveOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiCompetitiveOverride_submissionId_key" ON "WaiverAiCompetitiveOverride"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiCompetitiveOverride_revisionId_key" ON "WaiverAiCompetitiveOverride"("revisionId");

-- CreateIndex
CREATE INDEX "WaiverAiCompetitiveOverride_evidenceId_idx" ON "WaiverAiCompetitiveOverride"("evidenceId");

-- CreateIndex
CREATE INDEX "WaiverAiCompetitiveOverride_snapshotId_idx" ON "WaiverAiCompetitiveOverride"("snapshotId");

-- CreateIndex
CREATE INDEX "WaiverAiCompetitiveOverride_universalProfileId_idx" ON "WaiverAiCompetitiveOverride"("universalProfileId");

-- CreateIndex
CREATE INDEX "WaiverAiCompetitiveOverride_authorizedByUserId_idx" ON "WaiverAiCompetitiveOverride"("authorizedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiCompetitiveOverride_contestId_universalProfileId_key" ON "WaiverAiCompetitiveOverride"("contestId", "universalProfileId");

-- AddForeignKey
ALTER TABLE "WaiverAiCompetitiveOverride" ADD CONSTRAINT "WaiverAiCompetitiveOverride_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiCompetitiveOverride" ADD CONSTRAINT "WaiverAiCompetitiveOverride_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiCompetitiveOverride" ADD CONSTRAINT "WaiverAiCompetitiveOverride_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiCompetitiveOverride" ADD CONSTRAINT "WaiverAiCompetitiveOverride_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "WaiverAiHistoricalEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiCompetitiveOverride" ADD CONSTRAINT "WaiverAiCompetitiveOverride_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WaiverSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "WaiverAiCompetitiveOverride" ADD CONSTRAINT "WaiverAiCompetitiveOverride_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "WaiverSubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "WaiverAiCompetitiveOverride" ADD CONSTRAINT "WaiverAiCompetitiveOverride_authorizedByUserId_fkey" FOREIGN KEY ("authorizedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: AI admin competitive override (Stage 4B.3C).
--
-- An administrator may enter one AI response as a competitive board after
-- the lock without pre-lock evidence. It is labelled an admin competitive
-- override, never a verified pre-lock entry, and is narrowly bound:
--   * WaiverAiCompetitiveOverride (immutable, one per AI profile per contest)
--     is the authorization. It is inserted first by an ADMIN, after the
--     lock, on the contest's pinned snapshot and position, for an active AI
--     competitor with no board and no approved late entry, before any grade
--     run of the week (serialized with grading by the week advisory lock).
--     It names the new board and revision ids, the exact response sha256,
--     parse fingerprint, call count, parser and model label, a required
--     reason, and records the database time. Optional evidence must be the
--     same response for the same contest, AI and snapshot, and not rejected;
--   * the existing lock guards are unchanged. Their one post-lock branch asks
--     "waiver_ai_late_entry_in_transaction" for an authorization inserted by
--     the current transaction naming this board; that helper now also
--     returns such an override, projected onto the approval row shape. An
--     override from any earlier transaction authorizes nothing, so it cannot
--     be replayed or reused;
--   * checked at COMMIT: the override's board exists LOCKED with that single
--     revision as current and locked revision, submittedAt = lockedAt =
--     createdAt = the override's database time, calls whose recomputed
--     fingerprint equals the authorized parse, and the verbatim response with
--     no prompt claim and no stated generation time; the board has no
--     approved late entry.
-- No lock time, existing board, revision, call or lock stamp is changed;
-- every other write at or after locksAt is refused exactly as before. There
-- is no session flag or setting that disables a lock check.
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverAiCompetitiveOverride" ADD CONSTRAINT "WaiverAiCompetitiveOverride_shape_check" CHECK (
  "callCount" >= 0
  AND "responseSha256" ~ '^[a-f0-9]{64}$' AND "boardFingerprint" ~ '^[a-f0-9]{64}$'
  AND length(btrim("parserVersion")) > 0
  AND length(btrim("modelLabel")) BETWEEN 1 AND 120
  AND length(btrim("reason")) BETWEEN 1 AND 2000
  AND ("sourceReference" IS NULL OR length(btrim("sourceReference")) BETWEEN 1 AND 500)
  AND "confirmation" = left("responseSha256", 12)
  AND "submissionId" <> "revisionId"
);

CREATE FUNCTION "waiver_ai_competitive_override_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_week text;
  v_locks timestamp;
  v_pinned text;
  v_position "ContestPosition";
  v_evidence "WaiverAiHistoricalEvidence"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI competitive overrides are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI competitive overrides cannot be deleted';
  END IF;

  NEW."authorizedAt" := "waiver_utc_now"();
  PERFORM "waiver_require_admin"(NEW."authorizedByUserId", 'AI competitive override administrator');

  SELECT c."weekId", c."locksAt", c."snapshotId", c."position" INTO v_week, v_locks, v_pinned, v_position
    FROM "WaiverContest" c WHERE c."id" = NEW."contestId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI competitive override must reference a Waiver contest';
  END IF;
  PERFORM "waiver_grade_week_lock"(v_week);
  IF "waiver_utc_now"() < v_locks THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an admin competitive override applies only after the lock; submit through the ordinary AI import';
  END IF;
  IF NEW."snapshotId" <> v_pinned OR NEW."position" <> v_position THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an admin competitive override must be on the contest''s pinned snapshot and position';
  END IF;
  PERFORM 1 FROM "UniversalProfile" p
    WHERE p."id" = NEW."universalProfileId" AND p."profileType" = 'AI' AND p."status" = 'ACTIVE' AND p."competitorActive";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an admin competitive override requires an active AI competitor profile';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverSubmission" s WHERE s."contestId" = NEW."contestId" AND s."universalProfileId" = NEW."universalProfileId") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: this AI profile already has a Waiver board for this contest; an override never replaces a board';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverAiLateEntryApproval" a WHERE a."contestId" = NEW."contestId" AND a."universalProfileId" = NEW."universalProfileId") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: this AI profile already has an approved late entry for this contest';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverGradeRun" g WHERE g."weekId" = v_week) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: the week has a grade run; admin competitive override is closed';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverSubmission" s WHERE s."id" = NEW."submissionId")
     OR EXISTS (SELECT 1 FROM "WaiverSubmissionRevision" r WHERE r."id" = NEW."revisionId") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an admin competitive override names a new board and revision';
  END IF;
  IF NEW."evidenceId" IS NOT NULL THEN
    SELECT * INTO v_evidence FROM "WaiverAiHistoricalEvidence" e WHERE e."id" = NEW."evidenceId";
    IF NOT FOUND OR v_evidence."contestId" <> NEW."contestId" OR v_evidence."universalProfileId" <> NEW."universalProfileId"
       OR v_evidence."snapshotId" <> NEW."snapshotId" OR v_evidence."responseSha256" <> NEW."responseSha256" THEN
      RAISE EXCEPTION 'WAIVER_INVALID: attached evidence must hold the same response for this contest, AI and frozen pool';
    END IF;
    IF "waiver_ai_evidence_latest_review"(NEW."evidenceId") IS NOT DISTINCT FROM 'REJECTED' THEN
      RAISE EXCEPTION 'WAIVER_INVALID: rejected evidence cannot be attached to an admin competitive override';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverAiCompetitiveOverride_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverAiCompetitiveOverride"
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_competitive_override_guard"();

-- Checked at COMMIT: the override created exactly the board it names.
CREATE FUNCTION "waiver_ai_competitive_override_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "WaiverSubmission" s
    WHERE s."id" = NEW."submissionId" AND s."contestId" = NEW."contestId" AND s."universalProfileId" = NEW."universalProfileId"
      AND s."authority" = 'SYSTEM_OPERATED' AND s."createdByUserId" = NEW."authorizedByUserId" AND s."status" = 'LOCKED'
      AND s."currentRevisionId" = NEW."revisionId" AND s."lockedRevisionId" = NEW."revisionId"
      AND s."submittedAt" = NEW."authorizedAt" AND s."lockedAt" = NEW."authorizedAt";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an admin competitive override must create its locked board in the same transaction';
  END IF;
  PERFORM 1 FROM "WaiverSubmissionRevision" r
    WHERE r."id" = NEW."revisionId" AND r."submissionId" = NEW."submissionId" AND r."revisionNumber" = 1
      AND r."kind" = 'SUBMISSION' AND r."snapshotId" = NEW."snapshotId" AND r."callCount" = NEW."callCount"
      AND r."fingerprint" = NEW."boardFingerprint" AND r."createdAt" = NEW."authorizedAt" AND r."authorUserId" = NEW."authorizedByUserId";
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM "WaiverSubmissionRevision" r WHERE r."submissionId" = NEW."submissionId" AND r."id" <> NEW."revisionId"
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an overridden board holds exactly its authorized revision';
  END IF;
  IF "waiver_revision_call_fingerprint"(NEW."revisionId") IS DISTINCT FROM NEW."boardFingerprint" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: overridden calls must match the authorized response';
  END IF;
  PERFORM 1 FROM "WaiverAiResponse" a
    WHERE a."revisionId" = NEW."revisionId" AND a."contestId" = NEW."contestId" AND a."universalProfileId" = NEW."universalProfileId"
      AND a."snapshotId" = NEW."snapshotId" AND a."responseSha256" = NEW."responseSha256"
      AND a."modelLabel" = NEW."modelLabel" AND a."parserVersion" = NEW."parserVersion"
      AND a."promptVersion" IS NULL AND a."promptSha256" IS NULL AND a."statedGeneratedAt" IS NULL
      AND a."importedByUserId" = NEW."authorizedByUserId" AND a."importedAt" >= NEW."authorizedAt";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an overridden revision carries the authorized verbatim response';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverAiLateEntryApproval" a WHERE a."submissionId" = NEW."submissionId"
             OR (a."contestId" = NEW."contestId" AND a."universalProfileId" = NEW."universalProfileId")) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a board has at most one post-lock authorization';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverAiCompetitiveOverride_board"
  AFTER INSERT ON "WaiverAiCompetitiveOverride"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_competitive_override_check"();

CREATE TRIGGER "WaiverAiCompetitiveOverride_no_truncate" BEFORE TRUNCATE ON "WaiverAiCompetitiveOverride"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_ai_truncate_guard"();

-- The post-lock authorization naming this board, when inserted by the current
-- transaction (or one of its subtransactions): an approved late entry or an
-- admin competitive override, the latter projected onto the approval row
-- shape (no verification, evidence binding or note; authorizer and time in
-- the approver columns). Committed authorizations return nothing. The lock
-- guards that call this are unchanged.
CREATE OR REPLACE FUNCTION "waiver_ai_late_entry_in_transaction"(p_submission text)
RETURNS SETOF "WaiverAiLateEntryApproval" LANGUAGE sql VOLATILE AS $$
  SELECT a.* FROM "WaiverAiLateEntryApproval" a
  WHERE a."submissionId" = p_submission AND "waiver_xmin_is_current_transaction"(a.xmin::text::bigint)
  UNION ALL
  SELECT o."id", NULL::text, NULL::text, o."contestId", o."universalProfileId", o."snapshotId", o."responseSha256",
         o."boardFingerprint", o."callCount", o."submissionId", o."revisionId", o."confirmation", NULL::text,
         o."authorizedByUserId", o."authorizedAt"
  FROM "WaiverAiCompetitiveOverride" o
  WHERE o."submissionId" = p_submission AND "waiver_xmin_is_current_transaction"(o.xmin::text::bigint)
$$;

