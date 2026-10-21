-- ---------------------------------------------------------------------------
-- RankEyeQ final-week-stats results source (`rankeyeq-final-week-stats/1`).
-- Additive only: two enums, two new tables, their indexes and Restrict foreign
-- keys (generated), then hand-written integrity backstops. No existing table is
-- altered, nothing is backfilled, and WaiverContestResult / WaiverGradeRun are
-- untouched (dual-source wiring is a separate migration). The source is
-- independent of WaiverCanonicalArtifact and never impersonates SNG.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "WaiverRankEyeQResultsPublicationState" AS ENUM ('ACCEPTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "WaiverZeroPointDecision" AS ENUM ('PENDING', 'PLAYED_ZERO', 'DID_NOT_PLAY');

-- CreateTable
CREATE TABLE "WaiverRankEyeQResultsSnapshot" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "contentChecksum" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "rankingsWeekStatus" TEXT NOT NULL,
    "sourceWeekId" TEXT NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "supersedesSnapshotId" TEXT,
    "participantCount" INTEGER NOT NULL,
    "pendingZeroCount" INTEGER NOT NULL,
    "unresolvedCount" INTEGER NOT NULL,
    "authorityBasis" TEXT NOT NULL,
    "attestationVersion" TEXT NOT NULL,
    "attestationText" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "previewFingerprint" TEXT NOT NULL,
    "builtByUserId" TEXT NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicationState" "WaiverRankEyeQResultsPublicationState" NOT NULL DEFAULT 'ACCEPTED',
    "content" JSONB NOT NULL,

    CONSTRAINT "WaiverRankEyeQResultsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverRankEyeQParticipationDecision" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rankableEntryId" TEXT NOT NULL,
    "decision" "WaiverZeroPointDecision" NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverRankEyeQParticipationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaiverRankEyeQResultsSnapshot_contentChecksum_key" ON "WaiverRankEyeQResultsSnapshot"("contentChecksum");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverRankEyeQResultsSnapshot_supersedesSnapshotId_key" ON "WaiverRankEyeQResultsSnapshot"("supersedesSnapshotId");

-- CreateIndex
CREATE INDEX "WaiverRankEyeQResultsSnapshot_weekId_revision_idx" ON "WaiverRankEyeQResultsSnapshot"("weekId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverRankEyeQResultsSnapshot_seriesKey_revision_key" ON "WaiverRankEyeQResultsSnapshot"("seriesKey", "revision");

-- CreateIndex
CREATE INDEX "WaiverRankEyeQParticipationDecision_rankableEntryId_idx" ON "WaiverRankEyeQParticipationDecision"("rankableEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverRankEyeQParticipationDecision_snapshotId_rankableEntr_key" ON "WaiverRankEyeQParticipationDecision"("snapshotId", "rankableEntryId");

-- AddForeignKey
ALTER TABLE "WaiverRankEyeQResultsSnapshot" ADD CONSTRAINT "WaiverRankEyeQResultsSnapshot_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverRankEyeQResultsSnapshot" ADD CONSTRAINT "WaiverRankEyeQResultsSnapshot_builtByUserId_fkey" FOREIGN KEY ("builtByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverRankEyeQResultsSnapshot" ADD CONSTRAINT "WaiverRankEyeQResultsSnapshot_supersedesSnapshotId_fkey" FOREIGN KEY ("supersedesSnapshotId") REFERENCES "WaiverRankEyeQResultsSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverRankEyeQParticipationDecision" ADD CONSTRAINT "WaiverRankEyeQParticipationDecision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverRankEyeQResultsSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverRankEyeQParticipationDecision" ADD CONSTRAINT "WaiverRankEyeQParticipationDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: RankEyeQ results snapshot integrity backstops. The commit
-- service is the primary authority; these protect stored evidence from
-- application bugs:
--   * CHECK constraints on pins, digests, lineage, counts and attestation;
--   * snapshot content is immutable: the only legal UPDATE moves
--     publicationState ACCEPTED -> SUPERSEDED | WITHDRAWN (DELETE only under
--     the fixture-maintenance switch);
--   * participation decisions are append-only (no UPDATE; DELETE only under
--     the fixture-maintenance switch);
--   * TRUNCATE is refused outside fixture maintenance.
-- Errors use the Phase 2 prefixes WAIVER_INVALID / WAIVER_IMMUTABLE.
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverRankEyeQResultsSnapshot" ADD CONSTRAINT "WaiverRankEyeQResultsSnapshot_pins_check" CHECK (
  "schemaVersion" = 'rankeyeq-final-week-stats/1'
  AND "scoringVersion" = 'FANTASYTRACK_NFL_HALF_PPR_V2'
  AND "rankingsWeekStatus" = 'COMPLETE'
  AND "sourceWeekId" = "weekId"
  AND "authorityBasis" = 'RANKEYEQ_OPERATOR_ATTESTED'
);
ALTER TABLE "WaiverRankEyeQResultsSnapshot" ADD CONSTRAINT "WaiverRankEyeQResultsSnapshot_digests_check" CHECK (
  "contentChecksum" ~ '^[a-f0-9]{64}$' AND "previewFingerprint" ~ '^[a-f0-9]{64}$'
);
ALTER TABLE "WaiverRankEyeQResultsSnapshot" ADD CONSTRAINT "WaiverRankEyeQResultsSnapshot_lineage_check" CHECK (
  "revision" >= 1 AND ("revision" = 1) = ("supersedesSnapshotId" IS NULL)
  AND "supersedesSnapshotId" IS DISTINCT FROM "id"
);
ALTER TABLE "WaiverRankEyeQResultsSnapshot" ADD CONSTRAINT "WaiverRankEyeQResultsSnapshot_counts_check" CHECK (
  "participantCount" >= 0 AND "pendingZeroCount" >= 0 AND "unresolvedCount" >= "pendingZeroCount"
  AND "unresolvedCount" <= "participantCount"
  AND ("publicationState" <> 'ACCEPTED' OR ("pendingZeroCount" = 0 AND "unresolvedCount" = 0))
);
ALTER TABLE "WaiverRankEyeQResultsSnapshot" ADD CONSTRAINT "WaiverRankEyeQResultsSnapshot_attestation_check" CHECK (
  length(btrim("sourceReference")) > 0 AND length(btrim("attestationVersion")) > 0 AND length(btrim("attestationText")) > 0
  AND jsonb_typeof("content") = 'object'
);
ALTER TABLE "WaiverRankEyeQParticipationDecision" ADD CONSTRAINT "WaiverRankEyeQParticipationDecision_shape_check" CHECK (
  "decision" IN ('PLAYED_ZERO', 'DID_NOT_PLAY')
  AND length(btrim("evidenceReference")) > 0 AND length(btrim("reason")) > 0
);

CREATE FUNCTION "waiver_rankeyeq_results_snapshot_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: RankEyeQ results snapshots cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."publicationState" IS DISTINCT FROM OLD."publicationState"
       AND OLD."publicationState" = 'ACCEPTED'
       AND NEW."publicationState" IN ('SUPERSEDED', 'WITHDRAWN')
       AND (to_jsonb(NEW) - 'publicationState') = (to_jsonb(OLD) - 'publicationState') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: RankEyeQ results snapshots are immutable; only ACCEPTED may become SUPERSEDED or WITHDRAWN';
  END IF;
  NEW."builtAt" := "waiver_utc_now"();
  PERFORM 1 FROM "Week" w JOIN "Season" s ON s."id" = w."seasonId"
  WHERE w."id" = NEW."weekId" AND w."status" = 'COMPLETE'
    AND (NEW."content"->'week'->>'season')::int = s."year"
    AND (NEW."content"->'week'->>'weekNumber')::int = w."weekNumber";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a RankEyeQ results snapshot must reference the COMPLETE Week of its own season and week';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverRankEyeQResultsSnapshot_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverRankEyeQResultsSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "waiver_rankeyeq_results_snapshot_guard"();

CREATE FUNCTION "waiver_rankeyeq_participation_decision_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: RankEyeQ participation decisions are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: RankEyeQ participation decisions cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverRankEyeQParticipationDecision_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverRankEyeQParticipationDecision"
  FOR EACH ROW EXECUTE FUNCTION "waiver_rankeyeq_participation_decision_guard"();

CREATE FUNCTION "waiver_rankeyeq_results_truncate_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "waiver_fixture_maintenance"() THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'WAIVER_IMMUTABLE: RankEyeQ results records cannot be truncated';
END;
$$;

CREATE TRIGGER "WaiverRankEyeQResultsSnapshot_no_truncate"
  BEFORE TRUNCATE ON "WaiverRankEyeQResultsSnapshot"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_rankeyeq_results_truncate_guard"();

CREATE TRIGGER "WaiverRankEyeQParticipationDecision_no_truncate"
  BEFORE TRUNCATE ON "WaiverRankEyeQParticipationDecision"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_rankeyeq_results_truncate_guard"();
