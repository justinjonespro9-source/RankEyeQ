-- ---------------------------------------------------------------------------
-- Hand-written: Official Waiver Snapshot integrity backstops (no schema.prisma
-- change). The freeze and correction services are the primary authority;
-- these protect frozen ownership evidence from application bugs:
--   * CHECK constraints on basis points, versions, counts, roles, exclusions;
--   * entry and correction rows are immutable (no UPDATE; DELETE only under
--     the fixture-maintenance switch documented in the Phase 2 migration);
--   * a snapshot header may only move FROZEN -> SUPERSEDED while clearing its
--     current-week pointer, with every other column unchanged; DELETE only
--     under fixture maintenance;
--   * a new header is FROZEN and current; version 1 supersedes nothing, and
--     version n+1 directly supersedes an already-superseded version n of the
--     same week;
--   * entries may only be added to a FROZEN header, corrections only to the
--     current version that directly supersedes their source version;
--   * checked at COMMIT: header counts equal the entry rows (so evidence can
--     never be appended to a committed snapshot), and every superseded
--     version has a successor.
-- Errors use the Phase 2 prefixes WAIVER_INVALID / WAIVER_IMMUTABLE.
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverSnapshot" ADD CONSTRAINT "WaiverSnapshot_thresholdBps_check" CHECK ("thresholdBps" BETWEEN 1 AND 10000);
ALTER TABLE "WaiverSnapshot" ADD CONSTRAINT "WaiverSnapshot_version_check" CHECK ("version" >= 1);
ALTER TABLE "WaiverSnapshot" ADD CONSTRAINT "WaiverSnapshot_counts_check" CHECK (
  "candidateCount" >= 0 AND "eligibleCount" >= 0 AND "excludedCount" >= 0 AND "followUpCount" >= 0
  AND "eligibleCount" + "excludedCount" = "candidateCount"
);
ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_rosteredBps_check" CHECK ("rosteredBps" BETWEEN 0 AND 10000);
ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_inputLineNumber_check" CHECK ("inputLineNumber" >= 1);
ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_role_check" CHECK (
  ("evidenceRole" = 'FOLLOW_UP') = ("eligibility" = 'OBSERVATION_ONLY')
);
ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_exclusion_check" CHECK (
  ("eligibility" = 'EXCLUDED') = ("exclusionReason" IS NOT NULL)
);
ALTER TABLE "WaiverSnapshotCorrection" ADD CONSTRAINT "WaiverSnapshotCorrection_affected_check" CHECK ("affectedSubmissionCount" >= 0);

CREATE FUNCTION "waiver_snapshot_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_prev "WaiverSnapshot"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver snapshots cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'FROZEN' AND NEW."status" = 'SUPERSEDED'
       AND OLD."currentForWeekId" IS NOT NULL AND NEW."currentForWeekId" IS NULL
       AND (to_jsonb(NEW) - 'status' - 'currentForWeekId') = (to_jsonb(OLD) - 'status' - 'currentForWeekId') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: a Waiver snapshot may only move FROZEN -> SUPERSEDED (clearing current) with no other change';
  END IF;

  IF NEW."status" <> 'FROZEN' OR NEW."currentForWeekId" IS DISTINCT FROM NEW."weekId" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a new Waiver snapshot must be FROZEN and current for its week';
  END IF;
  IF NEW."supersedesId" IS NULL THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'WAIVER_INVALID: only version 1 may be frozen without superseding a version';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_prev FROM "WaiverSnapshot" s WHERE s."id" = NEW."supersedesId";
  IF NOT FOUND OR v_prev."weekId" <> NEW."weekId" OR NEW."version" <> v_prev."version" + 1
     OR v_prev."status" <> 'SUPERSEDED' OR v_prev."currentForWeekId" IS NOT NULL THEN
    RAISE EXCEPTION 'WAIVER_INVALID: version n+1 must directly supersede the already-superseded version n of the same week';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverSnapshot_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "waiver_snapshot_guard"();

CREATE FUNCTION "waiver_snapshot_entry_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver snapshot entries are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver snapshot entries are immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "WaiverSnapshot" s WHERE s."id" = NEW."snapshotId" AND s."status" = 'FROZEN') THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: entries may only be added to a FROZEN Waiver snapshot';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverSnapshotEntry_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverSnapshotEntry"
  FOR EACH ROW EXECUTE FUNCTION "waiver_snapshot_entry_guard"();

CREATE FUNCTION "waiver_snapshot_correction_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver snapshot corrections are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: Waiver snapshot corrections are immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "WaiverSnapshot" s
    WHERE s."id" = NEW."toSnapshotId" AND s."supersedesId" = NEW."fromSnapshotId" AND s."currentForWeekId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a correction must target the current version that directly supersedes its source';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverSnapshotCorrection_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverSnapshotCorrection"
  FOR EACH ROW EXECUTE FUNCTION "waiver_snapshot_correction_guard"();

-- Checked at COMMIT: header counts equal the snapshot's entry rows.
CREATE FUNCTION "waiver_snapshot_counts_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_snapshot text;
  v_header "WaiverSnapshot"%ROWTYPE;
  v_candidates int;
  v_eligible int;
  v_excluded int;
  v_follow_ups int;
BEGIN
  IF TG_TABLE_NAME = 'WaiverSnapshotEntry' THEN
    v_snapshot := NEW."snapshotId";
  ELSE
    v_snapshot := NEW."id";
  END IF;
  SELECT * INTO v_header FROM "WaiverSnapshot" s WHERE s."id" = v_snapshot;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT
    count(*) FILTER (WHERE e."evidenceRole" = 'CANDIDATE'),
    count(*) FILTER (WHERE e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'ELIGIBLE'),
    count(*) FILTER (WHERE e."evidenceRole" = 'CANDIDATE' AND e."eligibility" = 'EXCLUDED'),
    count(*) FILTER (WHERE e."evidenceRole" = 'FOLLOW_UP')
  INTO v_candidates, v_eligible, v_excluded, v_follow_ups
  FROM "WaiverSnapshotEntry" e WHERE e."snapshotId" = v_snapshot;
  IF v_candidates <> v_header."candidateCount" OR v_eligible <> v_header."eligibleCount"
     OR v_excluded <> v_header."excludedCount" OR v_follow_ups <> v_header."followUpCount" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: Waiver snapshot counts do not match its entries (candidates %/%, eligible %/%, excluded %/%, follow-ups %/%)',
      v_candidates, v_header."candidateCount", v_eligible, v_header."eligibleCount",
      v_excluded, v_header."excludedCount", v_follow_ups, v_header."followUpCount";
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverSnapshot_counts"
  AFTER INSERT ON "WaiverSnapshot"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_snapshot_counts_check"();

CREATE CONSTRAINT TRIGGER "WaiverSnapshotEntry_counts"
  AFTER INSERT ON "WaiverSnapshotEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_snapshot_counts_check"();

-- Checked at COMMIT: a superseded version always has its successor.
CREATE FUNCTION "waiver_snapshot_successor_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'SUPERSEDED' AND NOT EXISTS (
    SELECT 1 FROM "WaiverSnapshot" s WHERE s."supersedesId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a superseded Waiver snapshot must have a successor version';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverSnapshot_successor"
  AFTER UPDATE ON "WaiverSnapshot"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_snapshot_successor_check"();
