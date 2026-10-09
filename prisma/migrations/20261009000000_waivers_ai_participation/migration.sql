-- CreateEnum
CREATE TYPE "WaiverAiEvidenceReviewStatus" AS ENUM ('TEXT_CONFIRMED', 'NEEDS_FOLLOW_UP', 'REJECTED');

-- CreateTable
CREATE TABLE "WaiverAiResponse" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "modelLabel" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptSha256" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "responseSha256" TEXT NOT NULL,
    "responseByteLength" INTEGER NOT NULL,
    "noCalls" BOOLEAN NOT NULL,
    "statedGeneratedAt" TIMESTAMP(3),
    "sourceReference" TEXT,
    "sourceNote" TEXT,
    "importedByUserId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverAiResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverAiHistoricalEvidence" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "modelLabel" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "responseSha256" TEXT NOT NULL,
    "responseByteLength" INTEGER NOT NULL,
    "statedSourceAt" TIMESTAMP(3),
    "evidenceSource" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "note" TEXT,
    "recordedAfterLock" BOOLEAN NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverAiHistoricalEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverAiHistoricalEvidenceReview" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "WaiverAiEvidenceReviewStatus" NOT NULL,
    "note" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverAiHistoricalEvidenceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiResponse_revisionId_key" ON "WaiverAiResponse"("revisionId");

-- CreateIndex
CREATE INDEX "WaiverAiResponse_contestId_universalProfileId_idx" ON "WaiverAiResponse"("contestId", "universalProfileId");

-- CreateIndex
CREATE INDEX "WaiverAiResponse_snapshotId_idx" ON "WaiverAiResponse"("snapshotId");

-- CreateIndex
CREATE INDEX "WaiverAiResponse_universalProfileId_idx" ON "WaiverAiResponse"("universalProfileId");

-- CreateIndex
CREATE INDEX "WaiverAiResponse_importedByUserId_idx" ON "WaiverAiResponse"("importedByUserId");

-- CreateIndex
CREATE INDEX "WaiverAiHistoricalEvidence_universalProfileId_idx" ON "WaiverAiHistoricalEvidence"("universalProfileId");

-- CreateIndex
CREATE INDEX "WaiverAiHistoricalEvidence_snapshotId_idx" ON "WaiverAiHistoricalEvidence"("snapshotId");

-- CreateIndex
CREATE INDEX "WaiverAiHistoricalEvidence_recordedByUserId_idx" ON "WaiverAiHistoricalEvidence"("recordedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiHistoricalEvidence_contestId_universalProfileId_res_key" ON "WaiverAiHistoricalEvidence"("contestId", "universalProfileId", "responseSha256");

-- CreateIndex
CREATE INDEX "WaiverAiHistoricalEvidenceReview_reviewerUserId_idx" ON "WaiverAiHistoricalEvidenceReview"("reviewerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiHistoricalEvidenceReview_evidenceId_sequence_key" ON "WaiverAiHistoricalEvidenceReview"("evidenceId", "sequence");

-- AddForeignKey
ALTER TABLE "WaiverAiResponse" ADD CONSTRAINT "WaiverAiResponse_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "WaiverSubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiResponse" ADD CONSTRAINT "WaiverAiResponse_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiResponse" ADD CONSTRAINT "WaiverAiResponse_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiResponse" ADD CONSTRAINT "WaiverAiResponse_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiResponse" ADD CONSTRAINT "WaiverAiResponse_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiHistoricalEvidence" ADD CONSTRAINT "WaiverAiHistoricalEvidence_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiHistoricalEvidence" ADD CONSTRAINT "WaiverAiHistoricalEvidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiHistoricalEvidence" ADD CONSTRAINT "WaiverAiHistoricalEvidence_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiHistoricalEvidence" ADD CONSTRAINT "WaiverAiHistoricalEvidence_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiHistoricalEvidenceReview" ADD CONSTRAINT "WaiverAiHistoricalEvidenceReview_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "WaiverAiHistoricalEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiHistoricalEvidenceReview" ADD CONSTRAINT "WaiverAiHistoricalEvidenceReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- One-board-per-login applies to owner-authored boards only. The partial
-- unique index is built before the full one is dropped, so owner-authored
-- uniqueness holds at every point of this migration; every existing row is
-- OWNER_AUTHORED (audited before deployment), so the build cannot fail on
-- data the full index already admitted. The (contestId, universalProfileId)
-- unique is unchanged: still one board per profile per contest.
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "WaiverSubmission_contestId_createdByUserId_owner_key" ON "WaiverSubmission"("contestId", "createdByUserId") WHERE (authority = 'OWNER_AUTHORED'::"SubmissionAuthority");

-- DropIndex
DROP INDEX "WaiverSubmission_contestId_createdByUserId_key";

-- ---------------------------------------------------------------------------
-- Hand-written: AI participation integrity backstops. The application
-- services are the primary authority; these protect competitive evidence
-- from application bugs:
--   * a new board is OWNER_AUTHORED (the creating login's own HUMAN or
--     CREATOR profile) or SYSTEM_OPERATED (an active AI competitor profile,
--     created by an ADMIN); RANKEYEQ_CAPTURED Waiver boards are refused;
--   * a SYSTEM_OPERATED revision is a SUBMISSION authored by an ADMIN for a
--     still-active AI competitor;
--   * checked at COMMIT: a SYSTEM_OPERATED revision has its verbatim AI
--     response, and a SYSTEM_OPERATED board is never left as an empty draft;
--   * AI responses are immutable, match their revision, board, contest,
--     position, pinned snapshot and AI profile, carry a database-checked
--     sha256 of the exact text, and are refused at or after the lock;
--   * historical evidence is append-only and record-only (no trigger here
--     or anywhere writes a board, revision, call or grade from it); its
--     recordedAfterLock flag is derived from the database clock;
--   * evidence reviews append in sequence; none implies competitive
--     eligibility;
--   * stated source/generation times are stored as stated and may not be
--     after the database recording time; they are never proof of timing.
-- Existing lock triggers are unchanged and still refuse every board,
-- revision and call INSERT at or after locksAt for every authority.
-- Errors use the Phase 2 prefixes WAIVER_INVALID / WAIVER_LOCKED / WAIVER_IMMUTABLE.
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverAiResponse" ADD CONSTRAINT "WaiverAiResponse_text_check" CHECK (
  "responseByteLength" = octet_length("responseText") AND "responseByteLength" BETWEEN 1 AND 65536
  AND "responseSha256" = encode(sha256(convert_to("responseText", 'UTF8')), 'hex')
);
ALTER TABLE "WaiverAiResponse" ADD CONSTRAINT "WaiverAiResponse_provenance_check" CHECK (
  "promptVersion" ~ '^WAIVEREYEQ_AI_V[1-9][0-9]*$' AND "promptSha256" ~ '^[a-f0-9]{64}$'
  AND length(btrim("parserVersion")) > 0
  AND length(btrim("modelLabel")) BETWEEN 1 AND 120
  AND ("sourceReference" IS NULL OR length(btrim("sourceReference")) BETWEEN 1 AND 500)
  AND ("sourceNote" IS NULL OR length(btrim("sourceNote")) BETWEEN 1 AND 2000)
);
ALTER TABLE "WaiverAiHistoricalEvidence" ADD CONSTRAINT "WaiverAiHistoricalEvidence_text_check" CHECK (
  "responseByteLength" = octet_length("responseText") AND "responseByteLength" BETWEEN 1 AND 65536
  AND "responseSha256" = encode(sha256(convert_to("responseText", 'UTF8')), 'hex')
);
ALTER TABLE "WaiverAiHistoricalEvidence" ADD CONSTRAINT "WaiverAiHistoricalEvidence_provenance_check" CHECK (
  length(btrim("modelLabel")) BETWEEN 1 AND 120
  AND "evidenceSource" IN ('CHAT_EXPORT', 'CHAT_SHARE_LINK', 'COPIED_TEXT', 'SCREENSHOT_TRANSCRIPTION', 'OTHER')
  AND length(btrim("evidenceReference")) BETWEEN 1 AND 500
  AND ("note" IS NULL OR length(btrim("note")) BETWEEN 1 AND 2000)
);
ALTER TABLE "WaiverAiHistoricalEvidenceReview" ADD CONSTRAINT "WaiverAiHistoricalEvidenceReview_shape_check" CHECK (
  "sequence" >= 1 AND length(btrim("note")) BETWEEN 1 AND 2000
);

CREATE FUNCTION "waiver_submission_authority_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type "ProfileType";
  v_status "ProfileStatus";
  v_active boolean;
  v_login_profile text;
BEGIN
  SELECT p."profileType", p."status", p."competitorActive" INTO v_type, v_status, v_active
    FROM "UniversalProfile" p WHERE p."id" = NEW."universalProfileId";

  IF NEW."authority" = 'OWNER_AUTHORED' THEN
    SELECT u."universalProfileId" INTO v_login_profile FROM "User" u WHERE u."id" = NEW."createdByUserId";
    IF v_login_profile IS DISTINCT FROM NEW."universalProfileId" OR v_type IS NULL OR v_type NOT IN ('HUMAN', 'CREATOR') THEN
      RAISE EXCEPTION 'WAIVER_INVALID: an owner-authored Waiver board belongs to the creating login''s own HUMAN or CREATOR profile';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."authority" = 'SYSTEM_OPERATED' THEN
    IF v_type IS DISTINCT FROM 'AI' OR v_status IS DISTINCT FROM 'ACTIVE' OR v_active IS NOT TRUE THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a system-operated Waiver board belongs to an active AI competitor profile';
    END IF;
    PERFORM "waiver_require_admin"(NEW."createdByUserId", 'system-operated Waiver board creator');
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'WAIVER_INVALID: Waiver boards are owner-authored or system-operated';
END;
$$;

CREATE TRIGGER "WaiverSubmission_authority_guard"
  BEFORE INSERT ON "WaiverSubmission"
  FOR EACH ROW EXECUTE FUNCTION "waiver_submission_authority_guard"();

CREATE FUNCTION "waiver_revision_authority_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_authority "SubmissionAuthority";
  v_profile text;
BEGIN
  SELECT s."authority", s."universalProfileId" INTO v_authority, v_profile
    FROM "WaiverSubmission" s WHERE s."id" = NEW."submissionId";
  IF v_authority IS DISTINCT FROM 'SYSTEM_OPERATED' THEN
    RETURN NEW;
  END IF;
  IF NEW."kind" <> 'SUBMISSION' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: system-operated Waiver boards take SUBMISSION revisions only';
  END IF;
  PERFORM 1 FROM "UniversalProfile" p
    WHERE p."id" = v_profile AND p."profileType" = 'AI' AND p."status" = 'ACTIVE' AND p."competitorActive";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a system-operated Waiver revision requires an active AI competitor profile';
  END IF;
  PERFORM "waiver_require_admin"(NEW."authorUserId", 'system-operated Waiver revision author');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverSubmissionRevision_authority_guard"
  BEFORE INSERT ON "WaiverSubmissionRevision"
  FOR EACH ROW EXECUTE FUNCTION "waiver_revision_authority_guard"();

-- Checked at COMMIT: a SYSTEM_OPERATED revision carries its verbatim AI response.
CREATE FUNCTION "waiver_ai_revision_response_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "WaiverSubmission" s WHERE s."id" = NEW."submissionId" AND s."authority" = 'SYSTEM_OPERATED';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM 1 FROM "WaiverAiResponse" a WHERE a."revisionId" = NEW."id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a system-operated Waiver revision requires its verbatim AI response';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverSubmissionRevision_ai_response"
  AFTER INSERT ON "WaiverSubmissionRevision"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_revision_response_check"();

-- Checked at COMMIT: a SYSTEM_OPERATED board is submitted in the transaction that creates it.
CREATE FUNCTION "waiver_ai_submission_shape_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."authority" <> 'SYSTEM_OPERATED' THEN
    RETURN NULL;
  END IF;
  PERFORM 1 FROM "WaiverSubmission" s
    WHERE s."id" = NEW."id" AND s."status" <> 'DRAFT' AND s."currentRevisionId" IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a system-operated Waiver board must be submitted with its first revision';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverSubmission_ai_shape"
  AFTER INSERT ON "WaiverSubmission"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_submission_shape_check"();

CREATE FUNCTION "waiver_ai_response_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_kind "WaiverRevisionKind";
  v_call_count int;
  v_revision_snapshot text;
  v_author text;
  v_authority "SubmissionAuthority";
  v_contest text;
  v_profile text;
  v_position "ContestPosition";
  v_pinned text;
  v_locks timestamp;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI Waiver responses are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI Waiver responses cannot be deleted';
  END IF;

  NEW."importedAt" := "waiver_utc_now"();
  SELECT r."kind", r."callCount", r."snapshotId", r."authorUserId", s."authority", s."contestId", s."universalProfileId",
         c."position", c."snapshotId", c."locksAt"
    INTO v_kind, v_call_count, v_revision_snapshot, v_author, v_authority, v_contest, v_profile, v_position, v_pinned, v_locks
    FROM "WaiverSubmissionRevision" r
    JOIN "WaiverSubmission" s ON s."id" = r."submissionId"
    JOIN "WaiverContest" c ON c."id" = s."contestId"
    WHERE r."id" = NEW."revisionId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver response must reference a board revision';
  END IF;
  IF NEW."importedAt" >= v_locks THEN
    RAISE EXCEPTION 'WAIVER_LOCKED: no AI Waiver responses at or after lock';
  END IF;
  IF v_authority <> 'SYSTEM_OPERATED' OR v_kind <> 'SUBMISSION' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver response belongs to a system-operated SUBMISSION revision';
  END IF;
  IF NEW."contestId" <> v_contest OR NEW."universalProfileId" <> v_profile OR NEW."position" <> v_position
     OR NEW."snapshotId" <> v_revision_snapshot OR NEW."snapshotId" <> v_pinned THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver response must match its board, contest, position and pinned snapshot';
  END IF;
  IF NEW."importedByUserId" <> v_author THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver response is imported by its revision author';
  END IF;
  IF NEW."noCalls" <> (v_call_count = 0) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver response is NO CALLS exactly when its revision has no calls';
  END IF;
  IF NEW."statedGeneratedAt" IS NOT NULL AND NEW."statedGeneratedAt" > NEW."importedAt" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a stated generation time cannot be after the import';
  END IF;
  PERFORM "waiver_require_admin"(NEW."importedByUserId", 'AI Waiver response importer');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverAiResponse_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverAiResponse"
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_response_guard"();

CREATE FUNCTION "waiver_ai_evidence_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_position "ContestPosition";
  v_pinned text;
  v_locks timestamp;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI Waiver historical evidence is append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI Waiver historical evidence cannot be deleted';
  END IF;

  NEW."recordedAt" := "waiver_utc_now"();
  SELECT c."position", c."snapshotId", c."locksAt" INTO v_position, v_pinned, v_locks
    FROM "WaiverContest" c WHERE c."id" = NEW."contestId";
  IF NOT FOUND OR NEW."position" <> v_position OR NEW."snapshotId" <> v_pinned THEN
    RAISE EXCEPTION 'WAIVER_INVALID: AI Waiver evidence must match its contest''s position and pinned snapshot';
  END IF;
  NEW."recordedAfterLock" := NEW."recordedAt" >= v_locks;
  PERFORM 1 FROM "UniversalProfile" p WHERE p."id" = NEW."universalProfileId" AND p."profileType" = 'AI';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: AI Waiver evidence belongs to an AI profile';
  END IF;
  IF NEW."statedSourceAt" IS NOT NULL AND NEW."statedSourceAt" > NEW."recordedAt" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a stated source time cannot be after the recording';
  END IF;
  PERFORM "waiver_require_admin"(NEW."recordedByUserId", 'AI Waiver evidence recorder');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverAiHistoricalEvidence_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverAiHistoricalEvidence"
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_evidence_guard"();

CREATE FUNCTION "waiver_ai_evidence_review_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_next int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI Waiver evidence reviews are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI Waiver evidence reviews cannot be deleted';
  END IF;

  NEW."reviewedAt" := "waiver_utc_now"();
  PERFORM 1 FROM "WaiverAiHistoricalEvidence" e WHERE e."id" = NEW."evidenceId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver evidence review must reference evidence';
  END IF;
  SELECT coalesce(max(r."sequence"), 0) + 1 INTO v_next
    FROM "WaiverAiHistoricalEvidenceReview" r WHERE r."evidenceId" = NEW."evidenceId";
  IF NEW."sequence" <> v_next THEN
    RAISE EXCEPTION 'WAIVER_INVALID: AI Waiver evidence reviews must be sequential';
  END IF;
  PERFORM "waiver_require_admin"(NEW."reviewerUserId", 'AI Waiver evidence reviewer');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverAiHistoricalEvidenceReview_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverAiHistoricalEvidenceReview"
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_evidence_review_guard"();

-- TRUNCATE skips row-level DELETE guards and the table owner always holds the
-- privilege, so refuse it (directly or through another table's CASCADE)
-- outside fixture maintenance.
CREATE FUNCTION "waiver_ai_truncate_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "waiver_fixture_maintenance"() THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI Waiver responses and evidence cannot be truncated';
END;
$$;

CREATE TRIGGER "WaiverAiResponse_no_truncate" BEFORE TRUNCATE ON "WaiverAiResponse"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_ai_truncate_guard"();
CREATE TRIGGER "WaiverAiHistoricalEvidence_no_truncate" BEFORE TRUNCATE ON "WaiverAiHistoricalEvidence"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_ai_truncate_guard"();
CREATE TRIGGER "WaiverAiHistoricalEvidenceReview_no_truncate" BEFORE TRUNCATE ON "WaiverAiHistoricalEvidenceReview"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_ai_truncate_guard"();
