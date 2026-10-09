-- CreateEnum
CREATE TYPE "WaiverAiLateEntryBasis" AS ENUM ('DATABASE_RECORDED_PRE_LOCK', 'PROVIDER_ARTIFACT', 'OPERATOR_ATTESTED');

-- CreateEnum
CREATE TYPE "WaiverAiLateEntryTimestampMethod" AS ENUM ('DATABASE_CLOCK', 'PROVIDER_MESSAGE', 'ADMIN_READ_FROM_ARTIFACT', 'ADMIN_STATED');

-- CreateEnum
CREATE TYPE "WaiverAiPromptEquivalence" AS ENUM ('VERIFIED', 'UNKNOWN', 'DIFFERENT');

-- AlterTable
ALTER TABLE "WaiverAiResponse" ALTER COLUMN "promptVersion" DROP NOT NULL,
ALTER COLUMN "promptSha256" DROP NOT NULL;

-- CreateTable
CREATE TABLE "WaiverAiLateEntryVerification" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "contestId" TEXT NOT NULL,
    "position" "ContestPosition" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "responseSha256" TEXT NOT NULL,
    "basis" "WaiverAiLateEntryBasis" NOT NULL,
    "timestampMethod" "WaiverAiLateEntryTimestampMethod" NOT NULL,
    "originalPredictionAt" TIMESTAMP(3),
    "sourceReference" TEXT NOT NULL,
    "sourceArtifact" BYTEA,
    "sourceArtifactName" TEXT,
    "sourceArtifactSha256" TEXT,
    "sourceArtifactByteLength" INTEGER,
    "artifactContainsResponse" BOOLEAN,
    "originalPromptVersion" TEXT,
    "originalPromptReference" TEXT,
    "originalPromptText" TEXT,
    "originalPromptSha256" TEXT,
    "promptEquivalence" "WaiverAiPromptEquivalence" NOT NULL,
    "canonicalPromptVersion" TEXT NOT NULL,
    "canonicalPromptSha256" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL,
    "boardFingerprint" TEXT NOT NULL,
    "attestation" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "ineligibleReason" TEXT,
    "verifiedByUserId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverAiLateEntryVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverAiLateEntryApproval" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "universalProfileId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "responseSha256" TEXT NOT NULL,
    "boardFingerprint" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL,
    "submissionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "confirmation" TEXT NOT NULL,
    "note" TEXT,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverAiLateEntryApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaiverAiLateEntryVerification_contestId_universalProfileId_idx" ON "WaiverAiLateEntryVerification"("contestId", "universalProfileId");

-- CreateIndex
CREATE INDEX "WaiverAiLateEntryVerification_snapshotId_idx" ON "WaiverAiLateEntryVerification"("snapshotId");

-- CreateIndex
CREATE INDEX "WaiverAiLateEntryVerification_universalProfileId_idx" ON "WaiverAiLateEntryVerification"("universalProfileId");

-- CreateIndex
CREATE INDEX "WaiverAiLateEntryVerification_verifiedByUserId_idx" ON "WaiverAiLateEntryVerification"("verifiedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiLateEntryVerification_evidenceId_sequence_key" ON "WaiverAiLateEntryVerification"("evidenceId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiLateEntryApproval_verificationId_key" ON "WaiverAiLateEntryApproval"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiLateEntryApproval_submissionId_key" ON "WaiverAiLateEntryApproval"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiLateEntryApproval_revisionId_key" ON "WaiverAiLateEntryApproval"("revisionId");

-- CreateIndex
CREATE INDEX "WaiverAiLateEntryApproval_evidenceId_idx" ON "WaiverAiLateEntryApproval"("evidenceId");

-- CreateIndex
CREATE INDEX "WaiverAiLateEntryApproval_snapshotId_idx" ON "WaiverAiLateEntryApproval"("snapshotId");

-- CreateIndex
CREATE INDEX "WaiverAiLateEntryApproval_universalProfileId_idx" ON "WaiverAiLateEntryApproval"("universalProfileId");

-- CreateIndex
CREATE INDEX "WaiverAiLateEntryApproval_approvedByUserId_idx" ON "WaiverAiLateEntryApproval"("approvedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverAiLateEntryApproval_contestId_universalProfileId_key" ON "WaiverAiLateEntryApproval"("contestId", "universalProfileId");

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "WaiverAiHistoricalEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "WaiverAiLateEntryVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "WaiverAiHistoricalEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "WaiverContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WaiverSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_universalProfileId_fkey" FOREIGN KEY ("universalProfileId") REFERENCES "UniversalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WaiverSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "WaiverSubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: controlled administrative late entry (Stage 4B.3B).
--
-- An AI WaiverEyeQ prediction may enter competition after the lock only
-- through an explicit, evidenced, separately approved claim:
--   * WaiverAiLateEntryVerification (append-only) reviews one historical-
--     evidence record. The database derives the original time, its method
--     and `eligible`: the time is the evidence's own recordedAt, or the
--     provider timestamp of an assistant message in the stored provider file
--     that holds the exact response (found by the database in the file
--     bytes; an admin-entered time is never competitive, nor is operator
--     attestation alone); it precedes the lock and follows the pinned
--     snapshot's freeze; the evidence is on the pinned snapshot; its latest
--     review is TEXT_CONFIRMED; and no other unrejected response exists for
--     the same AI and contest. It also records the prompt the AI actually
--     answered, as known, and derives whether that is the canonical prompt
--     (VERIFIED only from byte-identical preserved prompt text);
--   * WaiverAiLateEntryApproval (immutable, one per AI profile per contest)
--     approves the latest eligible verification in a later transaction,
--     after the lock, before any grade run of the week (serialized with
--     grading by the week advisory lock), while the AI has no board. It names
--     the board and revision ids it creates and must be inserted first;
--   * the existing lock guards admit post-lock writes only for exactly the
--     board, revision, calls and AI response named by an approval inserted
--     by the current transaction. An approval from any earlier transaction
--     authorizes nothing, so approvals cannot be replayed;
--   * checked at COMMIT: the approval's board exists LOCKED with that single
--     revision as current and locked revision, submittedAt = lockedAt =
--     createdAt = the approval's database time, calls whose recomputed
--     fingerprint equals the approved parse, and the verbatim response, which
--     names the canonical prompt only when equivalence is VERIFIED;
--   * an AI response may omit its prompt only on such an approved late entry.
-- No lock time, revision timestamp, existing revision, call or lock stamp is
-- changed; every other write at or after locksAt is refused exactly as
-- before. There is no session flag or setting that disables a lock check.
-- ---------------------------------------------------------------------------

ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_shape_check" CHECK (
  "sequence" >= 1 AND "callCount" >= 0
  AND "responseSha256" ~ '^[a-f0-9]{64}$' AND "boardFingerprint" ~ '^[a-f0-9]{64}$'
  AND "canonicalPromptVersion" ~ '^WAIVEREYEQ_AI_V[1-9][0-9]*$' AND "canonicalPromptSha256" ~ '^[a-f0-9]{64}$'
  AND length(btrim("parserVersion")) > 0
  AND length(btrim("sourceReference")) BETWEEN 1 AND 500
  AND length(btrim("attestation")) BETWEEN 1 AND 2000
  AND "eligible" = ("ineligibleReason" IS NULL)
);
ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_basis_check" CHECK (
  ("basis" = 'DATABASE_RECORDED_PRE_LOCK' AND "timestampMethod" = 'DATABASE_CLOCK' AND "originalPredictionAt" IS NOT NULL)
  OR ("basis" = 'PROVIDER_ARTIFACT' AND "sourceArtifact" IS NOT NULL
    AND ("timestampMethod" = 'ADMIN_READ_FROM_ARTIFACT' OR ("timestampMethod" = 'PROVIDER_MESSAGE' AND "originalPredictionAt" IS NOT NULL)))
  OR ("basis" = 'OPERATOR_ATTESTED' AND "timestampMethod" = 'ADMIN_STATED')
);
ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_prompt_check" CHECK (
  ("originalPromptVersion" IS NULL OR length(btrim("originalPromptVersion")) BETWEEN 1 AND 100)
  AND ("originalPromptReference" IS NULL OR length(btrim("originalPromptReference")) BETWEEN 1 AND 500)
  AND (("originalPromptText" IS NULL AND "originalPromptSha256" IS NULL)
    OR ("originalPromptText" IS NOT NULL AND octet_length("originalPromptText") BETWEEN 1 AND 65536
      AND "originalPromptSha256" = encode(sha256(convert_to("originalPromptText", 'UTF8')), 'hex')))
  AND ("promptEquivalence" = 'VERIFIED') = ("originalPromptSha256" IS NOT NULL AND "originalPromptSha256" = "canonicalPromptSha256")
  AND ("promptEquivalence" <> 'VERIFIED' OR "originalPromptVersion" = "canonicalPromptVersion")
  AND ("promptEquivalence" = 'VERIFIED' OR "originalPromptVersion" IS DISTINCT FROM "canonicalPromptVersion")
);
ALTER TABLE "WaiverAiLateEntryVerification" ADD CONSTRAINT "WaiverAiLateEntryVerification_artifact_check" CHECK (
  ("sourceArtifact" IS NULL AND "sourceArtifactName" IS NULL AND "sourceArtifactSha256" IS NULL
    AND "sourceArtifactByteLength" IS NULL AND "artifactContainsResponse" IS NULL)
  OR ("sourceArtifact" IS NOT NULL AND "artifactContainsResponse" IS NOT NULL
    AND "sourceArtifactByteLength" = octet_length("sourceArtifact") AND "sourceArtifactByteLength" BETWEEN 1 AND 524288
    AND "sourceArtifactSha256" = encode(sha256("sourceArtifact"), 'hex')
    AND length(btrim("sourceArtifactName")) BETWEEN 1 AND 255)
);
ALTER TABLE "WaiverAiLateEntryApproval" ADD CONSTRAINT "WaiverAiLateEntryApproval_shape_check" CHECK (
  "callCount" >= 0
  AND "responseSha256" ~ '^[a-f0-9]{64}$' AND "boardFingerprint" ~ '^[a-f0-9]{64}$'
  AND "confirmation" = left("responseSha256", 12)
  AND "submissionId" <> "revisionId"
  AND ("note" IS NULL OR length(btrim("note")) BETWEEN 1 AND 2000)
);

-- The approval naming this board, when inserted by the current transaction
-- (or one of its subtransactions). Committed approvals return nothing.
CREATE FUNCTION "waiver_ai_late_entry_in_transaction"(p_submission text)
RETURNS SETOF "WaiverAiLateEntryApproval" LANGUAGE sql VOLATILE AS $$
  SELECT a.* FROM "WaiverAiLateEntryApproval" a
  WHERE a."submissionId" = p_submission AND "waiver_xmin_is_current_transaction"(a.xmin::text::bigint)
$$;

CREATE FUNCTION "waiver_ai_evidence_latest_review"(p_evidence text) RETURNS "WaiverAiEvidenceReviewStatus" LANGUAGE sql STABLE AS $$
  SELECT r."status" FROM "WaiverAiHistoricalEvidenceReview" r
  WHERE r."evidenceId" = p_evidence ORDER BY r."sequence" DESC LIMIT 1
$$;

-- Another response for the same AI and contest that has not been rejected.
CREATE FUNCTION "waiver_ai_late_entry_ambiguous"(p_contest text, p_profile text, p_sha text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "WaiverAiHistoricalEvidence" e
    WHERE e."contestId" = p_contest AND e."universalProfileId" = p_profile AND e."responseSha256" <> p_sha
      AND "waiver_ai_evidence_latest_review"(e."id") IS DISTINCT FROM 'REJECTED'
  )
$$;

-- Recomputes lib/waivers/fingerprint.ts from a revision's stored calls.
CREATE FUNCTION "waiver_revision_call_fingerprint"(p_revision text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(
    '{"v":1,"contestId":' || to_json(s."contestId")::text
    || ',"snapshotId":' || to_json(r."snapshotId")::text
    || ',"calls":[' || coalesce((
      SELECT string_agg(to_json(e."rankableEntryId")::text, ',' ORDER BY w."slot")
      FROM "WaiverCall" w JOIN "WaiverSnapshotEntry" e ON e."id" = w."snapshotEntryId"
      WHERE w."revisionId" = r."id"
    ), '') || ']}', 'UTF8')), 'hex')
  FROM "WaiverSubmissionRevision" r JOIN "WaiverSubmission" s ON s."id" = r."submissionId"
  WHERE r."id" = p_revision
$$;

-- Provider files are read by the database from their stored bytes, never from
-- what the application reports. Mirrors lib/waivers/ai/provider-artifact.ts.
CREATE FUNCTION "waiver_ai_artifact_text"(p_bytes bytea) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_text text;
BEGIN
  v_text := convert_from(p_bytes, 'UTF8');
  IF left(v_text, 1) = chr(65279) THEN
    v_text := substr(v_text, 2);
  END IF;
  RETURN v_text;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE FUNCTION "waiver_ai_artifact_document"(p_bytes bytea) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN "waiver_ai_artifact_text"(p_bytes)::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- The exact response appears in a JSON string value (JSON files) or in the decoded text (other files).
CREATE FUNCTION "waiver_ai_artifact_contains"(p_bytes bytea, p_response text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_text text := "waiver_ai_artifact_text"(p_bytes);
  v_doc jsonb;
BEGIN
  IF v_text IS NULL THEN
    RETURN false;
  END IF;
  v_doc := "waiver_ai_artifact_document"(p_bytes);
  IF v_doc IS NULL THEN
    RETURN strpos(v_text, p_response) > 0;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM jsonb_path_query(v_doc, 'strict $.**') s
    WHERE jsonb_typeof(s) = 'string' AND strpos(s #>> '{}', p_response) > 0
  );
END;
$$;

-- A provider timestamp: epoch seconds or milliseconds, or ISO-8601 with an explicit zone.
CREATE FUNCTION "waiver_ai_provider_time"(p_value jsonb) RETURNS timestamp LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_number numeric;
  v_text text;
BEGIN
  IF jsonb_typeof(p_value) = 'number' THEN
    v_number := (p_value #>> '{}')::numeric;
    IF v_number <= 0 THEN
      RETURN NULL;
    END IF;
    IF v_number > 1e12 THEN
      v_number := v_number / 1000;
    END IF;
    RETURN to_timestamp(v_number::double precision) AT TIME ZONE 'UTC';
  END IF;
  IF jsonb_typeof(p_value) = 'string' THEN
    v_text := p_value #>> '{}';
    IF v_text ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$' THEN
      RETURN v_text::timestamptz AT TIME ZONE 'UTC';
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- The earliest provider timestamp carried by an assistant-attributed JSON
-- message object that itself holds the exact response. A time anywhere else
-- in the file (conversation, export, user message) never counts.
CREATE FUNCTION "waiver_ai_artifact_message_time"(p_bytes bytea, p_response text) RETURNS timestamp LANGUAGE sql IMMUTABLE AS $$
  SELECT min(t.at) FROM (
    SELECT coalesce(
      "waiver_ai_provider_time"(m -> 'create_time'),
      "waiver_ai_provider_time"(m -> 'created_at'),
      "waiver_ai_provider_time"(m -> 'createdAt'),
      "waiver_ai_provider_time"(m -> 'timestamp')
    ) AS at
    FROM jsonb_path_query("waiver_ai_artifact_document"(p_bytes), 'strict $.**') m
    WHERE jsonb_typeof(m) = 'object'
      AND (m ->> 'role' = 'assistant' OR m ->> 'sender' = 'assistant' OR m #>> '{author,role}' = 'assistant')
      AND EXISTS (
        SELECT 1 FROM jsonb_path_query(m, 'strict $.**') s
        WHERE jsonb_typeof(s) = 'string' AND strpos(s #>> '{}', p_response) > 0
      )
  ) t
$$;

CREATE FUNCTION "waiver_ai_late_entry_verification_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_evidence "WaiverAiHistoricalEvidence"%ROWTYPE;
  v_locks timestamp;
  v_pinned text;
  v_frozen timestamp;
  v_next int;
  v_reason text;
  v_message_at timestamp;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI late-entry verifications are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI late-entry verifications cannot be deleted';
  END IF;

  NEW."verifiedAt" := "waiver_utc_now"();
  SELECT * INTO v_evidence FROM "WaiverAiHistoricalEvidence" e WHERE e."id" = NEW."evidenceId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late-entry verification must reference historical evidence';
  END IF;
  IF NEW."contestId" <> v_evidence."contestId" OR NEW."position" <> v_evidence."position"
     OR NEW."snapshotId" <> v_evidence."snapshotId" OR NEW."universalProfileId" <> v_evidence."universalProfileId"
     OR NEW."responseSha256" <> v_evidence."responseSha256" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late-entry verification must match its evidence';
  END IF;
  SELECT coalesce(max(v."sequence"), 0) + 1 INTO v_next
    FROM "WaiverAiLateEntryVerification" v WHERE v."evidenceId" = NEW."evidenceId";
  IF NEW."sequence" <> v_next THEN
    RAISE EXCEPTION 'WAIVER_INVALID: late-entry verifications must be sequential';
  END IF;
  SELECT c."locksAt", c."snapshotId", s."frozenAt" INTO v_locks, v_pinned, v_frozen
    FROM "WaiverContest" c JOIN "WaiverSnapshot" s ON s."id" = c."snapshotId"
    WHERE c."id" = NEW."contestId";

  -- Original time and its method come from the database clock or the stored
  -- provider file; an admin-entered time is kept but never competitive.
  NEW."artifactContainsResponse" := CASE WHEN NEW."sourceArtifact" IS NULL THEN NULL
    ELSE "waiver_ai_artifact_contains"(NEW."sourceArtifact", v_evidence."responseText") END;
  IF NEW."basis" = 'DATABASE_RECORDED_PRE_LOCK' THEN
    NEW."originalPredictionAt" := v_evidence."recordedAt";
    NEW."timestampMethod" := 'DATABASE_CLOCK';
  ELSIF NEW."basis" = 'PROVIDER_ARTIFACT' THEN
    v_message_at := CASE WHEN NEW."sourceArtifact" IS NULL THEN NULL
      ELSE "waiver_ai_artifact_message_time"(NEW."sourceArtifact", v_evidence."responseText")::timestamp(3) END;
    IF v_message_at IS NOT NULL THEN
      IF NEW."originalPredictionAt" IS NOT NULL AND abs(extract(epoch FROM NEW."originalPredictionAt" - v_message_at)) > 60 THEN
        RAISE EXCEPTION 'WAIVER_INVALID: the entered time conflicts with the provider message timestamp';
      END IF;
      NEW."originalPredictionAt" := v_message_at;
      NEW."timestampMethod" := 'PROVIDER_MESSAGE';
    ELSE
      NEW."timestampMethod" := 'ADMIN_READ_FROM_ARTIFACT';
    END IF;
  ELSE
    NEW."timestampMethod" := 'ADMIN_STATED';
  END IF;
  IF NEW."originalPredictionAt" > NEW."verifiedAt" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an original prediction time cannot be in the future';
  END IF;
  IF NEW."originalPredictionAt" > v_evidence."recordedAt" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an original prediction time cannot be after the evidence was recorded';
  END IF;

  -- The prompt the AI actually answered. Only byte-identical preserved prompt
  -- text establishes the canonical prompt; a label never does.
  NEW."originalPromptSha256" := CASE WHEN NEW."originalPromptText" IS NULL THEN NULL
    ELSE encode(sha256(convert_to(NEW."originalPromptText", 'UTF8')), 'hex') END;
  IF NEW."originalPromptSha256" = NEW."canonicalPromptSha256" THEN
    IF NEW."originalPromptVersion" IS NOT NULL AND NEW."originalPromptVersion" <> NEW."canonicalPromptVersion" THEN
      RAISE EXCEPTION 'WAIVER_INVALID: the preserved prompt is the canonical prompt; its stated version must be %', NEW."canonicalPromptVersion";
    END IF;
    NEW."originalPromptVersion" := NEW."canonicalPromptVersion";
    NEW."promptEquivalence" := 'VERIFIED';
  ELSE
    IF upper(btrim(NEW."originalPromptVersion")) ~ '^WAIVEREYEQ_AI_V[0-9]' THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a canonical prompt version requires the byte-identical preserved prompt text';
    END IF;
    NEW."promptEquivalence" := CASE
      WHEN NEW."originalPromptSha256" IS NOT NULL OR NEW."originalPromptVersion" IS NOT NULL THEN 'DIFFERENT'
      ELSE 'UNKNOWN'
    END;
  END IF;

  v_reason := CASE
    WHEN NEW."basis" = 'OPERATOR_ATTESTED' THEN 'OPERATOR_ATTESTED_ONLY'
    WHEN v_evidence."snapshotId" <> v_pinned THEN 'SNAPSHOT_MISMATCH'
    WHEN NEW."basis" = 'PROVIDER_ARTIFACT' AND NEW."artifactContainsResponse" IS NOT TRUE THEN 'ARTIFACT_MISSING_RESPONSE'
    WHEN NEW."basis" = 'PROVIDER_ARTIFACT' AND NEW."timestampMethod" <> 'PROVIDER_MESSAGE' THEN 'NO_PROVIDER_MESSAGE_TIME'
    WHEN NEW."originalPredictionAt" IS NULL THEN 'NO_ORIGINAL_TIME'
    WHEN NEW."originalPredictionAt" >= v_locks THEN 'NOT_BEFORE_LOCK'
    WHEN NEW."originalPredictionAt" < v_frozen THEN 'BEFORE_SNAPSHOT_FROZEN'
    WHEN "waiver_ai_evidence_latest_review"(v_evidence."id") IS DISTINCT FROM 'TEXT_CONFIRMED' THEN 'TEXT_NOT_CONFIRMED'
    WHEN "waiver_ai_late_entry_ambiguous"(NEW."contestId", NEW."universalProfileId", NEW."responseSha256") THEN 'AMBIGUOUS_RESPONSES'
  END;
  NEW."eligible" := v_reason IS NULL;
  NEW."ineligibleReason" := v_reason;
  PERFORM "waiver_require_admin"(NEW."verifiedByUserId", 'AI late-entry verifier');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverAiLateEntryVerification_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverAiLateEntryVerification"
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_late_entry_verification_guard"();

CREATE FUNCTION "waiver_ai_late_entry_approval_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ver "WaiverAiLateEntryVerification"%ROWTYPE;
  v_ver_xmin bigint;
  v_latest int;
  v_week text;
  v_locks timestamp;
  v_pinned text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI late-entry approvals are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "waiver_fixture_maintenance"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WAIVER_IMMUTABLE: AI late-entry approvals cannot be deleted';
  END IF;

  NEW."approvedAt" := "waiver_utc_now"();
  PERFORM "waiver_require_admin"(NEW."approvedByUserId", 'AI late-entry approver');

  SELECT * INTO v_ver FROM "WaiverAiLateEntryVerification" v WHERE v."id" = NEW."verificationId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late-entry approval must reference a verification';
  END IF;
  SELECT v.xmin::text::bigint INTO v_ver_xmin FROM "WaiverAiLateEntryVerification" v WHERE v."id" = NEW."verificationId";
  IF NOT v_ver."eligible" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: only an eligible late-entry verification can be approved (%)', v_ver."ineligibleReason";
  END IF;
  IF "waiver_xmin_is_current_transaction"(v_ver_xmin) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late entry is approved in a separate action from its verification';
  END IF;
  IF NEW."evidenceId" <> v_ver."evidenceId" OR NEW."contestId" <> v_ver."contestId"
     OR NEW."universalProfileId" <> v_ver."universalProfileId" OR NEW."snapshotId" <> v_ver."snapshotId"
     OR NEW."responseSha256" <> v_ver."responseSha256" OR NEW."boardFingerprint" <> v_ver."boardFingerprint"
     OR NEW."callCount" <> v_ver."callCount" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late-entry approval must match its verification exactly';
  END IF;
  SELECT max(v."sequence") INTO v_latest FROM "WaiverAiLateEntryVerification" v WHERE v."evidenceId" = v_ver."evidenceId";
  IF v_ver."sequence" <> v_latest THEN
    RAISE EXCEPTION 'WAIVER_INVALID: only the latest verification of the evidence can be approved';
  END IF;

  SELECT c."weekId", c."locksAt", c."snapshotId" INTO v_week, v_locks, v_pinned
    FROM "WaiverContest" c WHERE c."id" = NEW."contestId";
  PERFORM "waiver_grade_week_lock"(v_week);
  IF "waiver_utc_now"() < v_locks THEN
    RAISE EXCEPTION 'WAIVER_INVALID: late entry applies only after the lock; submit through the ordinary AI import';
  END IF;
  IF NEW."snapshotId" <> v_pinned THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late entry must be on the contest''s pinned snapshot';
  END IF;
  IF v_ver."originalPredictionAt" IS NULL OR v_ver."originalPredictionAt" >= v_locks THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late entry requires a verified original time before the lock';
  END IF;
  IF "waiver_ai_evidence_latest_review"(NEW."evidenceId") IS DISTINCT FROM 'TEXT_CONFIRMED' THEN
    RAISE EXCEPTION 'WAIVER_INVALID: the evidence text must be confirmed by its latest review';
  END IF;
  IF "waiver_ai_late_entry_ambiguous"(NEW."contestId", NEW."universalProfileId", NEW."responseSha256") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: another unrejected response exists for this AI and contest';
  END IF;
  PERFORM 1 FROM "UniversalProfile" p
    WHERE p."id" = NEW."universalProfileId" AND p."profileType" = 'AI' AND p."status" = 'ACTIVE' AND p."competitorActive";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late entry requires an active AI competitor profile';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverSubmission" s WHERE s."contestId" = NEW."contestId" AND s."universalProfileId" = NEW."universalProfileId") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: this AI profile already has a Waiver board for this contest';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverGradeRun" g WHERE g."weekId" = v_week) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: the week has a grade run; late entry is closed';
  END IF;
  IF EXISTS (SELECT 1 FROM "WaiverSubmission" s WHERE s."id" = NEW."submissionId")
     OR EXISTS (SELECT 1 FROM "WaiverSubmissionRevision" r WHERE r."id" = NEW."revisionId") THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late-entry approval names a new board and revision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverAiLateEntryApproval_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WaiverAiLateEntryApproval"
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_late_entry_approval_guard"();

-- Checked at COMMIT: the approval created exactly the board it names.
CREATE FUNCTION "waiver_ai_late_entry_approval_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "WaiverSubmission" s
    WHERE s."id" = NEW."submissionId" AND s."contestId" = NEW."contestId" AND s."universalProfileId" = NEW."universalProfileId"
      AND s."authority" = 'SYSTEM_OPERATED' AND s."createdByUserId" = NEW."approvedByUserId" AND s."status" = 'LOCKED'
      AND s."currentRevisionId" = NEW."revisionId" AND s."lockedRevisionId" = NEW."revisionId"
      AND s."submittedAt" = NEW."approvedAt" AND s."lockedAt" = NEW."approvedAt";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an approved late entry must create its locked board in the same transaction';
  END IF;
  PERFORM 1 FROM "WaiverSubmissionRevision" r
    WHERE r."id" = NEW."revisionId" AND r."submissionId" = NEW."submissionId" AND r."revisionNumber" = 1
      AND r."kind" = 'SUBMISSION' AND r."snapshotId" = NEW."snapshotId" AND r."callCount" = NEW."callCount"
      AND r."fingerprint" = NEW."boardFingerprint" AND r."createdAt" = NEW."approvedAt" AND r."authorUserId" = NEW."approvedByUserId";
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM "WaiverSubmissionRevision" r WHERE r."submissionId" = NEW."submissionId" AND r."id" <> NEW."revisionId"
  ) THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late-entered board holds exactly its approved revision';
  END IF;
  IF "waiver_revision_call_fingerprint"(NEW."revisionId") IS DISTINCT FROM NEW."boardFingerprint" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: late-entered calls must match the approved response';
  END IF;
  PERFORM 1 FROM "WaiverAiResponse" a
    JOIN "WaiverAiLateEntryVerification" v ON v."id" = NEW."verificationId"
    JOIN "WaiverAiHistoricalEvidence" e ON e."id" = NEW."evidenceId"
    WHERE a."revisionId" = NEW."revisionId" AND a."responseSha256" = NEW."responseSha256"
      AND a."responseText" = e."responseText" AND a."modelLabel" = e."modelLabel"
      AND a."promptVersion" IS NOT DISTINCT FROM (CASE WHEN v."promptEquivalence" = 'VERIFIED' THEN v."canonicalPromptVersion" END)
      AND a."promptSha256" IS NOT DISTINCT FROM (CASE WHEN v."promptEquivalence" = 'VERIFIED' THEN v."canonicalPromptSha256" END)
      AND a."parserVersion" = v."parserVersion" AND a."importedByUserId" = NEW."approvedByUserId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a late-entered revision carries the approved verbatim response';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "WaiverAiLateEntryApproval_board"
  AFTER INSERT ON "WaiverAiLateEntryApproval"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_late_entry_approval_check"();

CREATE TRIGGER "WaiverAiLateEntryVerification_no_truncate" BEFORE TRUNCATE ON "WaiverAiLateEntryVerification"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_ai_truncate_guard"();
CREATE TRIGGER "WaiverAiLateEntryApproval_no_truncate" BEFORE TRUNCATE ON "WaiverAiLateEntryApproval"
  FOR EACH STATEMENT EXECUTE FUNCTION "waiver_ai_truncate_guard"();

-- Every AI response names the prompt it answered, except the response of an
-- approved late entry whose original prompt is not verified canonical (its
-- exact prompt fields are then checked at COMMIT against the verification).
CREATE FUNCTION "waiver_ai_response_prompt_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_submission text;
  v_late "WaiverAiLateEntryApproval"%ROWTYPE;
BEGIN
  IF NEW."promptVersion" IS NOT NULL AND NEW."promptSha256" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT r."submissionId" INTO v_submission FROM "WaiverSubmissionRevision" r WHERE r."id" = NEW."revisionId";
  SELECT * INTO v_late FROM "waiver_ai_late_entry_in_transaction"(v_submission);
  IF NOT FOUND OR v_late."revisionId" <> NEW."revisionId" THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver response records the prompt it answered';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WaiverAiResponse_prompt_guard"
  BEFORE INSERT ON "WaiverAiResponse"
  FOR EACH ROW EXECUTE FUNCTION "waiver_ai_response_prompt_guard"();

-- ---------------------------------------------------------------------------
-- Existing lock guards, re-declared with one added branch each: a post-lock
-- write is admitted only when "waiver_ai_late_entry_in_transaction" returns
-- an approval naming exactly that board/revision. Every other line is
-- unchanged from 20261001000000 (submission, revision, call guards) and
-- 20261009000000 (AI response guard).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "waiver_submission_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_locks timestamp;
  v_now timestamp;
  v_final_submission text;
  v_current_kind "WaiverRevisionKind";
  v_current_created timestamp;
  v_current_number int;
  v_old_number int;
  v_late "WaiverAiLateEntryApproval"%ROWTYPE;
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
      SELECT * INTO v_late FROM "waiver_ai_late_entry_in_transaction"(NEW."id");
      IF NOT FOUND OR v_late."contestId" <> NEW."contestId" OR v_late."universalProfileId" <> NEW."universalProfileId"
         OR NEW."authority" <> 'SYSTEM_OPERATED' OR NEW."createdByUserId" <> v_late."approvedByUserId" THEN
        RAISE EXCEPTION 'WAIVER_LOCKED: no new Waiver boards at or after lock';
      END IF;
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
    SELECT * INTO v_late FROM "waiver_ai_late_entry_in_transaction"(OLD."id");
    IF FOUND AND OLD."status" = 'DRAFT' AND OLD."currentRevisionId" IS NULL AND OLD."lockedRevisionId" IS NULL
       AND OLD."submittedAt" IS NULL AND OLD."lockedAt" IS NULL
       AND NEW."status" = 'LOCKED' AND NEW."currentRevisionId" = v_late."revisionId"
       AND NEW."lockedRevisionId" = v_late."revisionId"
       AND NEW."submittedAt" = v_late."approvedAt" AND NEW."lockedAt" = v_late."approvedAt" THEN
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

CREATE OR REPLACE FUNCTION "waiver_revision_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_locks timestamp;
  v_pinned text;
  v_status "WaiverSubmissionStatus";
  v_next int;
  v_latest timestamp;
  v_late "WaiverAiLateEntryApproval"%ROWTYPE;
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

  SELECT * INTO v_late FROM "waiver_ai_late_entry_in_transaction"(NEW."submissionId");
  IF FOUND AND v_late."revisionId" = NEW."id" THEN
    IF NEW."kind" <> 'SUBMISSION' OR NEW."revisionNumber" <> 1 OR NEW."createdAt" <> v_late."approvedAt"
       OR NEW."snapshotId" <> v_late."snapshotId" OR NEW."callCount" <> v_late."callCount"
       OR NEW."fingerprint" <> v_late."boardFingerprint" OR NEW."authorUserId" <> v_late."approvedByUserId" THEN
      RAISE EXCEPTION 'WAIVER_INVALID: a late-entered Waiver revision must match its approval exactly';
    END IF;
  ELSIF "waiver_utc_now"() >= v_locks OR NEW."createdAt" >= v_locks THEN
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

CREATE OR REPLACE FUNCTION "waiver_call_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_locks timestamp;
  v_position "ContestPosition";
  v_max int;
  v_snapshot text;
  v_submission text;
  v_late "WaiverAiLateEntryApproval"%ROWTYPE;
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

  SELECT c."locksAt", c."position", c."maxCalls", r."snapshotId", s."id" INTO v_locks, v_position, v_max, v_snapshot, v_submission
    FROM "WaiverSubmissionRevision" r
    JOIN "WaiverSubmission" s ON s."id" = r."submissionId"
    JOIN "WaiverContest" c ON c."id" = s."contestId"
    WHERE r."id" = NEW."revisionId";

  IF "waiver_utc_now"() >= v_locks THEN
    SELECT * INTO v_late FROM "waiver_ai_late_entry_in_transaction"(v_submission);
    IF NOT FOUND OR v_late."revisionId" <> NEW."revisionId" THEN
      RAISE EXCEPTION 'WAIVER_LOCKED: no Waiver calls at or after lock';
    END IF;
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

CREATE OR REPLACE FUNCTION "waiver_ai_response_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  v_submission text;
  v_late "WaiverAiLateEntryApproval"%ROWTYPE;
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
         c."position", c."snapshotId", c."locksAt", s."id"
    INTO v_kind, v_call_count, v_revision_snapshot, v_author, v_authority, v_contest, v_profile, v_position, v_pinned, v_locks, v_submission
    FROM "WaiverSubmissionRevision" r
    JOIN "WaiverSubmission" s ON s."id" = r."submissionId"
    JOIN "WaiverContest" c ON c."id" = s."contestId"
    WHERE r."id" = NEW."revisionId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver response must reference a board revision';
  END IF;
  IF NEW."importedAt" >= v_locks THEN
    SELECT * INTO v_late FROM "waiver_ai_late_entry_in_transaction"(v_submission);
    IF NOT FOUND OR v_late."revisionId" <> NEW."revisionId" OR v_late."responseSha256" <> NEW."responseSha256" THEN
      RAISE EXCEPTION 'WAIVER_LOCKED: no AI Waiver responses at or after lock';
    END IF;
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

