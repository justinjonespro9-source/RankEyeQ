import { createHash } from "node:crypto";
import {
  RANKEYEQ_PLAYER_IDENTITY_PROVIDER,
  SNG_CANONICAL_ARTIFACT_SCHEMA_VERSION,
  SNG_CANONICAL_SERIALIZATION_VERSION,
  SNG_COVERAGE_MANIFEST_CONTRACT_VERSION,
  SNG_COVERAGE_MANIFEST_SCOPE,
  SNG_DEF_POINTS_ALLOWED_POLICY,
  SNG_DEFENSE_IDENTITY_PROVIDER,
  SNG_ENGINE_VERSION,
  SNG_POSITION_POLICY_VERSION,
  SNG_POSITIONS,
  SNG_READINESS_POLICY_VERSION,
  SNG_RULESET_CODE,
  SNG_RULESET_DEFINITION_CHECKSUM,
  SNG_RULESET_VERSION,
  sngSeriesKey,
  type SngEventDisposition,
  type SngParticipantDisposition,
  type SngParticipationProof,
  type SngParticipationState,
  type SngPosition,
} from "@/lib/waivers/canonical/contract";
import { canonicalExportChecksum, canonicalExportJson } from "@/lib/waivers/canonical/serialization";

/**
 * RankEyeQ synthetic contract fixtures for `sng-canonical-nfl-weekly-performance/1`.
 * Built to the producer contract; never historical evidence. Opaque SNG
 * lineage fingerprints are deterministic placeholders.
 */

type Json = Record<string, unknown>;

export const hex = (label: string) => createHash("sha256").update(label).digest("hex");

const OBSERVED_AT = "2026-10-06T12:00:00.000Z";
const evidence = (label: string) => ({ label, reference: `fixture://synthetic/${label}`, checksum: hex(label), observedAt: OBSERVED_AT });
const ALL_CHANNELS = ["OFFENSE", "DEFENSE", "SPECIAL_TEAMS"];

export type SyntheticEventSpec = { key: string; homeTeamKey: string; awayTeamKey: string; disposition: SngEventDisposition };

export type SyntheticParticipantSpec = {
  id: string;
  position: SngPosition;
  teamKey: string;
  state?: SngParticipationState;
  disposition?: SngParticipantDisposition;
  proof?: SngParticipationProof;
  points?: number;
  /** Defaults to the event containing teamKey; null for BYE / NO_ROSTER_ASSIGNMENT. */
  eventKey?: string | null;
  /** Contract identity externalId (players: nflcom-bootstrap id; DEF: must equal teamKey). */
  externalId?: string;
  /** Overrides the contract identity provider (to exercise provider violations). */
  identityProvider?: string;
  extraIdentities?: Array<{ provider: string; externalId: string }>;
  name?: string;
};

export const SYNTHETIC_EVENTS: SyntheticEventSpec[] = [
  { key: "nfl-2026-reg-05-sea-sf", homeTeamKey: "san-francisco-49ers", awayTeamKey: "seattle-seahawks", disposition: "PLAYED" },
  { key: "nfl-2026-reg-05-lar-was", homeTeamKey: "washington-commanders", awayTeamKey: "los-angeles-rams", disposition: "PLAYED" },
  { key: "nfl-2026-reg-05-lv-kc", homeTeamKey: "kansas-city-chiefs", awayTeamKey: "las-vegas-raiders", disposition: "CANCELLED" },
  { key: "nfl-2026-reg-05-nyg-dal", homeTeamKey: "dallas-cowboys", awayTeamKey: "new-york-giants", disposition: "MOVED_OUT_OF_WEEK" },
];

const SF = "san-francisco-49ers";
const SEA = "seattle-seahawks";
const WAS = "washington-commanders";
const LAR = "los-angeles-rams";
const KC = "kansas-city-chiefs";
const LV = "las-vegas-raiders";
const DAL = "dallas-cowboys";

/** Default week: ties, negatives, a legitimate zero, every non-participant disposition, WAS/LAR DEF. */
export const SYNTHETIC_PARTICIPANTS: SyntheticParticipantSpec[] = [
  { id: "qb-a", position: "QB", teamKey: SF, points: 2410, name: "Quinn Alpha" },
  { id: "qb-b", position: "QB", teamKey: SEA, points: 1800, name: "Quinn Bravo" },
  { id: "qb-neg", position: "QB", teamKey: WAS, points: -120, name: "Quinn Negative" },
  { id: "qb-dnp", position: "QB", teamKey: LAR, state: "VERIFIED_NON_PARTICIPANT", disposition: "DNP", proof: "OFFICIAL_INACTIVE", name: "Quinn Inactive" },
  { id: "rb-a", position: "RB", teamKey: SF, points: 2810, name: "Riley Alpha" },
  { id: "rb-tie1", position: "RB", teamKey: SEA, points: 1940, name: "Riley TieOne" },
  { id: "rb-tie2", position: "RB", teamKey: LAR, points: 1940, name: "Riley TieTwo" },
  { id: "rb-zero", position: "RB", teamKey: WAS, state: "PARTICIPATED_ZERO", points: 0, name: "Riley Zero" },
  { id: "rb-dnp", position: "RB", teamKey: WAS, state: "VERIFIED_NON_PARTICIPANT", disposition: "DNP", proof: "EXHAUSTIVE_GAME_PARTICIPATION", name: "Riley Inactive" },
  { id: "rb-cancel", position: "RB", teamKey: KC, state: "VERIFIED_NON_PARTICIPANT", disposition: "CANCELLED_GAME", proof: "WEEK_DISPOSITION", name: "Riley Cancelled" },
  { id: "rb-moved", position: "RB", teamKey: DAL, state: "VERIFIED_NON_PARTICIPANT", disposition: "MOVED_OUT_OF_WEEK", proof: "WEEK_DISPOSITION", name: "Riley Moved" },
  { id: "rb-bye", position: "RB", teamKey: "green-bay-packers", state: "VERIFIED_NON_PARTICIPANT", disposition: "BYE", proof: "WEEK_DISPOSITION", eventKey: null, name: "Riley Bye" },
  { id: "rb-unrostered", position: "RB", teamKey: "new-york-jets", state: "VERIFIED_NON_PARTICIPANT", disposition: "NO_ROSTER_ASSIGNMENT", proof: "WEEK_DISPOSITION", eventKey: null, name: "Riley Released" },
  { id: "wr-a", position: "WR", teamKey: SF, points: 2200, name: "Wren Alpha" },
  { id: "wr-b", position: "WR", teamKey: SEA, points: 1500, name: "Wren Bravo" },
  { id: "wr-c", position: "WR", teamKey: WAS, points: 1500, name: "Wren Charlie" },
  { id: "wr-d", position: "WR", teamKey: LAR, points: 1500, name: "Wren Delta" },
  { id: "wr-e", position: "WR", teamKey: SF, points: 900, name: "Wren Echo" },
  { id: "wr-f", position: "WR", teamKey: SEA, points: 50, name: "Wren Foxtrot" },
  { id: "te-a", position: "TE", teamKey: SF, points: 1200, name: "Tate Alpha" },
  { id: "te-dnp", position: "TE", teamKey: SEA, state: "VERIFIED_NON_PARTICIPANT", disposition: "DNP", proof: "OFFICIAL_INACTIVE", name: "Tate Inactive" },
  { id: "te-neg", position: "TE", teamKey: LAR, points: -120, name: "Tate Negative" },
  { id: "def-sf", position: "DEF", teamKey: SF, points: 700 },
  { id: "def-sea", position: "DEF", teamKey: SEA, points: 300 },
  { id: "def-was", position: "DEF", teamKey: WAS, points: 1100 },
  { id: "def-lar", position: "DEF", teamKey: LAR, points: -100 },
  { id: "def-kc", position: "DEF", teamKey: KC, state: "VERIFIED_NON_PARTICIPANT", disposition: "CANCELLED_GAME", proof: "WEEK_DISPOSITION" },
  { id: "def-lv", position: "DEF", teamKey: LV, state: "VERIFIED_NON_PARTICIPANT", disposition: "CANCELLED_GAME", proof: "WEEK_DISPOSITION" },
];

/** Default nflcom-bootstrap externalId for a synthetic player. */
export const syntheticPlayerExternalId = (id: string) => `nfl-${id}`;

const isScorable = (state: SngParticipationState) => state === "PARTICIPATED_WITH_STATS" || state === "PARTICIPATED_ZERO";
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function participantRecord(spec: SyntheticParticipantSpec, events: SyntheticEventSpec[]) {
  const state = spec.state ?? "PARTICIPATED_WITH_STATS";
  const scorable = isScorable(state);
  const kind = spec.position === "DEF" ? "TEAM_DEFENSE" : "PLAYER";
  const defaultEvent = events.find((e) => e.homeTeamKey === spec.teamKey || e.awayTeamKey === spec.teamKey)?.key ?? null;
  const contractIdentity =
    kind === "PLAYER"
      ? { provider: spec.identityProvider ?? RANKEYEQ_PLAYER_IDENTITY_PROVIDER, externalId: spec.externalId ?? syntheticPlayerExternalId(spec.id) }
      : { provider: spec.identityProvider ?? SNG_DEFENSE_IDENTITY_PROVIDER, externalId: spec.externalId ?? spec.teamKey };
  const identities = [contractIdentity, ...(spec.extraIdentities ?? [])].map((identity) => ({
    ...identity,
    evidence: evidence(`identity-${identity.provider}-${identity.externalId}`),
  }));
  return {
    participantId: spec.id,
    kind,
    position: spec.position,
    eventKey: spec.eventKey === undefined ? defaultEvent : spec.eventKey,
    teamKey: spec.teamKey,
    state,
    disposition: spec.disposition ?? (scorable ? "PLAYED" : "DNP"),
    participationProof: spec.proof ?? (scorable ? "COMPLETE_FACTUAL_LINE" : "OFFICIAL_INACTIVE"),
    channelsReviewed: [...ALL_CHANNELS],
    sourcePosition: spec.position,
    eligibilityEvidence: evidence(`eligibility-${spec.id}`),
    evidence: evidence(`participation-${spec.id}`),
    identities,
  };
}

export type SyntheticArtifactOptions = {
  season?: number;
  week?: number;
  artifactId?: string;
  revision?: number;
  supersedesArtifactId?: string | null;
  acceptedAt?: string;
  participants?: SyntheticParticipantSpec[];
  events?: SyntheticEventSpec[];
  playerProvider?: string;
};

/** Mutable plain-object draft (no contentChecksum) for tests to alter before sealing. */
export function syntheticCanonicalDraft(options: SyntheticArtifactOptions = {}): Json {
  const season = options.season ?? 2026;
  const week = options.week ?? 5;
  const revision = options.revision ?? 1;
  const artifactId = options.artifactId ?? `artifact-r${revision}`;
  const supersedes = options.supersedesArtifactId === undefined ? (revision === 1 ? null : `artifact-r${revision - 1}`) : options.supersedesArtifactId;
  const acceptedAt = options.acceptedAt ?? "2026-10-07T15:00:00.000Z";
  const specs = options.participants ?? SYNTHETIC_PARTICIPANTS;
  const events = options.events ?? SYNTHETIC_EVENTS;
  const pointsById = new Map(specs.map((spec) => [spec.id, spec.points ?? 0]));
  const participants = specs.map((spec) => participantRecord(spec, events));

  const manifestEvents = events.map((event) => {
    const members = participants.filter((p) => p.eventKey === event.key && event.disposition === "PLAYED");
    const defenses = members.filter((p) => p.kind === "TEAM_DEFENSE" && isScorable(p.state));
    return {
      key: event.key,
      homeTeamKey: event.homeTeamKey,
      awayTeamKey: event.awayTeamKey,
      disposition: event.disposition,
      finalityEvidence: evidence(`finality-${event.key}`),
      playerParticipantIds: members.filter((p) => p.kind === "PLAYER" && (isScorable(p.state) || p.disposition === "DNP")).map((p) => p.participantId),
      defenseParticipantIds: defenses.map((p) => p.participantId),
      pointsAllowedEvidence: defenses.map((p) => ({ participantId: p.participantId, pointsAllowed: 17, evidence: evidence(`pa-${p.participantId}`) })),
    };
  });

  const manifest = {
    contractVersion: SNG_COVERAGE_MANIFEST_CONTRACT_VERSION,
    league: "NFL",
    season,
    seasonType: "REG",
    week,
    positionPolicyVersion: SNG_POSITION_POLICY_VERSION,
    scheduleEvidence: evidence("schedule"),
    populationEvidence: evidence("population"),
    scope: SNG_COVERAGE_MANIFEST_SCOPE,
    channelsReviewed: [...ALL_CHANNELS],
    events: manifestEvents,
    participants,
    sources: [evidence("source-stats")],
    consumerContract: {
      playerProvider: options.playerProvider ?? RANKEYEQ_PLAYER_IDENTITY_PROVIDER,
      defenseProvider: SNG_DEFENSE_IDENTITY_PROVIDER,
      evidence: evidence("consumer-contract"),
    },
  };

  const readinessChecksum = hex(`readiness-${season}-${week}-${revision}`);
  const ranks = new Map<string, number>();
  const resultSets = SNG_POSITIONS.map((position) => {
    const scorable = participants
      .filter((p) => p.position === position && isScorable(p.state))
      .sort((a, b) => pointsById.get(b.participantId)! - pointsById.get(a.participantId)! || byCodeUnit(a.participantId, b.participantId));
    const entries = scorable.map((p, index) => {
      const points = pointsById.get(p.participantId)!;
      const rank = scorable.filter((other) => pointsById.get(other.participantId)! > points).length + 1;
      ranks.set(p.participantId, rank);
      const event = events.find((e) => e.key === p.eventKey)!;
      const spec = specs.find((s) => s.id === p.participantId)!;
      return {
        resultKey: `${position}:${p.participantId}`,
        participantId: p.participantId,
        participantKind: p.kind,
        canonicalName: spec.name ?? `${p.teamKey} D/ST`,
        externalIdentities: p.identities,
        canonicalPosition: position,
        teamKey: p.teamKey,
        eventKey: p.eventKey,
        opponentTeamKey: event.homeTeamKey === p.teamKey ? event.awayTeamKey : event.homeTeamKey,
        participationState: p.state,
        sourceFinality: "FINAL",
        pointsHundredths: points,
        competitionRank: rank,
        tieGroupKey: hex(`tie-${points}`),
        tieGroupSize: scorable.filter((other) => pointsById.get(other.participantId) === points).length,
        displayOrdinal: index + 1,
        derivedPerformanceId: `derived-${p.participantId}`,
        resultFingerprint: hex(`result-${p.participantId}`),
        inputSnapshotId: `input-${p.participantId}`,
        inputChecksum: hex(`input-${p.participantId}`),
        sourceRevisionFingerprint: hex(`source-${p.participantId}`),
        eligibilityEvidence: p,
        performanceEvidence: {
          eventId: `event-${p.eventKey}`,
          normalizedFacts: { synthetic: 1 },
          components: { synthetic: points },
          ...(p.kind === "TEAM_DEFENSE" ? { pointsAllowedPolicy: SNG_DEF_POINTS_ALLOWED_POLICY, pointsAllowedEvidence: { participantId: p.participantId } } : {}),
        },
      };
    });
    return {
      resultSetId: `set-${position}`,
      positionCode: position,
      eligibilityPolicyVersion: SNG_POSITION_POLICY_VERSION,
      resultSetChecksum: hex(`set-${position}-${revision}`),
      exportedRowsChecksum: "",
      fieldSize: entries.length,
      finality: "FINAL",
      sourceComplete: true,
      readinessEvidenceChecksum: readinessChecksum,
      entries,
    };
  });

  const participationLedger = [...participants]
    .sort((a, b) => byCodeUnit(a.participantId, b.participantId))
    .map((p) => ({
      ...p,
      pointsHundredths: isScorable(p.state) ? pointsById.get(p.participantId)! : null,
      competitionRank: isScorable(p.state) ? ranks.get(p.participantId)! : null,
    }));

  const seriesKey = sngSeriesKey(season, week);
  return {
    schemaVersion: SNG_CANONICAL_ARTIFACT_SCHEMA_VERSION,
    serializationVersion: SNG_CANONICAL_SERIALIZATION_VERSION,
    artifactId,
    seriesKey,
    revision,
    supersedesArtifactId: supersedes,
    generatedAt: acceptedAt,
    contentChecksumAlgorithm: "SHA-256",
    payload: {
      week: { league: "NFL", season, seasonType: "REG", week },
      ruleset: {
        status: "ACTIVE",
        code: SNG_RULESET_CODE,
        version: SNG_RULESET_VERSION,
        definition: { code: SNG_RULESET_CODE, version: SNG_RULESET_VERSION, synthetic: true },
        definitionChecksum: SNG_RULESET_DEFINITION_CHECKSUM,
        minimumEngineVersion: SNG_ENGINE_VERSION,
      },
      engine: { version: SNG_ENGINE_VERSION, positionPolicyVersion: SNG_POSITION_POLICY_VERSION },
      run: {
        scoringRunId: `run-${revision}`,
        mode: "SHADOW",
        status: "COMPLETED",
        runFingerprint: hex(`run-${revision}`),
        inputSetChecksum: hex(`inputs-${revision}`),
        sourceRevisionFingerprint: hex(`sources-${revision}`),
      },
      acceptance: {
        id: artifactId,
        seriesKey,
        revision,
        supersedesId: supersedes,
        acceptedById: "sng-owner",
        acceptedAt,
        reason: "Synthetic contract fixture",
        manifestChecksum: "",
        status: "ACCEPTED",
        readinessPolicyVersion: SNG_READINESS_POLICY_VERSION,
        readinessEvidenceChecksum: readinessChecksum,
      },
      coverage: {
        manifest,
        readiness: { ready: true, blockers: [], checks: {}, evidenceChecksum: readinessChecksum, observationFingerprint: hex("observation") },
      },
      events: [],
      sources: [],
      participationLedger,
      resultSets,
    },
  };
}

export type SealedSyntheticArtifact = { artifact: Json; bytes: string; checksum: string };

/** Recomputes rows/manifest checksums (unless disabled) and the outer digest. */
export function sealSyntheticArtifact(draft: Json, options: { refreshRows?: boolean; refreshManifest?: boolean } = {}): SealedSyntheticArtifact {
  const body = structuredClone(draft) as Json & { payload: Json };
  const payload = body.payload as {
    resultSets: Array<{ entries: unknown[]; exportedRowsChecksum: string }>;
    acceptance: { manifestChecksum: string };
    coverage: { manifest: unknown };
  };
  if (options.refreshRows !== false && Array.isArray(payload.resultSets)) {
    for (const set of payload.resultSets) set.exportedRowsChecksum = canonicalExportChecksum(set.entries);
  }
  if (options.refreshManifest !== false && payload.acceptance && payload.coverage) {
    payload.acceptance.manifestChecksum = canonicalExportChecksum(payload.coverage.manifest);
  }
  const checksum = canonicalExportChecksum(body);
  const artifact = { ...body, contentChecksum: checksum };
  return { artifact, bytes: canonicalExportJson(artifact), checksum };
}

export function buildSyntheticCanonicalArtifact(options: SyntheticArtifactOptions = {}): SealedSyntheticArtifact {
  return sealSyntheticArtifact(syntheticCanonicalDraft(options));
}
