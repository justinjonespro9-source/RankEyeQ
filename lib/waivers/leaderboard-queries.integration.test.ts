import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, type FixturePlayer, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadFinalWaiverBoards } from "@/lib/waivers/corrections";
import { inauguralWaiverWeek, waiverLeaderboardWeekOptions } from "@/lib/waivers/leaderboard-model";
import { loadGradedWaiverBoards, loadWaiverLeaderboardWeeks } from "@/lib/waivers/leaderboard-queries";
import { saveWaiverDraft, submitWaiverBoard } from "@/lib/waivers/submissions";

let f: WaiverFixture;
let qb: FixturePlayer[];

beforeAll(async () => {
  f = await createWaiverFixture("lb");
  qb = await f.addPlayers("QB", 4);
});

afterAll(async () => {
  await f?.cleanup();
});

/** Fixture weeks are test weeks; the leaderboard only reads official ones. */
async function officialWeek() {
  const week = await f.addWeek();
  await prisma.week.update({ where: { id: week.weekId }, data: { isTest: false } });
  return week;
}

describe("Waivers leaderboard queries (read-only)", () => {
  it("10 / 11 / 12 / 15: only weeks with Waiver contests count, drafts never compete, and nothing is graded", async () => {
    const rankingsOnly = await officialWeek();
    const inaugural = await officialWeek();
    const snapshot = await f.freezeSnapshot({ weekId: inaugural.weekId, rows: qb.map((player) => ({ player })) });
    const contest = await f.createContest({ weekId: inaugural.weekId, snapshotId: snapshot.id, position: "QB", locksInMs: 60 * 60_000 });

    const caller = await f.addParticipant("lb_caller");
    const abstainer = await f.addParticipant("lb_abstain");
    const drafter = await f.addParticipant("lb_draft");
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: caller.profileId, userId: caller.userId, playerIds: [qb[0].id, qb[1].id] });
    await submitWaiverBoard({ contestId: contest.id, universalProfileId: abstainer.profileId, userId: abstainer.userId, playerIds: [] });
    await saveWaiverDraft({ contestId: contest.id, universalProfileId: drafter.profileId, userId: drafter.userId, playerIds: [qb[2].id] });

    const options = waiverLeaderboardWeekOptions(await loadWaiverLeaderboardWeeks(f.seasonId));
    expect(options.map((w) => w.id)).toEqual([inaugural.weekId]);
    expect(options.map((w) => w.id)).not.toContain(rankingsOnly.weekId);
    expect(inauguralWaiverWeek(options)?.id).toBe(inaugural.weekId);
    expect(options[0].contests.map((c) => c.position)).toEqual(["QB"]);

    const locksAt = await f.passLock(contest.id);
    const finals = await loadFinalWaiverBoards(prisma, { contestId: contest.id, locksAt });
    const owners = await prisma.waiverSubmission.findMany({
      where: { id: { in: finals.map((b) => b.submissionId) } },
      select: { universalProfileId: true },
    });
    expect(owners.map((o) => o.universalProfileId).sort()).toEqual([caller.profileId, abstainer.profileId].sort());
    expect(finals.map((b) => b.calls.length).sort()).toEqual([0, 2]);

    expect(await loadGradedWaiverBoards([inaugural.weekId, rankingsOnly.weekId])).toEqual([]);
  });
});
