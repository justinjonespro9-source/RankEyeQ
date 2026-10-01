import type {
  SngEventDisposition,
  SngParticipantDisposition,
  SngParticipantKind,
  SngParticipationProof,
  SngParticipationState,
  SngPosition,
} from "@/lib/waivers/canonical/contract";

/** Shapes of `sng-canonical-nfl-weekly-performance/1` that RankEyeQ consumes. */

export type SngEvidence = { label: string; reference: string; checksum: string; observedAt: string };

export type SngIdentity = { provider: string; externalId: string; evidence: SngEvidence };

export type SngParticipant = {
  participantId: string;
  kind: SngParticipantKind;
  position: SngPosition;
  eventKey: string | null;
  teamKey: string;
  state: SngParticipationState;
  disposition: SngParticipantDisposition;
  participationProof: SngParticipationProof;
  channelsReviewed: string[];
  sourcePosition: string;
  eligibilityEvidence: SngEvidence;
  evidence: SngEvidence | null;
  identities: SngIdentity[];
};

export type SngLedgerRow = SngParticipant & { pointsHundredths: number | null; competitionRank: number | null };

export type SngManifestEvent = {
  key: string;
  homeTeamKey: string;
  awayTeamKey: string;
  disposition: SngEventDisposition;
  finalityEvidence: SngEvidence;
  playerParticipantIds: string[];
  defenseParticipantIds: string[];
  pointsAllowedEvidence: Array<{ participantId: string; pointsAllowed: number; evidence: SngEvidence }>;
};

export type SngManifest = {
  contractVersion: string;
  league: string;
  season: number;
  seasonType: string;
  week: number;
  positionPolicyVersion: string;
  scheduleEvidence: SngEvidence;
  populationEvidence: SngEvidence;
  scope: string;
  channelsReviewed: string[];
  events: SngManifestEvent[];
  participants: SngParticipant[];
  sources: SngEvidence[];
  consumerContract: { playerProvider: string; defenseProvider: string; evidence: SngEvidence };
};

export type SngResultEntry = {
  resultKey: string;
  participantId: string;
  participantKind: SngParticipantKind;
  canonicalName: string;
  externalIdentities: SngIdentity[];
  canonicalPosition: SngPosition;
  teamKey: string;
  eventKey: string;
  opponentTeamKey: string;
  participationState: SngParticipationState;
  sourceFinality: string;
  pointsHundredths: number;
  competitionRank: number;
  tieGroupKey: string;
  tieGroupSize: number;
  displayOrdinal: number;
  derivedPerformanceId: string;
  resultFingerprint: string;
  inputSnapshotId: string;
  inputChecksum: string;
  sourceRevisionFingerprint: string;
  eligibilityEvidence: SngParticipant;
  performanceEvidence: Record<string, unknown>;
};

export type SngResultSet = {
  resultSetId: string;
  positionCode: SngPosition;
  eligibilityPolicyVersion: string;
  resultSetChecksum: string;
  exportedRowsChecksum: string;
  fieldSize: number;
  finality: string;
  sourceComplete: boolean;
  readinessEvidenceChecksum: string;
  entries: SngResultEntry[];
};

export type SngCanonicalArtifact = {
  schemaVersion: string;
  serializationVersion: string;
  artifactId: string;
  seriesKey: string;
  revision: number;
  supersedesArtifactId: string | null;
  generatedAt: string;
  contentChecksumAlgorithm: string;
  contentChecksum: string;
  payload: {
    week: { league: string; season: number; seasonType: string; week: number };
    ruleset: {
      status: string;
      code: string;
      version: number;
      definition: Record<string, unknown>;
      definitionChecksum: string;
      minimumEngineVersion: string;
    };
    engine: { version: string; positionPolicyVersion: string };
    run: {
      scoringRunId: string;
      mode: string;
      status: string;
      runFingerprint: string;
      inputSetChecksum: string;
      sourceRevisionFingerprint: string;
    };
    acceptance: {
      id: string;
      seriesKey: string;
      revision: number;
      supersedesId: string | null;
      acceptedById: string;
      acceptedAt: string;
      reason: string;
      manifestChecksum: string;
      status: string;
      readinessPolicyVersion: string;
      readinessEvidenceChecksum: string;
    };
    coverage: {
      manifest: SngManifest;
      readiness: { ready: boolean; blockers: unknown[]; evidenceChecksum: string } & Record<string, unknown>;
    };
    events: unknown[];
    sources: unknown[];
    participationLedger: SngLedgerRow[];
    resultSets: SngResultSet[];
  };
};
