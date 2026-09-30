import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadResolvedStatusesForWeek } from "@/lib/eligibility/player-week-availability-store";
import { createWaiverFixture, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadWaiverEntryFacts, loadWaiverWeekGames } from "@/lib/waivers/snapshot/facts";
import { previewWaiverSnapshot } from "@/lib/waivers/snapshot/preview";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

let f: WaiverFixture;
let weekId: string;
type RosterPlayer = FixturePlayer & { team: string };
const p: Record<string, RosterPlayer> = {};

async function tableCounts() {
  return {
    snapshots: await prisma.waiverSnapshot.count(),
    entries: await prisma.waiverSnapshotEntry.count(),
    corrections: await prisma.waiverSnapshotCorrection.count(),
    contests: await prisma.waiverContest.count(),
    importLogs: await prisma.manualImportLog.count(),
    audit: await prisma.adminAuditLog.count(),
    players: await prisma.rankableEntry.count(),
    seasonPlayers: await prisma.seasonPlayer.count(),
    availability: await prisma.playerWeekAvailability.count(),
  };
}

const line = (player: RosterPlayer, pct: string, team = player.team, extra = "") => `${player.name} | ${player.position} | ${team} | ${pct}${extra}`;

beforeAll(async () => {
  f = await createWaiverFixture("pv");
  await f.markRosterSynced();
  ({ weekId } = await f.addWeek({ games: [{ homeTeam: "SF", awayTeam: "SEA" }, { homeTeam: "KC", awayTeam: "LV", status: "POSTPONED" }] }));
  p.qb = await f.addRosterPlayer({ position: "QB", team: "SF", label: "Preview Quarterback" });
  p.rb = await f.addRosterPlayer({ position: "RB", team: "SEA", label: "Preview Runner" });
  p.rbOut = await f.addRosterPlayer({ position: "RB", team: "KC", label: "Preview Hurt" });
  p.rbIr = await f.addRosterPlayer({ position: "RB", team: "LV", label: "Preview Reserve", nflStatus: "IR" });
  p.wr = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Preview Receiver" });
  p.wrQ = await f.addRosterPlayer({ position: "WR", team: "KC", label: "Preview Questionable" });
  p.wrBye = await f.addRosterPlayer({ position: "WR", team: "DAL", label: "Preview Bye" });
  p.wrOverride = await f.addRosterPlayer({ position: "WR", team: "SEA", label: "Preview Override", nflStatus: "IR" });
  p.te = await f.addRosterPlayer({ position: "TE", team: "LV", label: "Preview Tight" });
  p.teNoRoster = await f.addRosterPlayer({ position: "TE", team: "SF", label: "Preview Unrostered", seasonPlayer: false });
  p.def = await f.addRosterPlayer({ position: "DEF", team: "SEA", label: "Preview Seahawks" });
  await f.setAvailability(weekId, p.rbOut.id, "OUT");
  await f.setAvailability(weekId, p.wrQ.id, "QUESTIONABLE");
  await f.setAvailability(weekId, p.wrOverride.id, "AVAILABLE", { manualOverride: true });
  await f.addRankingsPool(weekId, "QB", [p.qb.id]);
});

afterAll(async () => {
  await f?.cleanup();
});

describe("previewWaiverSnapshot", () => {
  it("writes nothing and derives exact evidence from canonical facts", async () => {
    const paste = [
      "Player | Pos | Team | Rostered%",
      line(p.qb, "12"),
      line(p.rb, "49.99"),
      line(p.rbOut, "8"),
      line(p.rbIr, "2"),
      line(p.wr, "50"),
      line(p.wrQ, "20"),
      line(p.wrBye, "3"),
      line(p.wrOverride, "4"),
      line(p.te, "9", "SF"),
      line(p.teNoRoster, "1"),
      `Seattle D/ST | DST | SEA | 30`,
    ].join("\n");
    const updatedBefore = await prisma.rankableEntry.findMany({
      where: { id: { in: Object.values(p).map((x) => x.id) } },
      select: { id: true, updatedAt: true, adminNotes: true },
      orderBy: { id: "asc" },
    });
    const before = await tableCounts();
    const preview = await previewWaiverSnapshot({
      weekId,
      rawText: paste,
      sourceLabel: "Sleeper",
      sourceUrl: "https://sleeper.example/players",
      observedAt: new Date(Date.now() - 10 * 60_000),
    });
    expect(await tableCounts()).toEqual(before);
    expect(
      await prisma.rankableEntry.findMany({
        where: { id: { in: Object.values(p).map((x) => x.id) } },
        select: { id: true, updatedAt: true, adminNotes: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(updatedBefore);

    expect(preview.blockers).toEqual([]);
    const byId = new Map(preview.entries.map((entry) => [entry.rankableEntryId, entry]));
    expect(byId.get(p.qb.id)).toMatchObject({ eligibility: "ELIGIBLE", opponentAtFreeze: "SEA", matchMethod: "EXACT_NAME_TEAM" });
    expect(byId.get(p.rb.id)).toMatchObject({ eligibility: "ELIGIBLE", rosteredBps: 4999 });
    expect(byId.get(p.rbOut.id)).toMatchObject({ exclusionReason: "HARD_UNAVAILABLE", availabilityDesignationAtFreeze: "OUT" });
    expect(byId.get(p.rbIr.id)).toMatchObject({ exclusionReason: "HARD_UNAVAILABLE", rosterStatusAtFreeze: "IR" });
    expect(byId.get(p.wr.id)).toMatchObject({ exclusionReason: "AT_OR_ABOVE_THRESHOLD" });
    expect(byId.get(p.wrQ.id)).toMatchObject({ eligibility: "ELIGIBLE", availabilityDesignationAtFreeze: "QUESTIONABLE", gameStatusAtFreeze: "POSTPONED" });
    expect(byId.get(p.wrBye.id)).toMatchObject({ exclusionReason: "BYE", isByeAtFreeze: true });
    expect(byId.get(p.wrOverride.id)).toMatchObject({ eligibility: "ELIGIBLE" });
    expect(byId.get(p.wrOverride.id)?.availabilitySourceAtFreeze).toContain("|OVERRIDE");
    expect(byId.get(p.te.id)).toMatchObject({ teamConflict: true, teamAtFreeze: "LV", sourceTeam: "SF", eligibility: "ELIGIBLE" });
    expect(byId.get(p.teNoRoster.id)).toMatchObject({ exclusionReason: "NOT_ON_NFL_ROSTER" });
    expect(byId.get(p.def.id)).toMatchObject({ eligibility: "ELIGIBLE", inputLine: "Seattle D/ST | DST | SEA | 30" });
    expect(preview.requiredAcknowledgments).toContain("TEAM_CONFLICT");
    expect(preview.completeness.byPosition.find((row) => row.position === "QB")).toMatchObject({ rankingsPoolCount: 1, rankingsPoolObserved: 1 });
  });

  it("blocks unmatched and ambiguous rows against real records", async () => {
    const twinA = await f.addRosterPlayer({ position: "WR", team: "SF", label: "Twin Receiver" });
    await prisma.rankableEntry.create({
      data: { provider: "waivers-test", externalId: `${f.suffix}-twin-dup`, type: "PLAYER", name: twinA.name, shortName: twinA.name, team: "SF", position: "WR" },
    });
    const preview = await previewWaiverSnapshot({
      weekId,
      rawText: [line(twinA, "4"), `Nobody ${f.suffix} | WR | SF | 4`].join("\n"),
      sourceLabel: "Sleeper",
      sourceUrl: null,
      observedAt: new Date(Date.now() - 60_000),
    });
    expect(preview.rows.map((row) => row.state)).toEqual(["AMBIGUOUS", "UNMATCHED"]);
    expect(preview.rows[0].candidates).toHaveLength(2);
    const resolved = await previewWaiverSnapshot({
      weekId,
      rawText: `${line(twinA, "4")} | ${twinA.id}`,
      sourceLabel: "Sleeper",
      sourceUrl: null,
      observedAt: new Date(Date.now() - 60_000),
    });
    expect(resolved.rows[0]).toMatchObject({ state: "MATCHED" });
    expect(resolved.entries[0]).toMatchObject({ rankableEntryId: twinA.id, matchMethod: "ADMIN_CONFIRMED" });
    await prisma.rankableEntry.deleteMany({ where: { externalId: `${f.suffix}-twin-dup` } });
  });

  it("transaction-scoped availability matches loadResolvedStatusesForWeek", async () => {
    const ids = [p.qb.id, p.rbOut.id, p.rbIr.id, p.wrQ.id, p.wrOverride.id, p.teNoRoster.id];
    const games = await loadWaiverWeekGames(prisma, weekId);
    const inTx = await prisma.$transaction(async (tx) => loadWaiverEntryFacts(tx, { weekId, seasonId: f.seasonId, rankableEntryIds: ids, games }));
    const reference = await loadResolvedStatusesForWeek({ weekId, rankableEntryIds: ids, seasonId: f.seasonId });
    for (const id of ids) {
      const ours = inTx.get(id)!.availability;
      const theirs = reference.get(id)!;
      expect({ designation: ours.designation, selectable: ours.selectable, rosterStatus: ours.rosterStatus, reason: ours.unavailableReason }).toEqual({
        designation: theirs.designation,
        selectable: theirs.selectable,
        rosterStatus: theirs.rosterStatus,
        reason: theirs.unavailableReason,
      });
    }
  });
});

describe("tracked follow-ups", () => {
  it("a player called on a locked earlier board is tracked: ≥50% is FOLLOW_UP evidence, absence needs acknowledgment", async () => {
    const g = await createWaiverFixture("pvt");
    try {
      await g.markRosterSynced();
      const week1 = await g.addWeek();
      const called = await g.addRosterPlayer({ position: "WR", team: "SF", label: "Tracked Riser" });
      const calledMissing = await g.addRosterPlayer({ position: "WR", team: "SEA", label: "Tracked Absent" });
      const snapshot = await g.freezeSnapshot({ weekId: week1.weekId, rows: [{ player: called, rosteredBps: 1100 }, { player: calledMissing, rosteredBps: 2400 }] });
      const contest = await g.createContest({ weekId: week1.weekId, snapshotId: snapshot.id, position: "WR" });
      const user = await g.addParticipant("tracker");
      await submitWaiverBoard({ contestId: contest.id, universalProfileId: user.profileId, userId: user.userId, playerIds: [called.id, calledMissing.id] });
      await g.passLock(contest.id);

      const week2 = await g.addWeek();
      const preview = await previewWaiverSnapshot({
        weekId: week2.weekId,
        rawText: line(called, "67"),
        sourceLabel: "Sleeper",
        sourceUrl: null,
        observedAt: new Date(Date.now() - 60_000),
      });
      expect(preview.entries[0]).toMatchObject({ rankableEntryId: called.id, evidenceRole: "FOLLOW_UP", eligibility: "OBSERVATION_ONLY", tracked: true });
      expect(preview.missingFollowUps).toEqual([
        expect.objectContaining({ rankableEntryId: calledMissing.id, lastObservedBps: 2400, lastObservedWeekNumber: 1 }),
      ]);
      expect(preview.requiredAcknowledgments).toContain("MISSING_FOLLOW_UP");
      expect(preview.blockers).toEqual([]);
    } finally {
      await g.cleanup();
    }
  });
});
