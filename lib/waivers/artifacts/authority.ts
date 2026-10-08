/**
 * How RankEyeQ establishes that SNG published an artifact as ACCEPTED.
 *
 * The SNG consumer contract (checkpoint 0b119c9d) carries no publication
 * signature or receipt. `contentChecksum` is an unkeyed SHA-256 any producer
 * can compute: it proves the bytes are unaltered, never who authored or
 * published them. `payload.acceptance` is metadata inside the bytes; the live
 * publication state exists only on SNG's authenticated download surface
 * (`X-SNG-Publication-State`) and UI, which RankEyeQ cannot verify after the
 * fact. Every authority input therefore reaches RankEyeQ through the importing
 * operator.
 *
 * OPERATOR_ATTESTED (product-approved for V1) is a deliberate operator-trust
 * model: an authenticated admin attests to what SNG's authenticated surface
 * showed, and every artifact field is verified against the bytes by the 4A
 * verifier. UNVERIFIABLE blocks all imports and remains the kill switch.
 */
export const WAIVER_ARTIFACT_AUTHORITY_MODES = ["UNVERIFIABLE", "OPERATOR_ATTESTED"] as const;
export type WaiverArtifactAuthorityMode = (typeof WAIVER_ARTIFACT_AUTHORITY_MODES)[number];

export const WAIVER_ARTIFACT_PUBLICATION_AUTHORITY: WaiverArtifactAuthorityMode = "OPERATOR_ATTESTED";

/** Recorded on each imported artifact (the database accepts only this basis). */
export const WAIVER_ARTIFACT_AUTHORITY_BASIS = "OPERATOR_ATTESTED";

/** Shown wherever an imported artifact or its authority is displayed. */
export const WAIVER_ARTIFACT_AUTHORITY_LABEL = "Operator verified — SNG publication not independently authenticated";

export const WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION = "rankeyeq-sng-artifact-import-attestation/1";
export const WAIVER_ARTIFACT_IMPORT_ATTESTATION_TEXT =
  "As an authenticated RankEyeQ administrator, I verified this exact artifact against SNG's authenticated publication/download surface: " +
  "SNG showed it as ACCEPTED, and I entered the SHA-256 digest, artifact ID, revision, acceptance ID, acceptance time and source reference " +
  "exactly as SNG displayed them. I understand the checksum proves the content is unaltered, not who authored or published it.";

export const WAIVER_ARTIFACT_WITHDRAWAL_ATTESTATION_VERSION = "rankeyeq-sng-artifact-withdrawal-attestation/1";
export const WAIVER_ARTIFACT_WITHDRAWAL_ATTESTATION_TEXT =
  "As an authenticated RankEyeQ administrator, I verified on SNG's authenticated publication surface, at the time entered, that SNG " +
  "withdrew or discredited this artifact. Recording it appends history only; it restores, deletes and re-grades nothing.";
