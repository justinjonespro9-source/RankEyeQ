import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSyntheticCanonicalArtifact,
  hex,
  sealSyntheticArtifact,
  SYNTHETIC_PARTICIPANTS,
  syntheticCanonicalDraft,
  type SyntheticArtifactOptions,
  type SyntheticParticipantSpec,
} from "@/lib/waivers/__fixtures__/canonical-artifact";
import type { SngCanonicalArtifact, SngParticipant } from "@/lib/waivers/canonical/artifact-types";
import {
  checkSngCanonicalSuccession,
  verifySngCanonicalArtifact,
  type CanonicalVerificationCode,
  type CanonicalVerificationOptions,
  type CanonicalVerificationResult,
} from "@/lib/waivers/canonical/artifact-verifier";
import { sngSeriesKey } from "@/lib/waivers/canonical/contract";
import { canonicalExportChecksum, canonicalExportJson } from "@/lib/waivers/canonical/serialization";

type Draft = SngCanonicalArtifact;

function mutated(edit: (draft: Draft) => void, options: SyntheticArtifactOptions = {}, seal: { refreshRows?: boolean; refreshManifest?: boolean } = {}) {
  const draft = syntheticCanonicalDraft(options);
  edit(draft as unknown as Draft);
  return sealSyntheticArtifact(draft, seal);
}

/** Applies a participant change consistently to manifest, ledger and result entries. */
function editParticipant(draft: Draft, id: string, patch: Partial<SngParticipant>) {
  const manifestRow = draft.payload.coverage.manifest.participants.find((p) => p.participantId === id)!;
  Object.assign(manifestRow, patch);
  Object.assign(draft.payload.participationLedger.find((p) => p.participantId === id)!, patch);
  for (const set of draft.payload.resultSets) {
    for (const entry of set.entries) {
      if (entry.participantId !== id) continue;
      entry.eligibilityEvidence = structuredClone(manifestRow);
      entry.externalIdentities = structuredClone(manifestRow.identities);
      entry.participationState = manifestRow.state;
    }
  }
}

function codes(result: CanonicalVerificationResult): CanonicalVerificationCode[] {
  return result.ok ? [] : [...new Set(result.issues.map((issue) => issue.code))];
}

function verify(bytes: string, options?: CanonicalVerificationOptions) {
  return verifySngCanonicalArtifact(bytes, options);
}

function withSpecs(edit: (specs: SyntheticParticipantSpec[]) => SyntheticParticipantSpec[]) {
  return buildSyntheticCanonicalArtifact({ participants: edit(structuredClone(SYNTHETIC_PARTICIPANTS)) });
}

describe("sng-canonical-json/1 serialization", () => {
  it("orders keys by UTF-16 code unit, not locale", () => {
    expect(canonicalExportJson({ b: 1, B: 2, a: 3, "é": 4, Z: 5 })).toBe('{"B":2,"Z":5,"a":3,"b":1,"é":4}');
  });

  it("keeps array order and explicit nulls; rejects non-canonical values", () => {
    expect(canonicalExportJson({ list: [3, 1, null, "x", false] })).toBe('{"list":[3,1,null,"x",false]}');
    for (const value of [undefined, Number.NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, new Date(0), new Map()]) {
      expect(() => canonicalExportJson({ value })).toThrow(/Canonical JSON/);
    }
  });

  it("hashes the UTF-8 canonical text", () => {
    expect(canonicalExportChecksum({ a: 1 })).toBe(hex('{"a":1}'));
  });
});

describe("verifySngCanonicalArtifact — valid synthetic artifact", () => {
  const sealed = buildSyntheticCanonicalArtifact();
  const result = verify(sealed.bytes, { expectedSeason: 2026, expectedWeek: 5, expectedContentChecksum: sealed.checksum, attestedPublicationState: "ACCEPTED" });

  it("verifies and summarizes the artifact", () => {
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({
      artifactId: "artifact-r1",
      revision: 1,
      supersedesArtifactId: null,
      contentChecksum: sealed.checksum,
      season: 2026,
      week: 5,
      seriesKey: sngSeriesKey(2026, 5),
      fieldSizes: { QB: 3, RB: 4, WR: 6, TE: 2, DEF: 4 },
      participantCount: SYNTHETIC_PARTICIPANTS.length,
    });
    expect(result.summary.stateCounts).toEqual({ PARTICIPATED_WITH_STATS: 18, PARTICIPATED_ZERO: 1, VERIFIED_NON_PARTICIPANT: 9 });
  });

  it("keeps competition ties exact (1, 2, 2, 4)", () => {
    if (!result.ok) throw new Error("expected ok");
    const rb = result.artifact.payload.resultSets.find((set) => set.positionCode === "RB")!;
    expect(rb.entries.map((e) => [e.participantId, e.pointsHundredths, e.competitionRank, e.tieGroupSize])).toEqual([
      ["rb-a", 2810, 1, 1],
      ["rb-tie1", 1940, 2, 2],
      ["rb-tie2", 1940, 2, 2],
      ["rb-zero", 0, 4, 1],
    ]);
    const wr = result.artifact.payload.resultSets.find((set) => set.positionCode === "WR")!;
    expect(wr.entries.map((e) => e.competitionRank)).toEqual([1, 2, 2, 2, 5, 6]);
  });

  it("ranks legitimate negative scores and PARTICIPATED_ZERO at zero", () => {
    if (!result.ok) throw new Error("expected ok");
    const ledger = new Map(result.artifact.payload.participationLedger.map((row) => [row.participantId, row]));
    expect(ledger.get("qb-neg")).toMatchObject({ pointsHundredths: -120, competitionRank: 3 });
    expect(ledger.get("te-neg")).toMatchObject({ pointsHundredths: -120, competitionRank: 2 });
    expect(ledger.get("rb-zero")).toMatchObject({ state: "PARTICIPATED_ZERO", pointsHundredths: 0, competitionRank: 4 });
  });

  it("keeps VERIFIED_NON_PARTICIPANT null/unranked and outside result fields", () => {
    if (!result.ok) throw new Error("expected ok");
    const vnp = result.artifact.payload.participationLedger.filter((row) => row.state === "VERIFIED_NON_PARTICIPANT");
    expect(vnp.map((row) => row.disposition).sort()).toEqual(
      ["BYE", "CANCELLED_GAME", "CANCELLED_GAME", "CANCELLED_GAME", "DNP", "DNP", "DNP", "MOVED_OUT_OF_WEEK", "NO_ROSTER_ASSIGNMENT"],
    );
    expect(vnp.every((row) => row.pointsHundredths === null && row.competitionRank === null)).toBe(true);
    const ranked = new Set(result.artifact.payload.resultSets.flatMap((set) => set.entries.map((e) => e.participantId)));
    expect(vnp.some((row) => ranked.has(row.participantId))).toBe(false);
  });

  it("accepts a legitimately empty positional field", () => {
    const noTe = withSpecs((specs) => specs.filter((s) => s.position !== "TE"));
    const verified = verify(noTe.bytes);
    expect(codes(verified)).toEqual([]);
    if (verified.ok) expect(verified.summary.fieldSizes.TE).toBe(0);
  });
});

describe("verifySngCanonicalArtifact — integrity", () => {
  const sealed = buildSyntheticCanonicalArtifact();

  it("rejects byte tampering against the outer digest", () => {
    expect(codes(verify(sealed.bytes.replace('"revision":1', '"revision":2')))).toEqual(["CONTENT_CHECKSUM_MISMATCH"]);
    expect(codes(verify(sealed.bytes.replace('"pointsHundredths":2810', '"pointsHundredths":2811')))).toEqual(["CONTENT_CHECKSUM_MISMATCH"]);
  });

  it("rejects non-canonical text even when the content is identical", () => {
    expect(codes(verify(JSON.stringify(sealed.artifact, null, 2)))).toEqual(["ARTIFACT_NON_CANONICAL_BYTES"]);
    const reordered = JSON.stringify({ contentChecksum: sealed.checksum, ...sealed.artifact });
    expect(codes(verify(reordered))).toEqual(["ARTIFACT_NON_CANONICAL_BYTES"]);
  });

  it("rejects malformed and unsafe input", () => {
    expect(codes(verify(""))).toEqual(["ARTIFACT_INPUT_INVALID"]);
    expect(codes(verify(`\uFEFF${sealed.bytes}`))).toEqual(["ARTIFACT_INPUT_INVALID"]);
    expect(codes(verifySngCanonicalArtifact(Buffer.from(sealed.bytes)))).toEqual(["ARTIFACT_INPUT_INVALID"]);
    expect(codes(verify("{not json"))).toEqual(["ARTIFACT_JSON_INVALID"]);
    expect(codes(verify(sealed.bytes.replace('"pointsHundredths":2810', '"pointsHundredths":28.1')))).toEqual(["ARTIFACT_UNSAFE_VALUE"]);
    expect(codes(verify(sealed.bytes.replace('"pointsHundredths":2810', '"pointsHundredths":9007199254740993')))).toEqual(["ARTIFACT_UNSAFE_VALUE"]);
    expect(codes(verify(`{"__proto__":{"polluted":true},${sealed.bytes.slice(1)}`))).toEqual(["ARTIFACT_UNSAFE_VALUE"]);
  });

  it("enforces the operator-entered digest and the attested publication state", () => {
    expect(codes(verify(sealed.bytes, { expectedContentChecksum: hex("other") }))).toEqual(["EXPECTED_CHECKSUM_MISMATCH"]);
    expect(codes(verify(sealed.bytes, { attestedPublicationState: "WITHDRAWN" }))).toEqual(["ARTIFACT_NOT_CURRENT"]);
    expect(codes(verify(sealed.bytes, { attestedPublicationState: "SUPERSEDED" }))).toEqual(["ARTIFACT_NOT_CURRENT"]);
  });

  it("rejects unsupported schema and serialization versions", () => {
    expect(codes(verify(mutated((d) => (d.schemaVersion = "sng-canonical-nfl-weekly-performance/2")).bytes))).toEqual(["SCHEMA_VERSION_UNSUPPORTED"]);
    expect(codes(verify(mutated((d) => (d.serializationVersion = "sng-canonical-json/2")).bytes))).toEqual(["SERIALIZATION_VERSION_UNSUPPORTED"]);
  });

  it("rejects unexpected envelope or entry keys", () => {
    expect(codes(verify(mutated((d) => Object.assign(d, { signature: "x" })).bytes))).toEqual(["ENVELOPE_INVALID"]);
    expect(codes(verify(mutated((d) => Object.assign(d.payload.resultSets[0].entries[0], { bonus: 1 })).bytes))).toEqual(["RESULT_ENTRY_INVALID"]);
  });
});

describe("verifySngCanonicalArtifact — authority and readiness", () => {
  it("requires an ACCEPTED publication", () => {
    expect(codes(verify(mutated((d) => (d.payload.acceptance.status = "SUPERSEDED")).bytes))).toEqual(["ARTIFACT_NOT_ACCEPTED"]);
  });

  it("requires readiness READY with zero blockers", () => {
    expect(codes(verify(mutated((d) => (d.payload.coverage.readiness.ready = false)).bytes))).toContain("READINESS_NOT_READY");
    expect(codes(verify(mutated((d) => d.payload.coverage.readiness.blockers.push({ code: "QUALITY_ISSUE" })).bytes))).toEqual(["READINESS_NOT_READY"]);
  });

  it("pins the week, ruleset, engine, policy and run state", () => {
    const sealed = buildSyntheticCanonicalArtifact();
    expect(codes(verify(sealed.bytes, { expectedSeason: 2026, expectedWeek: 6 }))).toEqual(["WEEK_MISMATCH"]);
    expect(codes(verify(sealed.bytes, { expectedSeason: 2025, expectedWeek: 5 }))).toEqual(["WEEK_MISMATCH"]);
    expect(codes(verify(mutated((d) => (d.payload.week.week = 6)).bytes))).toEqual(["WEEK_INVALID"]);
    expect(codes(verify(mutated((d) => (d.payload.ruleset.definitionChecksum = hex("other-ruleset"))).bytes))).toEqual(["RULESET_PIN_MISMATCH"]);
    expect(codes(verify(mutated((d) => (d.payload.ruleset.status = "SHADOW")).bytes))).toEqual(["RULESET_PIN_MISMATCH"]);
    expect(codes(verify(mutated((d) => (d.payload.engine.version = "sng-nfl-fantasy-engine/1.0.1")).bytes))).toEqual(["ENGINE_PIN_MISMATCH"]);
    expect(codes(verify(mutated((d) => (d.payload.run.mode = "PREVIEW")).bytes))).toEqual(["RUN_STATE_INVALID"]);
    expect(codes(verify(mutated((d) => (d.seriesKey = "series")).bytes))).toContain("SERIES_KEY_MISMATCH");
  });

  it("detects a stale embedded manifest checksum", () => {
    const sealed = mutated((d) => (d.payload.coverage.manifest.sources[0].label = "edited"), {}, { refreshManifest: false });
    expect(codes(verify(sealed.bytes))).toEqual(["MANIFEST_CHECKSUM_MISMATCH"]);
  });

  it("rejects a non-RankEyeQ consumer contract", () => {
    expect(codes(verify(buildSyntheticCanonicalArtifact({ playerProvider: "sleeper" }).bytes))).toEqual(["CONSUMER_CONTRACT_MISMATCH"]);
  });
});

describe("verifySngCanonicalArtifact — revision and predecessor", () => {
  it("accepts revision 2 that supersedes revision 1", () => {
    const r2 = buildSyntheticCanonicalArtifact({ revision: 2, artifactId: "artifact-r2", supersedesArtifactId: "artifact-r1" });
    const result = verify(r2.bytes);
    expect(codes(result)).toEqual([]);
    if (result.ok) expect(result.summary).toMatchObject({ revision: 2, supersedesArtifactId: "artifact-r1" });
  });

  it("rejects incoherent revision structure", () => {
    expect(codes(verify(buildSyntheticCanonicalArtifact({ revision: 2, supersedesArtifactId: null }).bytes))).toEqual(["REVISION_STRUCTURE_INVALID"]);
    expect(codes(verify(buildSyntheticCanonicalArtifact({ revision: 1, supersedesArtifactId: "artifact-r0" }).bytes))).toEqual(["REVISION_STRUCTURE_INVALID"]);
    expect(codes(verify(buildSyntheticCanonicalArtifact({ revision: 2, artifactId: "a", supersedesArtifactId: "a" }).bytes))).toEqual(["REVISION_STRUCTURE_INVALID"]);
    expect(codes(verify(mutated((d) => (d.payload.acceptance.supersedesId = "elsewhere"), { revision: 2 }).bytes))).toEqual(["ACCEPTANCE_IDENTITY_MISMATCH"]);
    expect(codes(verify(mutated((d) => (d.payload.acceptance.id = "other")).bytes))).toEqual(["ACCEPTANCE_IDENTITY_MISMATCH"]);
  });

  it("relates successive imports of one series", () => {
    const ref = (revision: number, artifactId: string, supersedesArtifactId: string | null, contentChecksum = hex(artifactId)) => ({
      artifactId,
      seriesKey: sngSeriesKey(2026, 5),
      revision,
      supersedesArtifactId,
      contentChecksum,
    });
    const r1 = ref(1, "r1", null);
    expect(checkSngCanonicalSuccession(null, r1)).toEqual({ ok: true, replay: false, predecessorKnown: true, skippedRevisions: 0 });
    expect(checkSngCanonicalSuccession(null, ref(3, "r3", "r2"))).toEqual({ ok: true, replay: false, predecessorKnown: false, skippedRevisions: 2 });
    expect(checkSngCanonicalSuccession(r1, r1)).toEqual({ ok: true, replay: true, predecessorKnown: true, skippedRevisions: 0 });
    expect(checkSngCanonicalSuccession(r1, ref(2, "r2", "r1"))).toEqual({ ok: true, replay: false, predecessorKnown: true, skippedRevisions: 0 });
    expect(checkSngCanonicalSuccession(r1, ref(3, "r3", "r2"))).toEqual({ ok: true, replay: false, predecessorKnown: false, skippedRevisions: 1 });
    expect(checkSngCanonicalSuccession(r1, ref(2, "r2", "zz"))).toMatchObject({ ok: false, code: "PREDECESSOR_MISMATCH" });
    expect(checkSngCanonicalSuccession(ref(2, "r2", "r1"), r1)).toMatchObject({ ok: false, code: "REVISION_REGRESSION" });
    expect(checkSngCanonicalSuccession(r1, ref(1, "r1b", null))).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(checkSngCanonicalSuccession(r1, ref(1, "r1", null, hex("changed")))).toMatchObject({ ok: false, code: "ARTIFACT_ID_REUSED" });
    expect(checkSngCanonicalSuccession(r1, ref(2, "r2", "r1", r1.contentChecksum))).toMatchObject({ ok: false, code: "CHECKSUM_REUSED" });
    expect(checkSngCanonicalSuccession(r1, { ...ref(2, "r2", "r1"), seriesKey: sngSeriesKey(2026, 6) })).toMatchObject({ ok: false, code: "SERIES_MISMATCH" });
  });
});

describe("verifySngCanonicalArtifact — fields, ledger and identity", () => {
  it("requires exactly QB/RB/WR/TE/DEF result sets in contract order", () => {
    expect(codes(verify(mutated((d) => d.payload.resultSets.splice(3, 1)).bytes))).toEqual(["RESULT_SETS_INVALID"]);
    expect(codes(verify(mutated((d) => d.payload.resultSets.reverse()).bytes))).toEqual(["RESULT_SETS_INVALID"]);
  });

  it("rejects a truncated full field", () => {
    expect(codes(verify(mutated((d) => d.payload.resultSets[2].entries.pop()).bytes))).toEqual(["FIELD_SIZE_MISMATCH", "FIELD_POPULATION_MISMATCH"]);
    const resized = mutated((d) => {
      d.payload.resultSets[2].entries.pop();
      d.payload.resultSets[2].fieldSize -= 1;
    });
    expect(codes(verify(resized.bytes))).toEqual(["FIELD_POPULATION_MISMATCH"]);
  });

  it("detects stale exported row checksums", () => {
    const sealed = mutated((d) => (d.payload.resultSets[0].exportedRowsChecksum = hex("stale")), {}, { refreshRows: false });
    expect(codes(verify(sealed.bytes))).toEqual(["EXPORTED_ROWS_CHECKSUM_MISMATCH"]);
  });

  it("recomputes competition ranks and tie groups from integer points", () => {
    const wrongRank = mutated((d) => {
      d.payload.resultSets[1].entries[2].competitionRank = 3;
      d.payload.participationLedger.find((row) => row.participantId === "rb-tie2")!.competitionRank = 3;
    });
    expect(codes(verify(wrongRank.bytes))).toEqual(["RANK_TIE_INVARIANT"]);
    const splitTie = mutated((d) => (d.payload.resultSets[1].entries[2].tieGroupKey = hex("split")));
    expect(codes(verify(splitTie.bytes))).toEqual(["RANK_TIE_INVARIANT"]);
    const misordered = mutated((d) => {
      const entries = d.payload.resultSets[1].entries;
      [entries[0], entries[3]] = [entries[3], entries[0]];
    });
    expect(codes(verify(misordered.bytes))).toContain("RANK_TIE_INVARIANT");
  });

  it("requires the ledger to restate the manifest in participantId order", () => {
    expect(codes(verify(mutated((d) => d.payload.participationLedger.pop()).bytes))).toContain("LEDGER_INVALID");
    expect(codes(verify(mutated((d) => d.payload.participationLedger.reverse()).bytes))).toEqual(["LEDGER_INVALID"]);
    expect(codes(verify(mutated((d) => (d.payload.participationLedger[0].teamKey = "elsewhere")).bytes))).toContain("LEDGER_INVALID");
  });

  it("rejects VERIFIED_NON_PARTICIPANT carrying points or rank", () => {
    const sealed = mutated((d) => (d.payload.participationLedger.find((row) => row.participantId === "qb-dnp")!.pointsHundredths = 0));
    expect(codes(verify(sealed.bytes))).toEqual(["PARTICIPATION_INVARIANT"]);
  });

  it("rejects unresolved states and unaffirmed dispositions", () => {
    expect(codes(verify(mutated((d) => editParticipant(d, "qb-dnp", { state: "UNKNOWN_INCOMPLETE" })).bytes))).toEqual(["PARTICIPATION_UNRESOLVED"]);
    expect(codes(verify(mutated((d) => editParticipant(d, "qb-dnp", { participationProof: "WEEK_DISPOSITION" })).bytes))).toEqual(["PARTICIPATION_INVARIANT"]);
    expect(codes(verify(mutated((d) => editParticipant(d, "rb-bye", { disposition: "UNRESOLVED" })).bytes))).toEqual(["PARTICIPATION_INVARIANT"]);
  });

  it("checks dispositions against manifest events (cancelled, moved, bye)", () => {
    const playedEvent = "nfl-2026-reg-05-sea-sf";
    expect(codes(verify(mutated((d) => editParticipant(d, "rb-cancel", { eventKey: playedEvent, teamKey: "san-francisco-49ers" })).bytes))).toEqual([
      "DISPOSITION_EVENT_INVARIANT",
    ]);
    expect(codes(verify(mutated((d) => editParticipant(d, "rb-moved", { eventKey: playedEvent })).bytes))).toEqual(["DISPOSITION_EVENT_INVARIANT"]);
    expect(codes(verify(mutated((d) => editParticipant(d, "rb-bye", { teamKey: "seattle-seahawks" })).bytes))).toEqual(["DISPOSITION_EVENT_INVARIANT"]);
  });

  it("rejects an unknown disposition value structurally", () => {
    const sealed = mutated((d) => editParticipant(d, "rb-bye", { disposition: "FORFEIT" as never }));
    expect(codes(verify(sealed.bytes))).toEqual(["MANIFEST_INVALID", "LEDGER_INVALID"]);
  });

  it("rejects duplicate external identities", () => {
    const sealed = withSpecs((specs) => specs.map((s) => (s.id === "qb-b" ? { ...s, externalId: "nfl-qb-a" } : s)));
    expect(codes(verify(sealed.bytes))).toEqual(["DUPLICATE_IDENTITY"]);
  });

  it("requires exactly one contract identity per participant", () => {
    const wrongProvider = withSpecs((specs) => specs.map((s) => (s.id === "qb-a" ? { ...s, identityProvider: "sleeper" } : s)));
    expect(codes(verify(wrongProvider.bytes))).toEqual(["IDENTITY_CONTRACT_INVALID"]);
    const twoKeys = withSpecs((specs) =>
      specs.map((s) => (s.id === "qb-a" ? { ...s, extraIdentities: [{ provider: "nflcom-bootstrap", externalId: "nfl-qb-a-alt" }] } : s)),
    );
    expect(codes(verify(twoKeys.bytes))).toEqual(["IDENTITY_CONTRACT_INVALID"]);
  });

  it("requires a DEF sng-team externalId equal to its stable team key (not the WSH abbreviation)", () => {
    const sealed = withSpecs((specs) => specs.map((s) => (s.id === "def-was" ? { ...s, externalId: "WSH" } : s)));
    expect(codes(verify(sealed.bytes))).toEqual(["IDENTITY_CONTRACT_INVALID"]);
  });

  it("requires DEF entries to declare the points-allowed policy", () => {
    const sealed = mutated((d) => {
      const def = d.payload.resultSets[4].entries[0];
      def.performanceEvidence = { ...def.performanceEvidence, pointsAllowedPolicy: "OTHER" };
    });
    expect(codes(verify(sealed.bytes))).toEqual(["RESULT_ENTRY_INVALID"]);
  });
});

/**
 * Producer-generated fixture bytes drop into this directory without verifier
 * changes: `<name>.accepted.json` must verify; `<name>.rejected.<CODE>.json`
 * must fail with CODE.
 */
describe("official SNG producer fixtures", () => {
  const dir = path.join(process.cwd(), "lib/waivers/__fixtures__/sng-canonical");
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : [];

  it("are optional until SNG publishes them", () => {
    expect(Array.isArray(files)).toBe(true);
  });

  for (const name of files) {
    it(name, () => {
      const bytes = readFileSync(path.join(dir, name), "utf8");
      const rejected = /\.rejected\.([A-Z_]+)\.json$/.exec(name);
      const result = verifySngCanonicalArtifact(bytes);
      if (rejected) expect(codes(result)).toContain(rejected[1]);
      else expect(codes(result)).toEqual([]);
    });
  }
});
