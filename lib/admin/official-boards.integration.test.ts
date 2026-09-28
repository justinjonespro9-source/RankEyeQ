import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const adminState: { ctx: unknown } = { ctx: null };
vi.mock("@/lib/auth/session", () => ({
  assertAdmin: async () => {
    if (!adminState.ctx) throw new Error("Admin access required");
    return adminState.ctx;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import * as officialBoardsActions from "@/lib/admin/official-boards-actions";
import {
  captureMissingOfficialBoardFinals,
  getContestFinalReadiness,
  getOfficialBoardAdminDetail,
  getOfficialBoardsWeekOps,
  previewMissingOfficialBoardFinals,
  restoreWeeklyContent,
  suppressWeeklyContent,
} from "@/lib/admin/official-boards";
import { getOpsDashboard } from "@/lib/admin/ops-dashboard";
import { gradeContestAction } from "@/lib/admin-actions";
import {
  OFFICIAL_BOARD_FINALS_START_AT,
  ensureOfficialBoardFinalsForContest,
  publishOfficialBoard,
} from "@/lib/boards/official-board";
import { prisma } from "@/lib/db";
import { getPublicProfileBoard } from "@/lib/public-board";
import { saveSubmissionPicks, submitRanking } from "@/lib/submissions";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";
import {
  createWeeklyContent,
  listWeeklyContent,
  updateWeeklyContent,
} from "@/lib/weekly-content";

const suffix = `oba${Date.now().toString(36)}`;
const seasonYear = 3900 + (Date.now() % 40);
const timing = computeNflTimingWindows(
  zonedLocalToUtc(2099, 10, 8, 19, 15),
  zonedLocalToUtc(2099, 10, 11, 12, 0),
);
const before = zonedLocalToUtc(2099, 10, 8, 12, 0);
const afterLock = new Date(timing.fullLockAt.getTime() + 60_000);
// Pre-activation week (like 2026 Weeks 1–3): locked before OFFICIAL_BOARD_FINALS_START_AT.
const preTiming = computeNflTimingWindows(
  zonedLocalToUtc(2026, 9, 17, 19, 15),
  zonedLocalToUtc(2026, 9, 20, 12, 0),
);
const preBefore = zonedLocalToUtc(2026, 9, 17, 12, 0);
const afterPreLock = new Date(preTiming.fullLockAt.getTime() + 60_000);

describe("Official Boards Admin Operations V1", () => {
  let seasonId = "";
  let weekId = "";
  let preWeekId = "";
  let rbId = "";
  let preRbId = "";
  let adminUserId = "";
  let nonAdminUserId = "";
  const rb: string[] = [];
  const profileIds: string[] = [];
  const userIds: string[] = [];
  const p = {
    humanA: { id: "", username: "", userId: "" },
    humanB: { id: "", username: "", userId: "" },
    drafter: { id: "", username: "", userId: "" },
  };
  const triggerName = `oba_fail_${suffix}`;

  async function createWeek(weekNumber: number, windows: typeof timing, status: "OPEN" | "LOCKED") {
    return prisma.week.create({
      data: {
        seasonId,
        weekNumber,
        label: `Admin Ops Week ${weekNumber}`,
        startsAt: windows.rankingsOpenAt,
        endsAt: windows.publicReleaseAt,
        status,
        isTest: true,
        rankingsOpenAt: windows.rankingsOpenAt,
        fullLockAt: windows.fullLockAt,
        revealStartsAt: windows.revealStartsAt,
        publicReleaseAt: windows.publicReleaseAt,
      },
    });
  }

  async function createContest(forWeekId: string, weekNumber: number, kickoff: Date) {
    const game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `oba-game-${suffix}-${weekNumber}`,
        seasonId,
        weekId: forWeekId,
        seasonYear,
        weekNumber,
        homeTeam: "OPP",
        awayTeam: "TST",
        startsAt: kickoff,
      },
    });
    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId: forWeekId,
        position: "RB",
        title: `Admin Ops RB ${weekNumber}`,
        rankingDepth: 10,
        reserveCount: 2,
        status: "OPEN",
      },
    });
    for (const entryId of rb) {
      await prisma.contestEntry.create({
        data: { contestId: contest.id, rankableEntryId: entryId, gameId: game.id, weekTeam: "TST" },
      });
    }
    return contest.id;
  }

  const contestIds = () => [rbId, preRbId];

  /** Every row the Official Boards admin surface could conceivably touch. */
  async function worldSnapshot() {
    return JSON.stringify({
      versions: await prisma.officialBoardVersion.findMany({
        where: { contestId: { in: contestIds() } },
        include: { picks: { orderBy: { boardRank: "asc" } } },
        orderBy: { id: "asc" },
      }),
      publications: await prisma.officialBoardPublication.findMany({
        where: { contestId: { in: contestIds() } },
        orderBy: { id: "asc" },
      }),
      submissions: await prisma.rankingSubmission.findMany({
        where: { contestId: { in: contestIds() } },
        include: { picks: { orderBy: { predictedRank: "asc" } } },
        orderBy: { id: "asc" },
      }),
      contests: await prisma.rankIQContest.findMany({
        where: { id: { in: contestIds() } },
        orderBy: { id: "asc" },
      }),
      weeks: await prisma.week.findMany({ where: { seasonId }, orderBy: { id: "asc" } }),
      content: await prisma.weeklyContent.findMany({
        where: { weekId: { in: [weekId, preWeekId] } },
        orderBy: { id: "asc" },
      }),
      audit: await prisma.adminAuditLog.count({ where: { adminUserId } }),
    });
  }

  /** Competitive truth + immutable board history (no moderation state). */
  async function historySnapshot() {
    const snapshot = JSON.parse(await worldSnapshot());
    return JSON.stringify({
      versions: snapshot.versions,
      publications: snapshot.publications,
      submissions: snapshot.submissions,
      contests: snapshot.contests,
    });
  }

  async function finalFor(profileId: string, contestId = rbId) {
    return prisma.officialBoardVersion.findFirst({
      where: { profileId, contestId, kind: "FINAL" },
      include: { picks: { orderBy: { boardRank: "asc" } } },
    });
  }

  beforeAll(async () => {
    seasonId = (
      await prisma.season.create({ data: { year: seasonYear, sport: "NFL", active: false } })
    ).id;
    weekId = (await createWeek(4, timing, "OPEN")).id;
    preWeekId = (await createWeek(3, preTiming, "OPEN")).id;
    for (let i = 1; i <= 14; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `oba-${suffix}-RB-${i}`,
          type: "PLAYER",
          name: `RB Player ${i}`,
          shortName: `RB${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "RB",
          gameStartsAt: timing.fullLockAt,
        },
      });
      rb.push(entry.id);
    }
    rbId = await createContest(weekId, 4, zonedLocalToUtc(2099, 10, 11, 12, 0));
    preRbId = await createContest(preWeekId, 3, zonedLocalToUtc(2026, 9, 20, 12, 0));

    adminUserId = (
      await prisma.user.create({ data: { email: `oba-admin-${suffix}@rankiq.local`, role: "ADMIN" } })
    ).id;
    nonAdminUserId = (
      await prisma.user.create({ data: { email: `oba-user-${suffix}@rankiq.local` } })
    ).id;
    userIds.push(adminUserId, nonAdminUserId);

    for (const key of ["humanA", "humanB", "drafter"] as const) {
      const username = `${key}_${suffix}`.slice(0, 30);
      const profile = await prisma.universalProfile.create({
        data: { username, displayName: key, profileType: "HUMAN" },
      });
      profileIds.push(profile.id);
      const user = await prisma.user.create({
        data: { email: `${key}-${suffix}@rankiq.local`, universalProfileId: profile.id },
      });
      userIds.push(user.id);
      p[key] = { id: profile.id, username, userId: user.id };
    }

    for (const [profileId, entries] of [
      [p.humanA.id, rb.slice(0, 12)],
      [p.humanB.id, rb.slice(2, 14)],
    ] as const) {
      await submitRanking({
        contestId: rbId,
        universalProfileId: profileId,
        rankedEntryIds: [...entries],
        authority: "OWNER_AUTHORED",
        now: before,
      });
      await submitRanking({
        contestId: preRbId,
        universalProfileId: profileId,
        rankedEntryIds: [...entries],
        authority: "OWNER_AUTHORED",
        now: preBefore,
      });
    }
    await saveSubmissionPicks({
      contestId: rbId,
      universalProfileId: p.drafter.id,
      rankedEntryIds: rb.slice(0, 4),
      authority: "OWNER_AUTHORED",
      requireComplete: false,
      now: before,
    });
    expect(
      (await publishOfficialBoard({ userId: p.humanA.userId, contestId: rbId, now: before })).outcome,
    ).toBe("published");
    // The pre-activation week is past its lock, like Week 3 (locked, never graded).
    await prisma.week.update({ where: { id: preWeekId }, data: { status: "LOCKED" } });
    await prisma.rankIQContest.update({ where: { id: preRbId }, data: { status: "LOCKED" } });
    await prisma.rankingSubmission.updateMany({
      where: { contestId: preRbId },
      data: { status: "LOCKED", lockedAt: preTiming.fullLockAt },
    });
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "OfficialBoardVersion"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${triggerName}"()`);
    await prisma.officialBoardPublication.deleteMany({ where: { contestId: { in: contestIds() } } });
    await prisma.officialBoardVersion.deleteMany({ where: { contestId: { in: contestIds() } } });
    await prisma.weeklyContent.deleteMany({ where: { profileId: { in: profileIds } } });
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: { in: userIds } } });
    await prisma.boardUnlockEvent.deleteMany({ where: { contestId: { in: contestIds() } } });
    await prisma.rankingPick.deleteMany({ where: { submission: { contestId: { in: contestIds() } } } });
    await prisma.rankingSubmission.deleteMany({ where: { contestId: { in: contestIds() } } });
    await prisma.contestPregameSnapshot.deleteMany({ where: { contestId: { in: contestIds() } } });
    await prisma.contestEntry.deleteMany({ where: { contestId: { in: contestIds() } } });
    await prisma.rankIQContest.deleteMany({ where: { id: { in: contestIds() } } });
    await prisma.nflGame.deleteMany({ where: { seasonId } });
    await prisma.week.deleteMany({ where: { seasonId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.rankableEntry.deleteMany({ where: { externalId: { startsWith: `oba-${suffix}-` } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.universalProfile.deleteMany({ where: { id: { in: profileIds } } });
  });

  it("before full lock: FINAL is pending and nothing is reported missing", async () => {
    const ops = await getOfficialBoardsWeekOps(weekId, before);
    expect(ops?.activation).toMatchObject({ active: true, finalsRequired: false });
    expect(ops?.summary).toMatchObject({ eligibleOwnerAuthored: 2, published: 1, protected: 2, missingFinal: 0 });
    expect(ops?.contests[0]).toMatchObject({ state: "BEFORE_FULL_LOCK", gradingBlockedUntilCaptured: false });
    expect(ops?.rows.find((row) => row.profileId === p.humanA.id)?.final.state).toBe("PENDING_FULL_LOCK");
    expect(ops?.rows.find((row) => row.profileId === p.drafter.id)).toMatchObject({
      eligible: false,
      final: { state: "NOT_REQUIRED" },
    });
  });

  it("missing required FINAL is visible operationally before grading", async () => {
    const ops = await getOfficialBoardsWeekOps(weekId, afterLock);
    expect(ops?.activation.finalsRequired).toBe(true);
    expect(ops?.summary.missingFinal).toBe(2);
    expect(ops?.summary.diagnostics).toBe(2);
    expect(ops?.contests[0]).toMatchObject({ position: "RB", state: "MISSING", missing: 2, gradingBlockedUntilCaptured: true });
    for (const profileId of [p.humanA.id, p.humanB.id]) {
      const row = ops?.rows.find((item) => item.profileId === profileId);
      expect(row?.final.state).toBe("MISSING");
      expect(row?.diagnostics.map((item) => item.code)).toContain("MISSING_FINAL");
    }

    expect(await getContestFinalReadiness(rbId, afterLock)).toMatchObject({ state: "MISSING", gradingBlockedUntilCaptured: true });
    const dashboard = await getOpsDashboard(weekId, { now: afterLock });
    expect(dashboard.officialBoards).toEqual({ missingFinal: 2, gradingBlockedPositions: ["RB"] });
    const rbRow = dashboard.positions.find((row) => row.position === "RB");
    expect(rbRow?.officialFinal).toMatchObject({ state: "MISSING", missing: 2, gradingBlockedUntilCaptured: true });
    expect(rbRow?.status).toBe("Needs Attention");
  });

  it("Preview Missing FINALs performs zero writes", async () => {
    const snapshot = await worldSnapshot();
    const preview = await previewMissingOfficialBoardFinals(weekId, afterLock);
    expect(preview.totalWouldCreate).toBe(2);
    expect(preview.contests[0]?.wouldCreate.map((row) => row.username).sort()).toEqual(
      [p.humanA.username, p.humanB.username].sort(),
    );
    const prePreview = await previewMissingOfficialBoardFinals(preWeekId, afterPreLock);
    expect(prePreview).toMatchObject({ totalWouldCreate: 0, activation: { active: false } });
    expect(prePreview.contests[0]?.skipped).toBe("before_finals_start");
    await getOfficialBoardsWeekOps(weekId, afterLock);
    await getOfficialBoardAdminDetail((await prisma.rankingSubmission.findFirstOrThrow({ where: { contestId: rbId, universalProfileId: p.humanA.id } })).id);
    expect(await worldSnapshot()).toBe(snapshot);
  });

  it("grading is blocked when required FINAL receipts cannot be preserved", async () => {
    for (let i = 0; i < rb.length; i += 1) {
      await prisma.contestEntry.update({
        where: { contestId_rankableEntryId: { contestId: rbId, rankableEntryId: rb[i]! } },
        data: { actualRank: i + 1, fantasyPoints: 30 - i },
      });
    }
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${triggerName}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated FINAL capture failure'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "OfficialBoardVersion" FOR EACH ROW WHEN (NEW."contestId" = '${rbId}') EXECUTE FUNCTION "${triggerName}"()`,
    );
    const history = await historySnapshot();
    adminState.ctx = { user: { id: adminUserId } };
    vi.useFakeTimers({ toFake: ["Date"], now: afterLock });
    try {
      const form = new FormData();
      form.set("contestId", rbId);
      await expect(gradeContestAction(form)).rejects.toThrow("simulated FINAL capture failure");
    } finally {
      vi.useRealTimers();
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "OfficialBoardVersion"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${triggerName}"()`);
    }
    expect(await historySnapshot()).toBe(history);
    const submissions = await prisma.rankingSubmission.findMany({ where: { contestId: rbId } });
    expect(submissions.every((row) => row.status !== "GRADED" && row.normalizedScore == null)).toBe(true);
    expect(
      await prisma.adminAuditLog.count({ where: { adminUserId, action: "contest.graded", entityId: rbId } }),
    ).toBe(0);
  });

  it("Capture Missing FINALs is idempotent, audited and admin-only", async () => {
    await expect(
      captureMissingOfficialBoardFinals({ adminUserId: nonAdminUserId, weekId, now: afterLock }),
    ).rejects.toThrow("Admin access required");
    expect(await prisma.officialBoardVersion.count({ where: { contestId: rbId, kind: "FINAL" } })).toBe(0);

    const first = await captureMissingOfficialBoardFinals({ adminUserId, weekId, now: afterLock });
    expect(first).toMatchObject({ created: 2, existing: 0 });
    const afterFirst = await worldSnapshot();
    const finalsAfterFirst = JSON.stringify(
      await prisma.officialBoardVersion.findMany({
        where: { contestId: rbId, kind: "FINAL" },
        include: { picks: true },
        orderBy: { id: "asc" },
      }),
    );
    const second = await captureMissingOfficialBoardFinals({ adminUserId, weekId, now: afterLock });
    expect(second).toMatchObject({ created: 0, existing: 2 });
    expect(
      JSON.stringify(
        await prisma.officialBoardVersion.findMany({
          where: { contestId: rbId, kind: "FINAL" },
          include: { picks: true },
          orderBy: { id: "asc" },
        }),
      ),
    ).toBe(finalsAfterFirst);
    // Only the audit row differs between the two runs.
    const [a, b] = [JSON.parse(afterFirst), JSON.parse(await worldSnapshot())];
    expect(b.audit).toBe(a.audit + 1);
    expect({ ...b, audit: 0 }).toEqual({ ...a, audit: 0 });
    const audits = await prisma.adminAuditLog.findMany({
      where: { adminUserId, action: "official_board.capture_missing_finals", entityId: weekId },
    });
    expect(audits).toHaveLength(2);
    expect(await prisma.adminAuditLog.count({ where: { adminUserId: nonAdminUserId } })).toBe(0);

    const ops = await getOfficialBoardsWeekOps(weekId, afterLock);
    expect(ops?.summary).toMatchObject({ finalComplete: 2, missingFinal: 0 });
    expect(ops?.contests[0]).toMatchObject({ state: "READY", gradingBlockedUntilCaptured: false });
  });

  it("Admin repair never overwrites an existing FINAL, even after later kickoff freezes or drift", async () => {
    const finalBefore = JSON.stringify(await finalFor(p.humanA.id));
    const live = await prisma.rankingSubmission.findFirstOrThrow({
      where: { contestId: rbId, universalProfileId: p.humanA.id },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });
    const first = live.picks[0]!;
    await prisma.rankingPick.updateMany({ where: { submissionId: live.id }, data: { wasUnavailableAtKickoff: true } });
    await prisma.rankingPick.update({ where: { id: first.id }, data: { rankableEntryId: rb[12]! } });
    try {
      expect(await captureMissingOfficialBoardFinals({ adminUserId, weekId, now: afterLock })).toMatchObject({ created: 0 });
      expect(await ensureOfficialBoardFinalsForContest(rbId, afterLock)).toMatchObject({ created: 0, existing: 2 });
      expect(JSON.stringify(await finalFor(p.humanA.id))).toBe(finalBefore);
      const ops = await getOfficialBoardsWeekOps(weekId, afterLock);
      expect(ops?.rows.find((row) => row.profileId === p.humanA.id)?.diagnostics.map((item) => item.code)).toContain(
        "FINAL_DIFFERS_FROM_COMPETITIVE_BOARD",
      );
    } finally {
      await prisma.rankingPick.update({ where: { id: first.id }, data: { rankableEntryId: first.rankableEntryId } });
      await prisma.rankingPick.updateMany({ where: { submissionId: live.id }, data: { wasUnavailableAtKickoff: null } });
    }
    const detail = await getOfficialBoardAdminDetail(live.id);
    expect(detail?.final?.fingerprint).toBe(detail?.submission.fingerprint);
    expect(detail?.published.map((version) => version.versionNumber)).toEqual([1]);
  });

  it("pre-activation weeks (like Weeks 1–3) cannot receive FINAL through Admin repair", async () => {
    expect(preTiming.fullLockAt < OFFICIAL_BOARD_FINALS_START_AT).toBe(true);
    for (const now of [afterPreLock, new Date(), afterLock]) {
      const result = await captureMissingOfficialBoardFinals({ adminUserId, weekId: preWeekId, now });
      expect(result.created).toBe(0);
    }
    expect(await ensureOfficialBoardFinalsForContest(preRbId, afterPreLock)).toMatchObject({
      created: 0,
      skipped: "before_finals_start",
    });
    expect(await prisma.officialBoardVersion.count({ where: { contestId: preRbId } })).toBe(0);
    const ops = await getOfficialBoardsWeekOps(preWeekId, afterPreLock);
    expect(ops?.activation).toMatchObject({ active: false, finalsRequired: false });
    expect(ops?.contests[0]).toMatchObject({ state: "PRE_ACTIVATION", gradingBlockedUntilCaptured: false });
    expect(ops?.summary.missingFinal).toBe(0);
    expect(ops?.rows.every((row) => row.final.state === "PRE_ACTIVATION")).toBe(true);
  });

  it("Admin cannot mutate PUBLISHED / FINAL competitive history through this page", async () => {
    expect(Object.keys(officialBoardsActions).sort()).toEqual([
      "captureMissingOfficialBoardFinalsAction",
      "restoreWeeklyContentAction",
      "suppressWeeklyContentAction",
    ]);
    const item = await createWeeklyContent({
      userId: p.humanB.userId,
      weekId,
      content: { title: "Breakdown", url: "https://example.com/b", type: "VIDEO" },
    });
    const history = await historySnapshot();
    adminState.ctx = { user: { id: adminUserId } };
    for (const weekTarget of [weekId, preWeekId]) {
      const form = new FormData();
      form.set("weekId", weekTarget);
      await officialBoardsActions.captureMissingOfficialBoardFinalsAction(form);
    }
    const suppress = new FormData();
    suppress.set("weekId", weekId);
    suppress.set("id", item.id);
    suppress.set("reason", "spam");
    await officialBoardsActions.suppressWeeklyContentAction(suppress);
    const restore = new FormData();
    restore.set("weekId", weekId);
    restore.set("id", item.id);
    await officialBoardsActions.restoreWeeklyContentAction(restore);
    expect(await historySnapshot()).toBe(history);

    adminState.ctx = null;
    await expect(officialBoardsActions.suppressWeeklyContentAction(suppress)).rejects.toThrow("Admin access required");
    expect((await prisma.weeklyContent.findUniqueOrThrow({ where: { id: item.id } })).suppressedAt).toBeNull();
  });

  it("WeeklyContent moderation hides public display, is audited, and never alters competitive data", async () => {
    const item = await createWeeklyContent({
      userId: p.humanA.userId,
      weekId,
      content: { title: "Sketchy link", url: "https://example.com/sketchy", type: "ARTICLE", position: "RB" },
    });
    const history = await historySnapshot();

    await expect(suppressWeeklyContent({ adminUserId, id: item.id, reason: "  " })).rejects.toThrow(
      "A moderation reason is required.",
    );
    await expect(
      suppressWeeklyContent({ adminUserId: nonAdminUserId, id: item.id, reason: "unsafe" }),
    ).rejects.toThrow("Admin access required");
    await suppressWeeklyContent({ adminUserId, id: item.id, reason: "unsafe destination" });

    expect(
      await prisma.adminAuditLog.findFirst({
        where: { adminUserId, action: "weekly_content.suppress", entityId: item.id },
      }),
    ).toMatchObject({ entityType: "WeeklyContent" });
    const publicItems = await listWeeklyContent({ profileId: p.humanA.id, weekId, position: "RB" });
    expect(publicItems.map((row) => row.id)).not.toContain(item.id);
    const ownerItems = await listWeeklyContent({ profileId: p.humanA.id, weekId, includeSuppressed: true });
    expect(ownerItems.find((row) => row.id === item.id)?.hiddenByModeration).toBe(true);
    const board = await getPublicProfileBoard({
      username: p.humanA.username,
      weekNumber: 4,
      position: "RB",
      viewer: { profileId: null, isAdmin: false },
      seasonYear,
      now: before,
      recordUnlock: false,
    });
    expect(board?.weeklyContent.map((row) => row.id)).not.toContain(item.id);

    // Owner edits never clear moderation.
    await updateWeeklyContent({
      userId: p.humanA.userId,
      id: item.id,
      content: { title: "Edited", url: "https://example.com/edited", type: "ARTICLE", position: "RB" },
    });
    expect((await prisma.weeklyContent.findUniqueOrThrow({ where: { id: item.id } })).suppressedAt).not.toBeNull();

    await restoreWeeklyContent({ adminUserId, id: item.id });
    expect(
      await prisma.adminAuditLog.count({ where: { adminUserId, action: "weekly_content.restore", entityId: item.id } }),
    ).toBe(1);
    expect(
      (await listWeeklyContent({ profileId: p.humanA.id, weekId, position: "RB" })).map((row) => row.id),
    ).toContain(item.id);
    expect(await historySnapshot()).toBe(history);

    const ops = await getOfficialBoardsWeekOps(weekId, afterLock);
    expect(ops?.weeklyContent.find((row) => row.id === item.id)).toMatchObject({ host: "example.com", suppressedAt: null });
  });
});
