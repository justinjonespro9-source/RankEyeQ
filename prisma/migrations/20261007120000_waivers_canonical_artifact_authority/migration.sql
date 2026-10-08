-- ---------------------------------------------------------------------------
-- Stage 4B.2: Waivers canonical artifact authority. Additive only: one enum,
-- three new tables, their indexes and Restrict foreign keys (generated), then
-- hand-written integrity backstops (immutability, transitions, TRUNCATE).
-- No existing table is altered and nothing is backfilled. Importing an
-- artifact never grades or touches contests.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "WaiverCanonicalPublicationState" AS ENUM ('ACCEPTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "WaiverCanonicalArtifact" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "supersedesArtifactId" TEXT,
    "contentChecksum" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "serializationVersion" TEXT NOT NULL,
    "rulesetCode" TEXT NOT NULL,
    "rulesetVersion" INTEGER NOT NULL,
    "rulesetDefinitionChecksum" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "positionPolicyVersion" TEXT NOT NULL,
    "readinessPolicyVersion" TEXT NOT NULL,
    "acceptanceId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "sngAcceptedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "readinessEvidenceChecksum" TEXT NOT NULL,
    "manifestChecksum" TEXT NOT NULL,
    "runFingerprint" TEXT NOT NULL,
    "inputSetChecksum" TEXT NOT NULL,
    "sourceRevisionFingerprint" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "weekId" TEXT NOT NULL,
    "qbFieldSize" INTEGER NOT NULL,
    "rbFieldSize" INTEGER NOT NULL,
    "wrFieldSize" INTEGER NOT NULL,
    "teFieldSize" INTEGER NOT NULL,
    "defFieldSize" INTEGER NOT NULL,
    "participantCount" INTEGER NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "defCrosswalkVersion" TEXT NOT NULL,
    "expectedContentChecksum" TEXT NOT NULL,
    "attestedPublicationState" "WaiverCanonicalPublicationState" NOT NULL,
    "authorityBasis" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "sourceObservedAt" TIMESTAMP(3) NOT NULL,
    "attestationVersion" TEXT NOT NULL,
    "attestationText" TEXT NOT NULL,
    "previewFingerprint" TEXT NOT NULL,
    "importedByUserId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverCanonicalArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverCanonicalArtifactContent" (
    "artifactRowId" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,

    CONSTRAINT "WaiverCanonicalArtifactContent_pkey" PRIMARY KEY ("artifactRowId")
);

-- CreateTable
CREATE TABLE "WaiverCanonicalArtifactEvent" (
    "id" TEXT NOT NULL,
    "artifactRowId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" "WaiverCanonicalPublicationState" NOT NULL,
    "successorArtifactRowId" TEXT,
    "basis" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "sourceObservedAt" TIMESTAMP(3) NOT NULL,
    "attestationVersion" TEXT NOT NULL,
    "reason" TEXT,
    "operatorUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverCanonicalArtifactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCanonicalArtifact_artifactId_key" ON "WaiverCanonicalArtifact"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCanonicalArtifact_supersedesArtifactId_key" ON "WaiverCanonicalArtifact"("supersedesArtifactId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCanonicalArtifact_contentChecksum_key" ON "WaiverCanonicalArtifact"("contentChecksum");

-- CreateIndex
CREATE INDEX "WaiverCanonicalArtifact_weekId_revision_idx" ON "WaiverCanonicalArtifact"("weekId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCanonicalArtifact_seriesKey_revision_key" ON "WaiverCanonicalArtifact"("seriesKey", "revision");

-- CreateIndex
CREATE INDEX "WaiverCanonicalArtifactEvent_successorArtifactRowId_idx" ON "WaiverCanonicalArtifactEvent"("successorArtifactRowId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverCanonicalArtifactEvent_artifactRowId_sequence_key" ON "WaiverCanonicalArtifactEvent"("artifactRowId", "sequence");

-- AddForeignKey
ALTER TABLE "WaiverCanonicalArtifact" ADD CONSTRAINT "WaiverCanonicalArtifact_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCanonicalArtifact" ADD CONSTRAINT "WaiverCanonicalArtifact_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCanonicalArtifact" ADD CONSTRAINT "WaiverCanonicalArtifact_supersedesArtifactId_fkey" FOREIGN KEY ("supersedesArtifactId") REFERENCES "WaiverCanonicalArtifact"("artifactId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCanonicalArtifactContent" ADD CONSTRAINT "WaiverCanonicalArtifactContent_artifactRowId_fkey" FOREIGN KEY ("artifactRowId") REFERENCES "WaiverCanonicalArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCanonicalArtifactEvent" ADD CONSTRAINT "WaiverCanonicalArtifactEvent_artifactRowId_fkey" FOREIGN KEY ("artifactRowId") REFERENCES "WaiverCanonicalArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCanonicalArtifactEvent" ADD CONSTRAINT "WaiverCanonicalArtifactEvent_successorArtifactRowId_fkey" FOREIGN KEY ("successorArtifactRowId") REFERENCES "WaiverCanonicalArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverCanonicalArtifactEvent" ADD CONSTRAINT "WaiverCanonicalArtifactEvent_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: canonical artifact integrity backstops. The import and
-- withdrawal services are the primary authority; these protect imported
-- evidence from application bugs:
--   * CHECK constraints on digests, lineage, sizes, attestation evidence,
--     stored text bytes and the event state/basis/successor shape;
--   * artifact metadata, content and events are immutable (no UPDATE; DELETE
--     only under the fixture-maintenance switch documented in the Phase 2
--     migration);
--   * import and event timestamps are the database clock (waiver_utc_now());
--   * an artifact references the Week of its own season and week, and
--     revision n > 1 supersedes the imported revision n-1 of the same series
--     and Week;
--   * events append in sequence: the first is the ACCEPTED import; only an
--     ACCEPTED artifact may become SUPERSEDED (naming its imported successor)
--     or WITHDRAWN (with a reason); SUPERSEDED and WITHDRAWN are terminal;
--   * checked at COMMIT: every artifact has its content and ACCEPTED import
--     event, and a series has at most one ACCEPTED artifact.
-- Errors use the Phase 2 prefixes WAIVER_INVALID / WAIVER_IMMUTABLE.
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverCanonicalArtifact" ADD CONSTRAINT "WaiverCanonicalArtifact_digests_check" CHECK (
  "contentChecksum" ~ '^[a-f0-9]{64}$' AND "rulesetDefinitionChecksum" ~ '^[a-f0-9]{64}$'
  AND "readinessEvidenceChecksum" ~ '^[a-f0-9]{64}$' AND "manifestChecksum" ~ '^[a-f0-9]{64}$'
  AND "runFingerprint" ~ '^[a-f0-9]{64}$' AND "inputSetChecksum" ~ '^[a-f0-9]{64}$'
  AND "sourceRevisionFingerprint" ~ '^[a-f0-9]{64}$' AND "previewFingerprint" ~ '^[a-f0-9]{64}$'
);
ALTER TABLE "WaiverCanonicalArtifact" ADD CONSTRAINT "WaiverCanonicalArtifact_lineage_check" CHECK (
  "revision" >= 1 AND ("revision" = 1) = ("supersedesArtifactId" IS NULL)
  AND "supersedesArtifactId" IS DISTINCT FROM "artifactId" AND "acceptanceId" = "artifactId"
);
ALTER TABLE "WaiverCanonicalArtifact" ADD CONSTRAINT "WaiverCanonicalArtifact_sizes_check" CHECK (
  "season" BETWEEN 2000 AND 2100 AND "weekNumber" BETWEEN 1 AND 18
  AND "qbFieldSize" >= 0 AND "rbFieldSize" >= 0 AND "wrFieldSize" >= 0 AND "teFieldSize" >= 0 AND "defFieldSize" >= 0
  AND "participantCount" >= 0 AND "byteLength" > 0
);
ALTER TABLE "WaiverCanonicalArtifact" ADD CONSTRAINT "WaiverCanonicalArtifact_attestation_check" CHECK (
  "expectedContentChecksum" = "contentChecksum" AND "attestedPublicationState" = 'ACCEPTED'
  AND "authorityBasis" = 'OPERATOR_ATTESTED' AND "sourceObservedAt" >= "acceptedAt"
  AND length(btrim("sourceReference")) > 0 AND length(btrim("attestationVersion")) > 0 AND length(btrim("attestationText")) > 0
);
ALTER TABLE "WaiverCanonicalArtifactContent" ADD CONSTRAINT "WaiverCanonicalArtifactContent_bytes_check" CHECK (
  "byteLength" = octet_length("contentText")
  AND "textSha256" = encode(sha256(convert_to("contentText", 'UTF8')), 'hex')
);
ALTER TABLE "WaiverCanonicalArtifactEvent" ADD CONSTRAINT "WaiverCanonicalArtifactEvent_shape_check" CHECK (
  "sequence" >= 1 AND length(btrim("sourceReference")) > 0 AND length(btrim("attestationVersion")) > 0
  AND (
    ("state" = 'ACCEPTED' AND "basis" = 'IMPORT_ATTESTATION' AND "sequence" = 1 AND "successorArtifactRowId" IS NULL)
    OR ("state" = 'SUPERSEDED' AND "basis" = 'SUCCESSOR_IMPORT' AND "sequence" > 1
        AND "successorArtifactRowId" IS NOT NULL AND "successorArtifactRowId" <> "artifactRowId")
    OR ("state" = 'WITHDRAWN' AND "basis" = 'OPERATOR_WITHDRAWAL' AND "sequence" > 1
        AND "successorArtifactRowId" IS NULL AND length(btrim(coalesce("reason", ''))) > 0)
  )
);

CREATE FUNCTION "waiver_canonical_artifact_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_prev "WaiverCanonicalArtifact"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: canonical artifacts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: canonical artifacts cannot be deleted';
  END IF;

  NEW."importedAt" := "waiver_utc_now"();
  IF NEW."sourceObservedAt" > NEW."importedAt" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: the SNG source observation cannot be after the import';
  END IF;
  PERFORM 1 FROM "Week" w JOIN "Season" s ON s."id" = w."seasonId"
  WHERE w."id" = NEW."weekId" AND s."year" = NEW."season" AND w."weekNumber" = NEW."weekNumber";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a canonical artifact must reference the Week of its own season and week';
  END IF;
  IF NEW."supersedesArtifactId" IS NOT NULL THEN
    SELECT * INTO v_prev FROM "WaiverCanonicalArtifact" a WHERE a."artifactId" = NEW."supersedesArtifactId";
    IF NOT FOUND OR v_prev."seriesKey" <> NEW."seriesKey" OR v_prev."weekId" <> NEW."weekId"
       OR v_prev."revision" <> NEW."revision" - 1 THEN
      RAISE EXCEPTION 'WAIVER_INVALID: revision n must supersede the imported revision n-1 of the same series and week';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverCanonicalArtifact_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverCanonicalArtifact"
  FOR EACH ROW EXECUTE FUNCTION "waiver_canonical_artifact_guard"();

CREATE FUNCTION "waiver_canonical_artifact_content_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: canonical artifact content is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: canonical artifact content cannot be deleted';
  END IF;
  PERFORM 1 FROM "WaiverCanonicalArtifact" a WHERE a."id" = NEW."artifactRowId" AND a."byteLength" = NEW."byteLength";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: canonical artifact content must match its artifact byte length';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverCanonicalArtifactContent_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverCanonicalArtifactContent"
  FOR EACH ROW EXECUTE FUNCTION "waiver_canonical_artifact_content_guard"();

CREATE FUNCTION "waiver_canonical_artifact_event_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_artifact "WaiverCanonicalArtifact"%ROWTYPE;
  v_last "WaiverCanonicalArtifactEvent"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: canonical artifact events are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: canonical artifact events cannot be deleted';
  END IF;

  NEW."recordedAt" := "waiver_utc_now"();
  IF NEW."sourceObservedAt" > NEW."recordedAt" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: the SNG source observation cannot be after the event is recorded';
  END IF;
  SELECT * INTO v_artifact FROM "WaiverCanonicalArtifact" a WHERE a."id" = NEW."artifactRowId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: unknown canonical artifact';
  END IF;
  SELECT * INTO v_last FROM "WaiverCanonicalArtifactEvent" e
  WHERE e."artifactRowId" = NEW."artifactRowId" ORDER BY e."sequence" DESC LIMIT 1;
  IF NOT FOUND THEN
    IF NEW."state" <> 'ACCEPTED' OR NEW."sequence" <> 1 THEN
      RAISE EXCEPTION 'WAIVER_INVALID: the first canonical artifact event must be its ACCEPTED import';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."sequence" <> v_last."sequence" + 1 THEN
    RAISE EXCEPTION 'WAIVER_INVALID: canonical artifact events must append in sequence';
  END IF;
  -- Legal: ACCEPTED -> SUPERSEDED | WITHDRAWN; SUPERSEDED -> WITHDRAWN. Nothing
  -- returns to ACCEPTED, so no series can regain a second ACCEPTED artifact.
  IF v_last."state" = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: WITHDRAWN is terminal; no further publication event may be recorded';
  END IF;
  IF NEW."state" = 'ACCEPTED' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an artifact is ACCEPTED only by its import';
  END IF;
  IF v_last."state" = 'SUPERSEDED' AND NEW."state" <> 'WITHDRAWN' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a SUPERSEDED artifact may only be recorded as later WITHDRAWN';
  END IF;
  IF NEW."state" = 'SUPERSEDED' THEN
    PERFORM 1 FROM "WaiverCanonicalArtifact" s
    WHERE s."id" = NEW."successorArtifactRowId" AND s."supersedesArtifactId" = v_artifact."artifactId"
      AND s."seriesKey" = v_artifact."seriesKey";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAIVER_INVALID: SUPERSEDED must name the imported successor revision of this artifact';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverCanonicalArtifactEvent_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverCanonicalArtifactEvent"
  FOR EACH ROW EXECUTE FUNCTION "waiver_canonical_artifact_event_guard"();

-- Checked at COMMIT: content and the ACCEPTED import event exist, and the
-- series has at most one ACCEPTED artifact (so a predecessor that is still
-- ACCEPTED must be superseded in the importing transaction).
CREATE FUNCTION "waiver_canonical_artifact_complete_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_accepted int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "WaiverCanonicalArtifact" a WHERE a."id" = NEW."id") THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "WaiverCanonicalArtifactContent" c WHERE c."artifactRowId" = NEW."id") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a canonical artifact must be stored with its content';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "WaiverCanonicalArtifactEvent" e
    WHERE e."artifactRowId" = NEW."id" AND e."sequence" = 1 AND e."state" = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a canonical artifact must be recorded with its ACCEPTED import event';
  END IF;
  SELECT count(*) INTO v_accepted FROM "WaiverCanonicalArtifact" a
  WHERE a."seriesKey" = NEW."seriesKey"
    AND (
      SELECT e."state" FROM "WaiverCanonicalArtifactEvent" e
      WHERE e."artifactRowId" = a."id" ORDER BY e."sequence" DESC LIMIT 1
    ) = 'ACCEPTED';
  IF v_accepted > 1 THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a canonical artifact series may have at most one ACCEPTED artifact';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverCanonicalArtifact_complete"
  AFTER INSERT ON "WaiverCanonicalArtifact"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_canonical_artifact_complete_check"();

-- TRUNCATE skips row-level DELETE guards and the table owner always holds the
-- privilege, so refuse it (directly or through another table's CASCADE)
-- outside fixture maintenance.
CREATE FUNCTION "waiver_canonical_artifact_truncate_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "waiver_fixture_maintenance"() THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'WAIVER_IMMUTABLE: canonical artifact records cannot be truncated';
END;
$$;

CREATE TRIGGER "WaiverCanonicalArtifact_no_truncate"
  BEFORE TRUNCATE ON "WaiverCanonicalArtifact"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_canonical_artifact_truncate_guard"();

CREATE TRIGGER "WaiverCanonicalArtifactContent_no_truncate"
  BEFORE TRUNCATE ON "WaiverCanonicalArtifactContent"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_canonical_artifact_truncate_guard"();

CREATE TRIGGER "WaiverCanonicalArtifactEvent_no_truncate"
  BEFORE TRUNCATE ON "WaiverCanonicalArtifactEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_canonical_artifact_truncate_guard"();
