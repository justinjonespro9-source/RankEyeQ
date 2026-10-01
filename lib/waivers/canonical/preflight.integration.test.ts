import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildSyntheticCanonicalArtifact, SYNTHETIC_PARTICIPANTS } from "@/lib/waivers/__fixtures__/canonical-artifact";
import { createWaiverFixture, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { verifySngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { buildWaiverCanonicalPreflight, loadWaiverCanonicalPreflightSnapshot } from "@/lib/waivers/canonical/preflight";
import { evaluateWaiverCanonicalPreflight } from "@/lib/waivers/canonical/preflight-model";

let f: WaiverFixture;
let snapshotId: string;
const p: Record<string, FixturePlayer> = {};
const external = (key: string) => `${f.suffix}-${key}`;

async function tableCounts() {
  return {
    snapshots: await prisma.waiverSnapshot.count(),
    entries: await prisma.waiverSnapshotEntry.count(),
    corrections: await prisma.waiverSnapshotCorrection.count(),
    contests: await prisma.waiverContest.count(),
    submissions: await prisma.waiverSubmission.count(),
    revisions: await prisma.waiverSubmissionRevision.count(),
    calls: await prisma.waiverCall.count(),
    importLogs: await prisma.manualImportLog.count(),
    audit: await prisma.adminAuditLog.count(),
    players: await prisma.rankableEntry.count(),
  };
}

beforeAll(async () => {
  f = await createWaiverFixture("cpf");
  const { weekId } = await f.addWeek();
  p.matched = await f.addRosterPlayer({ position: "RB", team: "SF", label: "Canonical Matched" });
  p.inactive = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Canonical Inactive" });
  p.teamChanged = await f.addRosterPlayer({ position: "RB", team: "SF", label: "Canonical Traded" });
  p.merged = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Canonical Merged" });
  p.missing = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Canonical Missing" });
  p.manual = await f.addRosterPlayer({ position: "TE", team: "SF", label: "Canonical Manual" });
  const bootstrap = async (player: FixturePlayer, key: string, data: { active?: boolean; adminNotes?: string } = {}) =>
    prisma.rankableEntry.update({ where: { id: player.id }, data: { provider: "nflcom-bootstrap", externalId: external(key), ...data } });
  await bootstrap(p.matched, "rb-a");
  await bootstrap(p.inactive, "wr-e", { active: false });
  await bootstrap(p.teamChanged, "rb-tie1");
  await bootstrap(p.merged, "wr-a", { active: false, adminNotes: "Merged into canonical-x: fixture duplicate" });
  await bootstrap(p.missing, "wr-unknown");
  const snapshot = await f.freezeSnapshot({
    weekId,
    rows: [{ player: p.matched }, { player: p.inactive }, { player: p.teamChanged }, { player: p.merged }, { player: p.missing }, { player: p.manual }],
  });
  snapshotId = snapshot.id;
});

afterAll(async () => {
  await f?.cleanup();
});

function artifactFor(seasonOverride?: number) {
  const ids = new Set(["rb-a", "rb-tie1", "wr-a", "wr-e"]);
  return buildSyntheticCanonicalArtifact({
    season: seasonOverride,
    week: 1,
    participants: SYNTHETIC_PARTICIPANTS.map((spec) => (ids.has(spec.id) ? { ...spec, externalId: external(spec.id) } : spec)),
  });
}

describe("canonical identity preflight (read-only)", () => {
  it("loads the frozen pool with live identities and writes nothing", async () => {
    const before = await tableCounts();
    const entriesBefore = await prisma.rankableEntry.findMany({
      where: { id: { in: Object.values(p).map((x) => x.id) } },
      select: { id: true, updatedAt: true, provider: true, externalId: true, active: true },
      orderBy: { id: "asc" },
    });

    const loaded = await loadWaiverCanonicalPreflightSnapshot(prisma, snapshotId);
    const result = verifySngCanonicalArtifact(artifactFor().bytes);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const report = evaluateWaiverCanonicalPreflight({ snapshot: loaded, verified: { artifact: result.artifact, summary: result.summary } });
    const wired = await buildWaiverCanonicalPreflight(prisma, { snapshotId, artifactText: artifactFor().bytes });

    expect(await tableCounts()).toEqual(before);
    expect(
      await prisma.rankableEntry.findMany({
        where: { id: { in: Object.values(p).map((x) => x.id) } },
        select: { id: true, updatedAt: true, provider: true, externalId: true, active: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(entriesBefore);

    const byPlayer = new Map(report.rows.map((row) => [row.rankableEntryId, row]));
    expect(byPlayer.get(p.matched.id)).toMatchObject({ matched: true, issues: [], canonical: { participantId: "rb-a", overallPositionRank: 1 } });
    expect(byPlayer.get(p.inactive.id)!.issues.map((i) => i.code)).toEqual(["IDENTITY_ENTRY_INACTIVE"]);
    expect(byPlayer.get(p.teamChanged.id)!.conflicts.map((c) => c.kind)).toEqual(["TEAM_CHANGED"]);
    expect(byPlayer.get(p.merged.id)!.issues.map((i) => i.code)).toEqual(["IDENTITY_ENTRY_MERGED"]);
    expect(byPlayer.get(p.missing.id)!.issues.map((i) => i.code)).toEqual(["PARTICIPANT_NOT_IN_LEDGER"]);
    expect(byPlayer.get(p.manual.id)!.issues.map((i) => i.code)).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);
    expect(report.blockers.map((b) => b.code)).toContain("WEEK_MISMATCH");

    expect(wired.ledgerEvaluated).toBe(false);
    expect(wired.blockers[0]).toMatchObject({ code: "ARTIFACT_NOT_VERIFIED", detail: "WEEK_MISMATCH" });
    expect(wired.counts).toMatchObject({ poolSize: 6, inactive: 1, merged: 1, providerMismatch: 1 });
  });

  it("evaluates identity risks alone when no artifact text is supplied", async () => {
    const report = await buildWaiverCanonicalPreflight(prisma, { snapshotId });
    expect(report).toMatchObject({ ledgerEvaluated: false, ready: false, artifact: null });
    expect(report.advisories.map((a) => a.code)).toEqual(["IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT", "LEDGER_NOT_EVALUATED"]);
  });

  it("rejects an unknown snapshot", async () => {
    await expect(buildWaiverCanonicalPreflight(prisma, { snapshotId: "missing-snapshot" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
