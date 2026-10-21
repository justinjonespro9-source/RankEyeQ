-- ---------------------------------------------------------------------------
-- Dual-source grading storage: a grade run (and its contest results, approval
-- and contest authority pointers) is bound to EXACTLY ONE verified results
-- source:
--
--   SNG       "artifactRowId"       -> "WaiverCanonicalArtifact"           (existing)
--   RankEyeQ  "rankEyeQSnapshotId"  -> "WaiverRankEyeQResultsSnapshot"
--                                      (`rankeyeq-final-week-stats/1`)
--
-- "artifactContentChecksum" keeps its name and now holds the SOURCE content
-- checksum (the artifact's, or the RankEyeQ snapshot's). A RankEyeQ approval
-- stores the snapshot's revision in "artifactRevision", the snapshot builder in
-- "artifactImportedByUserId" and the DEF crosswalk 'rankeyeq-native/1' with
-- "defCrosswalkAcknowledged" = true meaning "not applicable, acknowledged".
-- WAIVER_EYEQ_V1 and every scoring CHECK are untouched. A RankEyeQ source never
-- impersonates SNG: the two ids are mutually exclusive and checked here.
--
-- "WaiverConflictResolution" stays SNG-only (D3 BYE/team-change resolutions bind
-- an SNG artifact); RankEyeQ has no BYE disposition so no D3 resolution applies
-- to a RankEyeQ-sourced result.
--
-- Existing rows all have "artifactRowId", so the XOR checks hold for them. No
-- data is changed.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "WaiverContestResult" ADD COLUMN     "rankEyeQSnapshotId" TEXT,
ALTER COLUMN "artifactRowId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WaiverGradeRun" ADD COLUMN     "rankEyeQSnapshotId" TEXT,
ALTER COLUMN "artifactRowId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WaiverGradeApproval" ADD COLUMN     "rankEyeQSnapshotId" TEXT,
ALTER COLUMN "artifactRowId" DROP NOT NULL;

-- AlterTable (a pointer row mirrors its contest result's source; it has no artifact FK either)
ALTER TABLE "WaiverContestResultAuthority" ADD COLUMN     "rankEyeQSnapshotId" TEXT,
ALTER COLUMN "artifactRowId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "WaiverContestResult_rankEyeQSnapshotId_idx" ON "WaiverContestResult"("rankEyeQSnapshotId");

-- CreateIndex
CREATE INDEX "WaiverGradeRun_rankEyeQSnapshotId_idx" ON "WaiverGradeRun"("rankEyeQSnapshotId");

-- CreateIndex
CREATE INDEX "WaiverGradeApproval_rankEyeQSnapshotId_idx" ON "WaiverGradeApproval"("rankEyeQSnapshotId");

-- AddForeignKey
ALTER TABLE "WaiverContestResult" ADD CONSTRAINT "WaiverContestResult_rankEyeQSnapshotId_fkey" FOREIGN KEY ("rankEyeQSnapshotId") REFERENCES "WaiverRankEyeQResultsSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_rankEyeQSnapshotId_fkey" FOREIGN KEY ("rankEyeQSnapshotId") REFERENCES "WaiverRankEyeQResultsSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverGradeApproval" ADD CONSTRAINT "WaiverGradeApproval_rankEyeQSnapshotId_fkey" FOREIGN KEY ("rankEyeQSnapshotId") REFERENCES "WaiverRankEyeQResultsSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Exactly one source (XOR)
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverContestResult" ADD CONSTRAINT "WaiverContestResult_source_xor_check" CHECK (
  num_nonnulls("artifactRowId", "rankEyeQSnapshotId") = 1
);

ALTER TABLE "WaiverGradeRun" ADD CONSTRAINT "WaiverGradeRun_source_xor_check" CHECK (
  num_nonnulls("artifactRowId", "rankEyeQSnapshotId") = 1
);

ALTER TABLE "WaiverGradeApproval" ADD CONSTRAINT "WaiverGradeApproval_source_xor_check" CHECK (
  num_nonnulls("artifactRowId", "rankEyeQSnapshotId") = 1
  -- A RankEyeQ approval carries the native crosswalk marker; an SNG approval never does.
  AND ("rankEyeQSnapshotId" IS NOT NULL) = ("defCrosswalkVersion" = 'rankeyeq-native/1')
);

ALTER TABLE "WaiverContestResultAuthority" ADD CONSTRAINT "WaiverContestResultAuthority_source_xor_check" CHECK (
  num_nonnulls("artifactRowId", "rankEyeQSnapshotId") = 1
);

-- ---------------------------------------------------------------------------
-- Source state helpers and patched guards (CREATE OR REPLACE; triggers keep their bindings)
-- ---------------------------------------------------------------------------

-- Latest publication state of a RankEyeQ results snapshot (NULL when unknown).
CREATE FUNCTION "waiver_rankeyeq_results_snapshot_state"(p_snapshot text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT s."publicationState"::text FROM "WaiverRankEyeQResultsSnapshot" s WHERE s."id" = p_snapshot
$$;

-- True when exactly one source is named and it is ACCEPTED (SNG artifact or RankEyeQ snapshot).
CREATE FUNCTION "waiver_grading_source_accepted"(p_artifact text, p_snapshot text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_artifact IS NOT NULL AND p_snapshot IS NULL THEN "waiver_canonical_artifact_state"(p_artifact) IS NOT DISTINCT FROM 'ACCEPTED'
    WHEN p_snapshot IS NOT NULL AND p_artifact IS NULL THEN "waiver_rankeyeq_results_snapshot_state"(p_snapshot) IS NOT DISTINCT FROM 'ACCEPTED'
    ELSE false
  END
$$;

-- Contest result: bind exactly one ACCEPTED source of its week by checksum.
CREATE OR REPLACE FUNCTION "waiver_contest_result_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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

  -- Exactly one verified source: an SNG artifact, or a RankEyeQ final-week-stats snapshot.
  IF NEW."artifactRowId" IS NOT NULL AND NEW."rankEyeQSnapshotId" IS NULL THEN
    PERFORM 1 FROM "WaiverCanonicalArtifact" a
    WHERE a."id" = NEW."artifactRowId" AND a."weekId" = NEW."weekId" AND a."contentChecksum" = NEW."artifactContentChecksum";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a contest result must bind an artifact of its week by checksum';
    END IF;
    IF "waiver_canonical_artifact_state"(NEW."artifactRowId") IS DISTINCT FROM 'ACCEPTED' THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a contest result requires an ACCEPTED canonical artifact';
    END IF;
  ELSIF NEW."rankEyeQSnapshotId" IS NOT NULL AND NEW."artifactRowId" IS NULL THEN
    PERFORM 1 FROM "WaiverRankEyeQResultsSnapshot" s
    WHERE s."id" = NEW."rankEyeQSnapshotId" AND s."weekId" = NEW."weekId" AND s."contentChecksum" = NEW."artifactContentChecksum";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a contest result must bind a RankEyeQ results snapshot of its week by checksum';
    END IF;
    IF "waiver_rankeyeq_results_snapshot_state"(NEW."rankEyeQSnapshotId") IS DISTINCT FROM 'ACCEPTED' THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a contest result requires an ACCEPTED RankEyeQ results snapshot';
    END IF;
  ELSE
    RAISE EXCEPTION 'WAIVER_INVALID: a contest result must bind exactly one source (SNG artifact or RankEyeQ results snapshot)';
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

-- Pool result: NULL-safe D3 artifact comparison (a RankEyeQ result has no artifact, so no D3 resolution can apply).
CREATE OR REPLACE FUNCTION "waiver_pool_result_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
       OR v_resolution."artifactRowId" IS DISTINCT FROM v_result."artifactRowId"
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

-- Grade run: bind exactly one ACCEPTED source of its week by checksum; its results share that source.
CREATE OR REPLACE FUNCTION "waiver_grade_run_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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

  -- Exactly one verified source: an SNG artifact, or a RankEyeQ final-week-stats snapshot.
  IF NEW."artifactRowId" IS NOT NULL AND NEW."rankEyeQSnapshotId" IS NULL THEN
    PERFORM 1 FROM "WaiverCanonicalArtifact" a
    WHERE a."id" = NEW."artifactRowId" AND a."weekId" = NEW."weekId" AND a."contentChecksum" = NEW."artifactContentChecksum";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a grade run must bind an artifact of its week by checksum';
    END IF;
    IF "waiver_canonical_artifact_state"(NEW."artifactRowId") IS DISTINCT FROM 'ACCEPTED' THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a grade run requires an ACCEPTED canonical artifact';
    END IF;
  ELSIF NEW."rankEyeQSnapshotId" IS NOT NULL AND NEW."artifactRowId" IS NULL THEN
    PERFORM 1 FROM "WaiverRankEyeQResultsSnapshot" s
    WHERE s."id" = NEW."rankEyeQSnapshotId" AND s."weekId" = NEW."weekId" AND s."contentChecksum" = NEW."artifactContentChecksum";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a grade run must bind a RankEyeQ results snapshot of its week by checksum';
    END IF;
    IF "waiver_rankeyeq_results_snapshot_state"(NEW."rankEyeQSnapshotId") IS DISTINCT FROM 'ACCEPTED' THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a grade run requires an ACCEPTED RankEyeQ results snapshot';
    END IF;
  ELSE
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run must bind exactly one source (SNG artifact or RankEyeQ results snapshot)';
  END IF;

  v_results := array_remove(
    ARRAY[NEW."qbContestResultId", NEW."rbContestResultId", NEW."wrContestResultId", NEW."teContestResultId", NEW."defContestResultId"], NULL);
  IF (
    SELECT count(*) FROM "WaiverContestResult" r
    JOIN unnest(ARRAY[NEW."qbContestResultId", NEW."rbContestResultId", NEW."wrContestResultId", NEW."teContestResultId", NEW."defContestResultId"],
                ARRAY['QB', 'RB', 'WR', 'TE', 'DEF']) AS x(result_id, position) ON x.result_id = r."id"
    WHERE r."weekId" = NEW."weekId" AND r."position"::text = x.position AND r."artifactRowId" IS NOT DISTINCT FROM NEW."artifactRowId"
      AND r."rankEyeQSnapshotId" IS NOT DISTINCT FROM NEW."rankEyeQSnapshotId"
  ) <> cardinality(v_results) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grade run needs one contest result of its week and source for each of the five positions';
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

-- Grading approval: bind the run's exact source; RankEyeQ copies snapshot revision, checksum and builder.
CREATE OR REPLACE FUNCTION "waiver_grade_approval_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_run "WaiverGradeRun"%ROWTYPE;
  v_artifact "WaiverCanonicalArtifact"%ROWTYPE;
  v_artifact_xid bigint;
  v_snapshot "WaiverRankEyeQResultsSnapshot"%ROWTYPE;
  v_snapshot_xid bigint;
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
  IF NOT FOUND OR v_run."weekId" <> NEW."weekId" OR v_run."artifactRowId" IS DISTINCT FROM NEW."artifactRowId"
     OR v_run."rankEyeQSnapshotId" IS DISTINCT FROM NEW."rankEyeQSnapshotId"
     OR v_run."artifactContentChecksum" <> NEW."artifactContentChecksum"
     OR v_run."snapshotSetFingerprint" <> NEW."snapshotSetFingerprint"
     OR v_run."resolutionSetFingerprint" <> NEW."resolutionSetFingerprint"
     OR v_run."inputFingerprint" <> NEW."inputFingerprint" OR v_run."outputFingerprint" <> NEW."outputFingerprint"
     OR v_run."initiatedByUserId" IS DISTINCT FROM NEW."gradeRunInitiatedByUserId" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a grading approval must bind its grade run''s exact source, snapshots, D3 set and output';
  END IF;

  IF NEW."artifactRowId" IS NOT NULL AND NEW."rankEyeQSnapshotId" IS NULL THEN
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
  ELSIF NEW."rankEyeQSnapshotId" IS NOT NULL AND NEW."artifactRowId" IS NULL THEN
    -- RankEyeQ source: revision is the snapshot's, the DEF crosswalk is not applicable (rankeyeq-native/1),
    -- and the snapshot's builder is the importer equivalent.
    SELECT * INTO v_snapshot FROM "WaiverRankEyeQResultsSnapshot" s WHERE s."id" = NEW."rankEyeQSnapshotId";
    SELECT s.xmin::text::bigint INTO v_snapshot_xid FROM "WaiverRankEyeQResultsSnapshot" s WHERE s."id" = NEW."rankEyeQSnapshotId";
    IF NOT FOUND OR v_snapshot."revision" <> NEW."artifactRevision" OR v_snapshot."contentChecksum" <> NEW."artifactContentChecksum"
       OR NEW."defCrosswalkVersion" <> 'rankeyeq-native/1'
       OR v_snapshot."builtByUserId" <> NEW."artifactImportedByUserId" THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a grading approval must copy its RankEyeQ snapshot revision, checksum and builder exactly';
    END IF;
    IF v_snapshot."publicationState" IS DISTINCT FROM 'ACCEPTED' THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a grading approval requires an ACCEPTED RankEyeQ results snapshot';
    END IF;
    -- Snapshot commit and approval never share a transaction, including through a savepoint.
    IF "waiver_xmin_is_current_transaction"(v_snapshot_xid) THEN
      RAISE EXCEPTION 'WAIVER_INVALID: grading approval cannot be recorded in the RankEyeQ snapshot commit transaction';
    END IF;
  ELSE
    RAISE EXCEPTION 'WAIVER_INVALID: a grading approval must bind exactly one source (SNG artifact or RankEyeQ results snapshot)';
  END IF;
  IF NEW."approvalPolicy" = 'SINGLE_ADMIN_EXPLICIT' AND EXISTS (
    SELECT 1 FROM "WaiverGradeApproval" x WHERE x."weekId" = NEW."weekId" AND x."approvalPolicy" = 'SEPARATE_APPROVER'
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a week approved under SEPARATE_APPROVER cannot be downgraded to SINGLE_ADMIN_EXPLICIT';
  END IF;
  RETURN NEW;
END;
$$;

-- Authority change: the run's source must be ACCEPTED.
CREATE OR REPLACE FUNCTION "waiver_grade_authority_change_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NOT "waiver_grading_source_accepted"(v_run."artifactRowId", v_run."rankEyeQSnapshotId") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: grading authority requires an ACCEPTED source (SNG artifact or RankEyeQ results snapshot)';
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

-- Authority pointers: a contest pointer names the run's result and mirrors its source.
CREATE OR REPLACE FUNCTION "waiver_grade_authority_pointer_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
      AND r."artifactRowId" IS NOT DISTINCT FROM NEW."artifactRowId"
      AND r."rankEyeQSnapshotId" IS NOT DISTINCT FROM NEW."rankEyeQSnapshotId"
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

-- Publication: the run's source must still be ACCEPTED.
CREATE OR REPLACE FUNCTION "waiver_week_grade_publication_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NOT "waiver_grading_source_accepted"(v_run."artifactRowId", v_run."rankEyeQSnapshotId") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: publication requires an ACCEPTED source (SNG artifact or RankEyeQ results snapshot)';
  END IF;
  RETURN NEW;
END;
$$;

