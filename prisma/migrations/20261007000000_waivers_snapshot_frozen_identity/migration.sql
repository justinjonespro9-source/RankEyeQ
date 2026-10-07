-- Waivers Stage 4B.1: frozen canonical identity key on snapshot entries.
-- Additive only. Existing rows keep NULL identity (frozen before this stage;
-- never backfilled). Every entry inserted from now on must record the
-- provider/externalId of its RankableEntry at insertion, and the existing
-- UPDATE rejection keeps both columns immutable.

ALTER TABLE "WaiverSnapshotEntry" ADD COLUMN "identityProviderAtFreeze" TEXT;
ALTER TABLE "WaiverSnapshotEntry" ADD COLUMN "identityExternalIdAtFreeze" TEXT;

ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_frozen_identity_check" CHECK (
  ("identityProviderAtFreeze" IS NULL) = ("identityExternalIdAtFreeze" IS NULL)
);

-- Same UPDATE/DELETE/FROZEN-header rules as 20261002000000; INSERT additionally
-- requires the frozen identity to equal the referenced RankableEntry. FOR KEY
-- SHARE holds that identity until commit (an identity UPDATE takes FOR UPDATE
-- because (provider, externalId) is unique), so it cannot drift before the
-- snapshot is visible.
CREATE OR REPLACE FUNCTION "waiver_snapshot_entry_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW."identityProviderAtFreeze" IS NULL OR NEW."identityExternalIdAtFreeze" IS NULL THEN
    RAISE EXCEPTION 'WAIVER_INVALID: a new Waiver snapshot entry must record its frozen identity';
  END IF;
  PERFORM 1 FROM "RankableEntry" r
    WHERE r."id" = NEW."rankableEntryId"
      AND r."provider" = NEW."identityProviderAtFreeze"
      AND r."externalId" = NEW."identityExternalIdAtFreeze"
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAIVER_INVALID: frozen identity must equal the referenced RankableEntry identity';
  END IF;
  RETURN NEW;
END;
$$;
