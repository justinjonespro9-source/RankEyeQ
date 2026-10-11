-- Stage 4B.4: full-board honors (PERFECT_PODIUM / PERFECT_FIVE) are earned on
-- the scoreable slots of the contest result, not on the configured result
-- field. Accuracy scoring keeps the configured field (3, or 5 for WR) and no
-- constraint, table, column or row changes.
--
-- Scoreable slots S = least(effective available slots, eligible pool size -
-- eligible pool members whose treatment is NEUTRALIZED). Only a cancelled or
-- moved game (D2) or a D3 NEUTRALIZED resolution reduces S; a DNP
-- (NON_PARTICIPANT_ZERO) or a zero/negative fantasy total never does.
--
-- A SCORED board earns the full-board honor of its result field only when no
-- call is neutralized, every submitted call is scoreable and exact (in its
-- original slot, rank = slot), and the exact calls fill all S > 0 slots.
-- Otherwise a SCORED board whose scoreable calls are all exact earns
-- PERFECT_CALL; every other board earns no honor. Where the eligible pool fills
-- the result field and no eligible member is neutralized, S equals the result
-- field and the outcome is unchanged; a smaller effective board now earns the
-- small-pool honor of Decision 4 (docs/waivers-grading-decisions.md).
--
-- S depends on the contest result's pool rows, which may be written in the
-- same transaction as the board grade, so the full-board choice is settled in
-- the COMMIT-time board check (every pool row is visible there, and the pool
-- guard refuses pool rows after the contest result's completeness pass).

CREATE OR REPLACE FUNCTION "waiver_board_grade_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_run "WaiverGradeRun"%ROWTYPE;
  v_result "WaiverContestResult"%ROWTYPE;
  v_honor_ok boolean;
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

  -- No honor unless SCORED with every scoreable call exact; then PERFECT_CALL or
  -- the result field's full-board honor (chosen at COMMIT on the scoreable slots).
  IF NEW."resultKind" <> 'SCORED' OR NEW."scoreableCallCount" = 0 OR NEW."exactCallCount" <> NEW."scoreableCallCount" THEN
    v_honor_ok := NEW."awardedHonor" IS NULL;
  ELSE
    v_honor_ok := NEW."awardedHonor"::text IN ('PERFECT_CALL',
      CASE v_result."resultFieldSize" WHEN 3 THEN 'PERFECT_PODIUM' WHEN 5 THEN 'PERFECT_FIVE' END);
  END IF;
  IF v_honor_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'WAIVER_INVALID: awarded honor must follow the Waiver honor rules';
  END IF;
  RETURN NEW;
END;
$$;

-- Checked at COMMIT: a board grade's call grades add up to its totals, and its
-- honor follows the scoreable-slot full-board rule.
CREATE OR REPLACE FUNCTION "waiver_board_grade_complete_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
  v_board "WaiverBoardGrade"%ROWTYPE;
  v_result "WaiverContestResult"%ROWTYPE;
  v_calls int;
  v_neutralized int;
  v_invalidated int;
  v_exact int;
  v_earned int;
  v_max int;
  v_fp int;
  v_max_slot int;
  v_neutralized_members int;
  v_scoreable_slots int;
  v_expected_honor text;
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

  SELECT * INTO v_result FROM "WaiverContestResult" r WHERE r."id" = v_board."contestResultId";
  SELECT count(*) INTO v_neutralized_members FROM "WaiverPoolResult" p
  WHERE p."contestResultId" = v_result."id" AND p."category" = 'ELIGIBLE_POOL_MEMBER' AND p."treatment" = 'NEUTRALIZED';
  v_scoreable_slots := greatest(least(v_result."effectiveAvailableSlots", v_result."eligiblePoolSize" - v_neutralized_members), 0);
  v_expected_honor := CASE
    WHEN v_board."resultKind" <> 'SCORED' OR v_board."scoreableCallCount" = 0
         OR v_board."exactCallCount" <> v_board."scoreableCallCount" THEN NULL
    WHEN v_board."neutralizedCallCount" = 0 AND v_board."exactCallCount" = v_board."submittedCallCount"
         AND v_scoreable_slots > 0 AND v_board."exactCallCount" = v_scoreable_slots THEN
      CASE v_result."resultFieldSize" WHEN 3 THEN 'PERFECT_PODIUM' WHEN 5 THEN 'PERFECT_FIVE' END
    ELSE 'PERFECT_CALL' END;
  IF v_board."awardedHonor"::text IS DISTINCT FROM v_expected_honor THEN
    RAISE EXCEPTION 'WAIVER_INVALID: awarded honor must follow the Waiver honor rules';
  END IF;
  RETURN NULL;
END;
$$;
