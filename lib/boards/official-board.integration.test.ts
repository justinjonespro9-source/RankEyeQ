import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateWeekTiming } from "@/lib/admin/weeks";
import { captureBenchmarkSnapshot } from "@/lib/benchmarks/snapshots";
import {
  OFFICIAL_BOARD_CLAIM_BLOCKED_MESSAGE,
  OFFICIAL_BOARD_INCOMPLETE_MESSAGE,
  OFFICIAL_BOARD_LOCKED_MESSAGE,
  OFFICIAL_BOARD_NOT_OWNER_MESSAGE,
  ensureOfficialBoardFinalsForContest,
  getOwnerOfficialBoardStatus,
  officialBoardFingerprint,
  publishOfficialBoard,
} from "@/lib/boards/official-board";
import { getCompetitiveResume } from "@/lib/competitive-resume-data";
import { createCreatorCompetitor } from "@/lib/creator-identity";
import { approveCreatorClaimLink } from "@/lib/creator-verification";
import { prisma } from "@/lib/db";
import { gradeContest } from "@/lib/grading";
import { getWeeklyLeaderboard } from "@/lib/leaderboards";
import { getPublicProfileBoard } from "@/lib/public-board";
import { saveSubmissionPicks, submitRanking } from "@/lib/submissions";
import {
  ensureWeekFullLock,
  healPrematureWeekLocks,
} from "@/lib/timing/apply-locks";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";
import {
  createWeeklyContent,
  deleteWeeklyContent,
  updateWeeklyContent,
} from "@/lib/weekly-content";

const suffix = `obv${Date.now().toString(36)}`;
const seasonYear = 3700 + (Date.now() % 90);
const thursdayKickoff = zonedLocalToUtc(2099, 10, 8, 19, 15);
const sundayKickoff = zonedLocalToUtc(2099, 10, 11, 12, 0);
const timing = computeNflTimingWindows(thursdayKickoff, sundayKickoff);
const before = zonedLocalToUtc(2099, 10, 8, 12, 0);
const afterLock = new Date(timing.fullLockAt.getTime() + 60_000);
const stranger = { profileId: null, isAdmin: false };
const admin = { profileId: null, isAdmin: true };

describe("Official RankEyeQ Boards V1", () => {
  let seasonId = "";
  let weekId = "";
  let laterWeekId = "";
  let rbId = "";
  let adminUserId = "";
  const rb: string[] = [];
  const profileIds: string[] = [];
  const userIds: string[] = [];
  const p = {
    human: { id: "", username: "", userId: "" },
    human2: { id: "", username: "", userId: "" },
    other: { id: "", username: "", userId: "" },
    creatorOwner: { id: "", username: "", userId: "" },
    claimant: { id: "", username: "", userId: "" },
    creatorTracked: { id: "", username: "" },
    creatorCapturedLinked: { id: "", username: "", userId: "" },
    claimTarget: { id: "", username: "" },
    expert: { id: "", username: "" },
    expertClaimed: { id: "", username: "", userId: "" },
    ai: { id: "", username: "", userId: "" },
  };
  let v1Snapshot: unknown = null;

  async function profile(profileType: "HUMAN" | "BENCHMARK" | "AI", key: string) {
    const username = `${key}_${suffix}`.slice(0, 30);
    const row = await prisma.universalProfile.create({
      data: { username, displayName: key, profileType },
    });
    profileIds.push(row.id);
    return { id: row.id, username };
  }
  async function creator(key: string) {
    const row = await createCreatorCompetitor({
      personName: `${key} ${suffix}`,
      brandName: `${key} Channel`,
      username: `${key}_${suffix}`.slice(0, 30),
    });
    profileIds.push(row.id);
    return { id: row.id, username: row.username };
  }
  async function linkUser(profileId: string, key: string) {
    const user = await prisma.user.create({
      data: { email: `${key}-${suffix}@rankiq.local`, universalProfileId: profileId },
    });
    userIds.push(user.id);
    return user.id;
  }
  function capture(profileId: string, entryIds: string[]) {
    return captureBenchmarkSnapshot({
      contestId: rbId,
      universalProfileId: profileId,
      adminUserId,
      captureType: "MANUAL_FINAL",
      capturedAt: before,
      sourceUrl: `https://example.com/rankings/${profileId}`,
      picks: entryIds.map((rankableEntryId, index) => ({
        sourceRank: index + 1,
        rawName: `Player ${index + 1}`,
        rankableEntryId,
        rankIqRank: index + 1,
        excluded: false,
        exclusionReason: null,
        issue: null,
        selected: true,
      })),
      commitOfficial: true,
    });
  }
  function submit(profileId: string, entryIds: (string | null)[], now = before) {
    return submitRanking({
      contestId: rbId,
      universalProfileId: profileId,
      rankedEntryIds: entryIds,
      authority: "OWNER_AUTHORED",
      now,
    });
  }
  function view(
    username: string,
    now: Date,
    viewer: { profileId: string | null; isAdmin: boolean } = stranger,
    year: number = seasonYear,
  ) {
    return getPublicProfileBoard({
      username,
      weekNumber: 1,
      position: "RB",
      viewer,
      seasonYear: year,
      now,
    });
  }
  async function submissionFor(profileId: string) {
    return prisma.rankingSubmission.findUniqueOrThrow({
      where: { contestId_universalProfileId: { contestId: rbId, universalProfileId: profileId } },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });
  }
  async function versionsFor(profileId: string) {
    const submission = await submissionFor(profileId);
    return prisma.officialBoardVersion.findMany({
      where: { submissionId: submission.id },
      include: { picks: { orderBy: { boardRank: "asc" } } },
      orderBy: [{ kind: "asc" }, { versionNumber: "asc" }],
    });
  }
  /** Every competitive field on the contest's submissions and picks. */
  async function competitiveSnapshot() {
    const rows = await prisma.rankingSubmission.findMany({
      where: { contestId: rbId },
      orderBy: { universalProfileId: "asc" },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });
    return JSON.stringify(
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        authority: row.authority,
        lockedAt: row.lockedAt,
        rawScore: row.rawScore,
        normalizedScore: row.normalizedScore,
        picks: row.picks.map((pick) => ({
          rankableEntryId: pick.rankableEntryId,
          predictedRank: pick.predictedRank,
          slotLocked: pick.slotLocked,
          lockedAt: pick.lockedAt,
          lockedRank: pick.lockedRank,
          committedAt: pick.committedAt,
          wasUnavailableAtKickoff: pick.wasUnavailableAtKickoff,
          reserveEligiblePredecessorIds: pick.reserveEligiblePredecessorIds,
          totalPoints: pick.totalPoints,
          actualRank: pick.actualRank,
        })),
      })),
    );
  }

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: seasonYear, sport: "NFL", active: false },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Official Board Week",
        startsAt: thursdayKickoff,
        endsAt: sundayKickoff,
        status: "OPEN",
        isTest: true,
        rankingsOpenAt: timing.rankingsOpenAt,
        fullLockAt: timing.fullLockAt,
        revealStartsAt: timing.revealStartsAt,
        publicReleaseAt: timing.publicReleaseAt,
      },
    });
    weekId = week.id;
    laterWeekId = (
      await prisma.week.create({
        data: {
          seasonId,
          weekNumber: 2,
          label: "Official Board Week 2",
          startsAt: new Date(thursdayKickoff.getTime() + 7 * 86_400_000),
          endsAt: new Date(sundayKickoff.getTime() + 7 * 86_400_000),
          status: "UPCOMING",
          isTest: true,
        },
      })
    ).id;
    const game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `obv-game-${suffix}`,
        seasonId,
        weekId,
        seasonYear,
        weekNumber: 1,
        homeTeam: "OPP",
        awayTeam: "TST",
        startsAt: sundayKickoff,
      },
    });
    rbId = (
      await prisma.rankIQContest.create({
        data: {
          seasonId,
          weekId,
          position: "RB",
          title: "Official Board RB",
          rankingDepth: 10,
          reserveCount: 2,
          status: "OPEN",
        },
      })
    ).id;
    for (let i = 1; i <= 14; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `obv-${suffix}-RB-${i}`,
          type: "PLAYER",
          name: `RB Player ${i}`,
          shortName: `RB${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "RB",
          gameStartsAt: sundayKickoff,
          gameId: game.id,
        },
      });
      await prisma.contestEntry.create({
        data: { contestId: rbId, rankableEntryId: entry.id, gameId: game.id, weekTeam: "TST" },
      });
      rb.push(entry.id);
    }

    const adminUser = await prisma.user.create({
      data: { email: `obv-admin-${suffix}@rankiq.local`, role: "ADMIN" },
    });
    adminUserId = adminUser.id;
    userIds.push(adminUserId);

    for (const key of ["human", "human2", "other", "claimant"] as const) {
      const row = await profile("HUMAN", key);
      p[key] = { ...row, userId: await linkUser(row.id, key) };
    }
    const creatorOwner = await creator("crowner");
    p.creatorOwner = { ...creatorOwner, userId: await linkUser(creatorOwner.id, "crowner") };
    p.creatorTracked = await creator("crtracked");
    p.claimTarget = await creator("crtarget");
    const capturedLinked = await creator("crcaplink");
    p.expert = await profile("BENCHMARK", "expert");
    const expertClaimed = await profile("BENCHMARK", "expertcl");
    const ai = await profile("AI", "aibot");

    // Captured boards exist before any account is linked (owner-managed capture is refused).
    for (const id of [p.creatorTracked.id, p.claimTarget.id, capturedLinked.id, p.expert.id, expertClaimed.id]) {
      expect((await capture(id, rb.slice(0, 10))).official).toBe(true);
    }
    p.creatorCapturedLinked = { ...capturedLinked, userId: await linkUser(capturedLinked.id, "crcaplink") };
    p.expertClaimed = { ...expertClaimed, userId: await linkUser(expertClaimed.id, "expertcl") };

    await submitRanking({
      contestId: rbId,
      universalProfileId: ai.id,
      rankedEntryIds: rb.slice(0, 12),
      authority: "SYSTEM_OPERATED",
      now: before,
    });
    p.ai = { ...ai, userId: await linkUser(ai.id, "aibot") };

    await submit(p.human.id, rb.slice(0, 12));
    await submit(p.human2.id, rb.slice(2, 14));
    await submit(p.creatorOwner.id, [...rb.slice(1, 12), rb[0]!]);
    await submit(p.claimant.id, rb.slice(0, 12));
    await saveSubmissionPicks({
      contestId: rbId,
      universalProfileId: p.other.id,
      rankedEntryIds: rb.slice(0, 5),
      authority: "OWNER_AUTHORED",
      requireComplete: false,
      now: before,
    });
    await prisma.creatorCompetitorProfile.create({
      data: {
        universalProfileId: p.claimant.id,
        claimStatus: "REQUESTED",
        claimRequestedAt: before,
        claimTargetProfileId: p.claimTarget.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.officialBoardPublication.deleteMany({ where: { contestId: rbId } });
    await prisma.officialBoardVersion.deleteMany({ where: { contestId: rbId } });
    await prisma.weeklyContent.deleteMany({ where: { profileId: { in: profileIds } } });
    await prisma.boardUnlockEvent.deleteMany({ where: { contestId: rbId } });
    await prisma.rankingPick.deleteMany({ where: { submission: { contestId: rbId } } });
    await prisma.rankingSubmission.deleteMany({ where: { contestId: rbId } });
    await prisma.benchmarkSnapshotPick.deleteMany({ where: { snapshot: { weekId } } });
    await prisma.benchmarkSnapshot.deleteMany({ where: { weekId } });
    await prisma.contestPregameSnapshot.deleteMany({ where: { contestId: rbId } });
    await prisma.contestEntry.deleteMany({ where: { contestId: rbId } });
    await prisma.rankIQContest.deleteMany({ where: { id: rbId } });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.universalProfile.updateMany({
      where: { id: { in: profileIds } },
      data: { publicFromWeekId: null },
    });
    await prisma.week.deleteMany({ where: { seasonId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.rankableEntry.deleteMany({ where: { externalId: { startsWith: `obv-${suffix}-` } } });
    await prisma.creatorCompetitorProfile.deleteMany({ where: { universalProfileId: { in: profileIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.universalProfile.deleteMany({ where: { id: { in: profileIds } } });
  });

  it("1 + 8: HUMAN publish creates an immutable PUBLISHED version of the live board", async () => {
    const result = await publishOfficialBoard({ userId: p.human.userId, contestId: rbId, now: before });
    expect(result).toEqual({ outcome: "published", versionNumber: 1 });

    const live = await submissionFor(p.human.id);
    const [version] = await versionsFor(p.human.id);
    expect(version).toMatchObject({
      kind: "PUBLISHED",
      versionNumber: 1,
      authorUserId: p.human.userId,
      profileId: p.human.id,
      rankingDepth: 10,
      reserveCount: 2,
      boardLockedAt: null,
      fingerprint: officialBoardFingerprint({ rankingDepth: 10, reserveCount: 2, picks: live.picks }),
    });
    expect(version!.picks.map((pick) => [pick.boardRank, pick.rankableEntryId])).toEqual(
      live.picks.map((pick) => [pick.predictedRank, pick.rankableEntryId]),
    );
    expect(version!.picks.filter((pick) => pick.isReserve).map((pick) => pick.reserveSlot)).toEqual([1, 2]);
    expect(version!.picks[0]).toMatchObject({ displayName: "RB Player 1", displayTeam: "TST" });
    v1Snapshot = JSON.parse(JSON.stringify(version));

    const publication = await prisma.officialBoardPublication.findUniqueOrThrow({
      where: { submissionId: live.id },
    });
    expect(publication).toMatchObject({ latestPublishedVersionId: version!.id, profileId: p.human.id });
  });

  it("2: owner-managed CREATOR can publish", async () => {
    const result = await publishOfficialBoard({ userId: p.creatorOwner.userId, contestId: rbId, now: before });
    expect(result).toEqual({ outcome: "published", versionNumber: 1 });
  });

  it("3 + 4 + 5 + 6: other users, BENCHMARK, captured Creator and AI cannot publish", async () => {
    for (const userId of [p.expertClaimed.userId, p.creatorCapturedLinked.userId, p.ai.userId]) {
      await expect(publishOfficialBoard({ userId, contestId: rbId, now: before })).rejects.toThrow(
        OFFICIAL_BOARD_NOT_OWNER_MESSAGE,
      );
    }
    // A user with no board on the contest cannot reach anyone else's board.
    const lonely = await profile("HUMAN", "lonely");
    const lonelyUser = await linkUser(lonely.id, "lonely");
    await expect(publishOfficialBoard({ userId: lonelyUser, contestId: rbId, now: before })).rejects.toThrow(
      OFFICIAL_BOARD_NOT_OWNER_MESSAGE,
    );
    // Incomplete owner board is refused, and the owner panel explains why.
    await expect(publishOfficialBoard({ userId: p.other.userId, contestId: rbId, now: before })).rejects.toThrow(
      OFFICIAL_BOARD_INCOMPLETE_MESSAGE,
    );
    expect(
      await getOwnerOfficialBoardStatus({ profileId: p.other.id, profileType: "HUMAN", contestId: rbId, now: before }),
    ).toEqual({ state: "PROTECTED", canPublish: false, blockedReason: OFFICIAL_BOARD_INCOMPLETE_MESSAGE });
    for (const id of [p.expertClaimed.id, p.creatorCapturedLinked.id, p.ai.id, p.creatorTracked.id]) {
      expect(await prisma.officialBoardVersion.count({ where: { profileId: id } })).toBe(0);
    }
    expect(await prisma.officialBoardPublication.count({ where: { profileId: p.human2.id } })).toBe(0);
  });

  it("9 + 14 + 17: public reads the published version (Top N only, no live-derived data, no unlock)", async () => {
    const board = await view(p.human.username, before, { profileId: p.other.id, isAdmin: false });
    expect(board?.allowed).toBe(true);
    expect(board?.officialBoard?.stage).toBe("PUBLISHED");
    expect(board?.officialBoard?.publishedVersionNumber).toBe(1);
    expect(board?.picks.map((pick) => pick.rankableEntryId)).toEqual(rb.slice(0, 10));
    expect(board?.picks.every((pick) => pick.predictedRank <= 10)).toBe(true);
    expect(board?.reservePicks).toEqual([]);
    expect(board?.liveEyeq).toBeNull();
    expect(board?.ownerPreview).toBe(false);
    expect(await prisma.boardUnlockEvent.count({ where: { contestId: rbId } })).toBe(0);
  });

  it("16 + 27: a protected board stays protected; weekly content still shows", async () => {
    await createWeeklyContent({
      userId: p.human2.userId,
      weekId,
      content: { title: "Watch my Week 1 breakdown", url: "https://youtube.com/watch?v=abc", type: "VIDEO", position: "RB" },
    });
    const board = await view(p.human2.username, before);
    expect(board?.allowed).toBe(false);
    expect(board?.picks).toEqual([]);
    expect(board?.officialBoard?.stage).toBe("PROTECTED");
    expect(board?.weeklyContent.map((item) => item.title)).toEqual(["Watch my Week 1 breakdown"]);
  });

  it("10: owner edits after publish stay private", async () => {
    const edited = [rb[1]!, rb[0]!, ...rb.slice(2, 12)];
    await saveSubmissionPicks({
      contestId: rbId,
      universalProfileId: p.human.id,
      rankedEntryIds: edited,
      authority: "OWNER_AUTHORED",
      now: before,
    });
    expect((await submissionFor(p.human.id)).status).toBe("SUBMITTED");
    const publicBoard = await view(p.human.username, before);
    expect(publicBoard?.picks[0]?.rankableEntryId).toBe(rb[0]);
    const ownerBoard = await view(p.human.username, before, { profileId: p.human.id, isAdmin: false });
    expect(ownerBoard?.ownerPreview).toBe(true);
    expect(ownerBoard?.picks[0]?.rankableEntryId).toBe(rb[1]);
    expect(
      await getOwnerOfficialBoardStatus({ profileId: p.human.id, profileType: "HUMAN", contestId: rbId, now: before }),
    ).toMatchObject({ state: "PUBLISHED", versionNumber: 1, hasPendingChanges: true, canUpdate: true });
  });

  it("11 + 13 + 24: update creates the next version; earlier versions and competitive fields unchanged", async () => {
    const competitiveBefore = await competitiveSnapshot();
    const result = await publishOfficialBoard({ userId: p.human.userId, contestId: rbId, now: before });
    expect(result).toEqual({ outcome: "updated", versionNumber: 2 });
    expect(await competitiveSnapshot()).toBe(competitiveBefore);

    const versions = await versionsFor(p.human.id);
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
    expect(JSON.parse(JSON.stringify(versions[0]))).toEqual(v1Snapshot);
    const publicBoard = await view(p.human.username, before);
    expect(publicBoard?.officialBoard?.publishedVersionNumber).toBe(2);
    expect(publicBoard?.picks[0]?.rankableEntryId).toBe(rb[1]);
  });

  it("12: a no-change update creates no version", async () => {
    const result = await publishOfficialBoard({ userId: p.human.userId, contestId: rbId, now: before });
    expect(result).toEqual({ outcome: "unchanged", versionNumber: 2 });
    const again = await publishOfficialBoard({ userId: p.human.userId, contestId: rbId, now: before });
    expect(again.outcome).toBe("unchanged");
    expect((await versionsFor(p.human.id)).length).toBe(2);
    expect(
      await getOwnerOfficialBoardStatus({ profileId: p.human.id, profileType: "HUMAN", contestId: rbId, now: before }),
    ).toMatchObject({ state: "PUBLISHED", hasPendingChanges: false, canUpdate: false });
  });

  it("15 + 18 + 19: full lock blocks updates and captures FINAL for protected and published boards", async () => {
    // A private edit after the last publish: FINAL must be what competed, not v2.
    await saveSubmissionPicks({
      contestId: rbId,
      universalProfileId: p.human.id,
      rankedEntryIds: [rb[1]!, rb[0]!, rb[3]!, rb[2]!, ...rb.slice(4, 12)],
      authority: "OWNER_AUTHORED",
      now: before,
    });
    await ensureWeekFullLock(weekId, afterLock);

    await expect(publishOfficialBoard({ userId: p.human.userId, contestId: rbId, now: afterLock })).rejects.toThrow(
      OFFICIAL_BOARD_LOCKED_MESSAGE,
    );
    expect(
      await getOwnerOfficialBoardStatus({ profileId: p.human.id, profileType: "HUMAN", contestId: rbId, now: afterLock }),
    ).toEqual({ state: "LOCKED", publishedVersionNumber: 2 });

    const live = await submissionFor(p.human.id);
    expect(live.status).toBe("LOCKED");
    const final = (await versionsFor(p.human.id)).find((version) => version.kind === "FINAL");
    const v2 = (await versionsFor(p.human.id)).find((version) => version.versionNumber === 2 && version.kind === "PUBLISHED");
    expect(final).toMatchObject({
      versionNumber: 1,
      authorUserId: null,
      boardLockedAt: timing.fullLockAt,
      fingerprint: officialBoardFingerprint({ rankingDepth: 10, reserveCount: 2, picks: live.picks }),
    });
    expect(final!.fingerprint).not.toBe(v2!.fingerprint);

    const protectedFinal = (await versionsFor(p.human2.id)).filter((version) => version.kind === "FINAL");
    expect(protectedFinal).toHaveLength(1);
    expect(await prisma.officialBoardPublication.count({ where: { profileId: p.human2.id } })).toBe(0);
    for (const id of [p.creatorOwner.id, p.claimant.id]) {
      expect((await versionsFor(id)).filter((version) => version.kind === "FINAL")).toHaveLength(1);
    }
    // Incomplete DRAFT never competed; captured and AI boards never get FINAL.
    for (const id of [p.other.id, p.expert.id, p.expertClaimed.id, p.creatorTracked.id, p.creatorCapturedLinked.id, p.ai.id]) {
      expect(await prisma.officialBoardVersion.count({ where: { profileId: id, kind: "FINAL" } })).toBe(0);
    }

    const publicBoard = await view(p.human.username, afterLock);
    expect(publicBoard?.officialBoard?.stage).toBe("FINAL");
    expect(publicBoard?.picks.map((pick) => pick.rankableEntryId)).toEqual(live.picks.slice(0, 10).map((pick) => pick.rankableEntryId));
    expect(publicBoard?.reservePicks.map((pick) => [pick.reserveSlot, pick.rankableEntryId])).toEqual([
      [1, rb[10]],
      [2, rb[11]],
    ]);
    const protectedBoard = await view(p.human2.username, afterLock);
    expect(protectedBoard?.allowed).toBe(true);
    expect(protectedBoard?.officialBoard?.stage).toBe("FINAL");
  });

  it("20: FINAL is idempotent and the database refuses a second FINAL", async () => {
    await ensureWeekFullLock(weekId, afterLock);
    const again = await ensureOfficialBoardFinalsForContest(rbId, afterLock);
    expect(again.created).toBe(0);
    expect(again.existing).toBe(4);
    expect(
      (await ensureOfficialBoardFinalsForContest(rbId, afterLock, { finalsStartAt: new Date("2100-01-01T00:00:00Z") }))
        .skipped,
    ).toBe("before_finals_start");

    const live = await submissionFor(p.human.id);
    const duplicate = {
      submissionId: live.id,
      contestId: rbId,
      profileId: p.human.id,
      kind: "FINAL" as const,
      rankingDepth: 10,
      reserveCount: 2,
      fingerprint: "dup",
    };
    await expect(prisma.officialBoardVersion.create({ data: { ...duplicate, versionNumber: 1 } })).rejects.toThrow();
    await expect(prisma.officialBoardVersion.create({ data: { ...duplicate, versionNumber: 2 } })).rejects.toThrow();
    expect(await prisma.officialBoardVersion.count({ where: { submissionId: live.id, kind: "FINAL" } })).toBe(1);
  });

  it("25 + 26 + 34: captured Expert / Creator provenance and source rights are unchanged", async () => {
    // Tracked profiles are not publicly authorized in this fixture; admin sees the same board.
    for (const username of [p.expert.username, p.creatorTracked.username]) {
      const board = await view(username, afterLock, admin);
      expect(board?.officialBoard).toBeNull();
      expect(board?.captureAttribution).toBe("Source ranking captured by RankEYEQ");
      expect(board?.weeklySourceUrl).toMatch(/^https:\/\/example\.com\/rankings\//);
      expect(board?.picks).toHaveLength(10);
    }
    const snapshot = await prisma.benchmarkSnapshot.findFirstOrThrow({
      where: { universalProfileId: p.expert.id, contestId: rbId },
      orderBy: { createdAt: "desc" },
    });
    await prisma.benchmarkSnapshot.update({ where: { id: snapshot.id }, data: { publicBoardAllowed: false } });
    try {
      const restricted = await view(p.expert.username, afterLock, admin);
      expect(restricted?.publicBoardRestricted).toBe(true);
      expect(restricted?.picks).toEqual([]);
    } finally {
      await prisma.benchmarkSnapshot.update({ where: { id: snapshot.id }, data: { publicBoardAllowed: true } });
    }
    const ai = await view(p.ai.username, afterLock, admin);
    expect(ai?.officialBoard).toBeNull();
    expect(ai?.captureAttribution).toBeNull();
  });

  it("heal + timing guard: a week with FINAL receipts is never reopened", async () => {
    const later = new Date(afterLock.getTime() + 86_400_000);
    await expect(updateWeekTiming({ weekId, fullLockAt: later })).rejects.toThrow(
      "This week already has FINAL Official Board receipts",
    );
    await prisma.week.update({ where: { id: weekId }, data: { fullLockAt: later } });
    try {
      const healed = await healPrematureWeekLocks(weekId, afterLock);
      expect(healed.reopenedContests).toBe(0);
      expect(healed.reopenedSubmissions).toBe(0);
      expect((await prisma.rankIQContest.findUniqueOrThrow({ where: { id: rbId } })).status).toBe("LOCKED");
      expect((await submissionFor(p.human.id)).status).toBe("LOCKED");
    } finally {
      await prisma.week.update({ where: { id: weekId }, data: { fullLockAt: timing.fullLockAt } });
    }
  });

  it("claim guard: approval that would delete a board with versions is refused", async () => {
    await expect(
      approveCreatorClaimLink({
        requestingProfileId: p.claimant.id,
        targetCreatorProfileId: p.claimTarget.id,
        adminUserId,
      }),
    ).rejects.toThrow(OFFICIAL_BOARD_CLAIM_BLOCKED_MESSAGE);
    expect((await submissionFor(p.claimant.id)).universalProfileId).toBe(p.claimant.id);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: p.claimant.userId } });
    expect(user.universalProfileId).toBe(p.claimant.id);
  });

  it("28 + 29 + 31: weekly content is owner-only and never touches competitive data after lock", async () => {
    const competitiveBefore = await competitiveSnapshot();
    const versionsBefore = await prisma.officialBoardVersion.count({ where: { contestId: rbId } });

    const humanItem = await createWeeklyContent({
      userId: p.human.userId,
      weekId,
      content: { title: "Week 1 article", url: "https://example.com/article", type: "ARTICLE" },
    });
    const creatorItem = await createWeeklyContent({
      userId: p.creatorOwner.userId,
      weekId,
      content: { title: "Podcast", url: "https://example.com/pod", type: "PODCAST", position: "rb" },
    });
    expect(humanItem.profileId).toBe(p.human.id);
    expect(creatorItem).toMatchObject({ profileId: p.creatorOwner.id, position: "RB" });
    await updateWeeklyContent({
      userId: p.human.userId,
      id: humanItem.id,
      content: { title: "Week 1 article (updated)", url: "https://example.com/article-2", type: "ARTICLE" },
    });

    await expect(
      updateWeeklyContent({
        userId: p.human2.userId,
        id: humanItem.id,
        content: { title: "hijack", url: "https://evil.example.com", type: "OTHER" },
      }),
    ).rejects.toThrow("Weekly content not found.");
    await expect(deleteWeeklyContent({ userId: p.human2.userId, id: humanItem.id })).rejects.toThrow(
      "Weekly content not found.",
    );
    for (const userId of [p.expertClaimed.userId, p.ai.userId]) {
      await expect(
        createWeeklyContent({
          userId,
          weekId,
          content: { title: "x", url: "https://example.com", type: "OTHER" },
        }),
      ).rejects.toThrow("Only ranking-workspace competitors can attach weekly content.");
    }

    expect(await competitiveSnapshot()).toBe(competitiveBefore);
    expect(await prisma.officialBoardVersion.count({ where: { contestId: rbId } })).toBe(versionsBefore);
    const board = await view(p.human.username, afterLock);
    expect(board?.weeklyContent.map((item) => item.title)).toEqual(["Week 1 article (updated)"]);
  });

  it("32 + 35: season-aware URLs and publicFromWeekId visibility still apply", async () => {
    expect(await view(p.human.username, afterLock)).not.toBeNull();
    expect(await view(p.human.username, afterLock, stranger, seasonYear + 500)).toBeNull();

    await prisma.universalProfile.update({ where: { id: p.human.id }, data: { publicFromWeekId: laterWeekId } });
    try {
      expect(await view(p.human.username, before)).toBeNull();
      expect(await view(p.human.username, afterLock)).toBeNull();
      expect(await view(p.human.username, afterLock, admin)).not.toBeNull();
    } finally {
      await prisma.universalProfile.update({ where: { id: p.human.id }, data: { publicFromWeekId: null } });
    }
  });

  it("21 + 22 + 23 + 33: grading, reserve promotion, leaderboards and résumé ignore version rows", async () => {
    for (let i = 0; i < rb.length; i += 1) {
      await prisma.contestEntry.update({
        where: { contestId_rankableEntryId: { contestId: rbId, rankableEntryId: rb[i]! } },
        data: { actualRank: i + 1, fantasyPoints: 30 - i },
      });
    }
    // Human's #1 is OUT (kickoff not reached in this fixture), so R1 is promoted.
    const human = await submissionFor(p.human.id);
    await prisma.rankableEntry.update({
      where: { id: human.picks[0]!.rankableEntryId },
      data: { availability: "OUT" },
    });

    const scores = async () =>
      JSON.stringify(
        (
          await prisma.rankingSubmission.findMany({
            where: { contestId: rbId },
            orderBy: { universalProfileId: "asc" },
            include: { picks: { orderBy: { predictedRank: "asc" } } },
          })
        ).map((row) => ({
          status: row.status,
          rawScore: row.rawScore,
          normalizedScore: row.normalizedScore,
          picks: row.picks.map((pick) => [pick.predictedRank, pick.totalPoints, pick.actualRank]),
        })),
      );
    const standings = async () =>
      JSON.stringify({
        weekly: await getWeeklyLeaderboard({ weekId, includeTest: true, minContests: 1 }),
        resume: await getCompetitiveResume({
          profileId: p.human.id,
          username: p.human.username,
          profileType: "HUMAN",
          expertSourceKind: null,
          includeTest: true,
        }),
      });

    await ensureOfficialBoardFinalsForContest(rbId, afterLock);
    await gradeContest(rbId);
    const withVersions = await scores();
    const standingsWithVersions = await standings();
    const graded = await submissionFor(p.human.id);
    expect(graded.picks.find((pick) => pick.predictedRank === 11)?.totalPoints).not.toBeNull();

    const scoringView = await view(p.human.username, afterLock);
    expect(scoringView?.officialBoard?.stage).toBe("SCORING");
    expect(scoringView?.showingStoredScoringBoard).toBe(true);
    expect((await ensureOfficialBoardFinalsForContest(rbId, afterLock)).skipped).toBe("historical_contest");

    // Tamper the FINAL receipt: grading must not notice.
    const final = await prisma.officialBoardVersion.findFirstOrThrow({
      where: { submissionId: graded.id, kind: "FINAL" },
    });
    await prisma.officialBoardVersionPick.deleteMany({ where: { boardVersionId: final.id } });
    await prisma.officialBoardVersionPick.createMany({
      data: [...rb].reverse().slice(0, 12).map((rankableEntryId, index) => ({
        boardVersionId: final.id,
        rankableEntryId,
        boardRank: index + 1,
        isReserve: index >= 10,
        displayName: "tampered",
        displayTeam: "XXX",
      })),
    });
    await gradeContest(rbId);
    expect(await scores()).toBe(withVersions);

    await prisma.officialBoardPublication.deleteMany({ where: { contestId: rbId } });
    await prisma.officialBoardVersion.deleteMany({ where: { contestId: rbId } });
    await gradeContest(rbId);
    expect(await scores()).toBe(withVersions);
    expect(await standings()).toBe(standingsWithVersions);
  });
});
