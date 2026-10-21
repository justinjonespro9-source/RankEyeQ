-- Waiver grade publication: an explicit, append-only operator step between
-- applying grading authority and showing grades on public leaderboards.
-- Applying authority never publishes. A publication binds one authority
-- change; a later regrade (a new change) is unpublished until published again.

CREATE TABLE "WaiverWeekGradePublication" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "gradeRunId" TEXT NOT NULL,
    "outputFingerprint" TEXT NOT NULL,
    "publishedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverWeekGradePublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaiverWeekGradePublication_changeId_key" ON "WaiverWeekGradePublication"("changeId");
CREATE INDEX "WaiverWeekGradePublication_weekId_idx" ON "WaiverWeekGradePublication"("weekId");
CREATE INDEX "WaiverWeekGradePublication_gradeRunId_idx" ON "WaiverWeekGradePublication"("gradeRunId");
CREATE INDEX "WaiverWeekGradePublication_publishedByUserId_idx" ON "WaiverWeekGradePublication"("publishedByUserId");

ALTER TABLE "WaiverWeekGradePublication" ADD CONSTRAINT "WaiverWeekGradePublication_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WaiverWeekGradePublication" ADD CONSTRAINT "WaiverWeekGradePublication_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "WaiverGradeAuthorityChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WaiverWeekGradePublication" ADD CONSTRAINT "WaiverWeekGradePublication_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "WaiverGradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WaiverWeekGradePublication" ADD CONSTRAINT "WaiverWeekGradePublication_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WaiverWeekGradePublication" ADD CONSTRAINT "WaiverWeekGradePublication_shape_check" CHECK (
  "outputFingerprint" ~ '^[a-f0-9]{64}$' AND length(btrim("reason")) > 0
);

CREATE FUNCTION "waiver_week_grade_publication_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_change "WaiverGradeAuthorityChange"%ROWTYPE;
  v_run "WaiverGradeRun"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver grade publications are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver grade publications cannot be deleted';
  END IF;

  PERFORM "waiver_grade_week_lock"(NEW."weekId");
  NEW."publishedAt" := "waiver_utc_now"();
  PERFORM "waiver_require_admin"(NEW."publishedByUserId", 'grade publisher');

  SELECT * INTO v_change FROM "WaiverGradeAuthorityChange" x WHERE x."id" = NEW."changeId";
  IF NOT FOUND OR v_change."weekId" <> NEW."weekId" OR v_change."newGradeRunId" <> NEW."gradeRunId"
     OR v_change."outputFingerprint" <> NEW."outputFingerprint" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a publication must name an authority change of its week with that change''s grade run and output';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverGradeAuthorityChange" y WHERE y."weekId" = NEW."weekId" AND y."sequence" > v_change."sequence") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: only the week''s latest authority change can be published';
  END IF;
  PERFORM 1 FROM "WaiverWeekGradeAuthority" w
  WHERE w."weekId" = NEW."weekId" AND w."changeId" = NEW."changeId" AND w."gradeRunId" = NEW."gradeRunId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a publication requires the change to be the week''s CURRENT applied authority';
  END IF;
  SELECT * INTO v_run FROM "WaiverGradeRun" g WHERE g."id" = NEW."gradeRunId";
  IF "waiver_canonical_artifact_state"(v_run."artifactRowId") IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: publication requires an ACCEPTED canonical artifact';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverWeekGradePublication_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverWeekGradePublication"
  FOR EACH ROW EXECUTE FUNCTION "waiver_week_grade_publication_guard"();

CREATE TRIGGER "WaiverWeekGradePublication_no_truncate" BEFORE TRUNCATE ON "WaiverWeekGradePublication"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"();
