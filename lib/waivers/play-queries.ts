import { prisma } from "@/lib/db";
import { loadRevealableWaiverBoards } from "@/lib/waivers/access-queries";
import { effectiveMaxCalls } from "@/lib/waivers/board-shape";
import { readWaiverClock } from "@/lib/waivers/clock";
import { normalizeTeamAbbr } from "@/lib/nfl/manual/parse-common";
import { filterWaiverBoardsByCategory } from "@/lib/waivers/competitor-category";
import { buildWaiverConsensus, publishWaiverConsensus } from "@/lib/waivers/consensus-model";
import { WAIVER_MAX_CALLS, WAIVER_POSITIONS, type WaiverPosition, type WaiverSlotLabel } from "@/lib/waivers/constants";
import { waiverPhaseAt } from "@/lib/waivers/lock-time";
import {
  resolveWaiverMatchupSide,
  resolveWaiverPlayState,
  resolveWaiverViewerBoardStatus,
  selectWaiverPlayWeek,
  type WaiverMatchupSide,
  type WaiverPlayState,
  type WaiverViewerBoardStatus,
} from "@/lib/waivers/play-model";
import { getOwnWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Read model for the public /waivers page. Everything is derived from the
 * frozen snapshot and the database clock. Other competitors' boards are only
 * read after lock, and only as aggregate consensus.
 */

export type WaiverPlayPoolEntry = {
  rankableEntryId: string;
  displayName: string;
  team: string | null;
  opponent: string | null;
  /** Null when the pinned game can't confirm orientation against the frozen team/opponent. */
  matchupSide: WaiverMatchupSide | null;
  kickoffAt: string | null;
  rosteredBps: number;
  availabilityDesignation: string | null;
};

export type WaiverPlayBoardCall = {
  slot: number;
  label: WaiverSlotLabel;
  rankableEntryId: string;
  displayName: string;
  team: string | null;
};

export type WaiverPlayBoard = {
  status: WaiverViewerBoardStatus;
  revisionNumber: number | null;
  submittedAt: string | null;
  lockedAt: string | null;
  calls: WaiverPlayBoardCall[];
  /** Calls on players no longer in the pinned pool after a pre-lock correction. */
  affectedEntryIds: string[];
  needsReview: boolean;
};

/** Withheld below the V1 minimum: nothing derived from individual boards is sent. */
export type WaiverPlayConsensus =
  | { status: "WITHHELD" }
  | {
      status: "PUBLISHED";
      boardCount: number;
      callingBoardCount: number;
      abstentionCount: number;
      rows: Array<{
        rankableEntryId: string;
        displayName: string;
        team: string | null;
        calledCount: number;
        winCount: number;
        top3Count: number;
      }>;
    };

export type WaiverPlayTab = {
  position: WaiverPosition;
  state: WaiverPlayState;
  viewerStatus: WaiverViewerBoardStatus | null;
};

export type WaiverPlayView = {
  week: null | { id: string; weekNumber: number; label: string; seasonYear: number };
  /** Database clock at load (display only; never used to authorize). */
  now: string;
  tabs: WaiverPlayTab[];
  selected: {
    position: WaiverPosition;
    state: WaiverPlayState;
    contestId: string | null;
    locksAt: string | null;
    maxCalls: number;
    availableSlots: number;
    snapshot: null | { observedAt: string; sourceLabel: string; thresholdBps: number };
    pool: WaiverPlayPoolEntry[];
    board: WaiverPlayBoard | null;
    consensus: WaiverPlayConsensus | null;
  };
};

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/** Active NFL season, non-test weeks only. Test and inactive seasons never appear publicly. */
export async function resolveWaiverPlayWeekId(now?: Date): Promise<string | null> {
  const season = await prisma.season.findFirst({ where: { active: true, sport: "NFL" }, select: { id: true } });
  if (!season) return null;
  const weeks = await prisma.week.findMany({
    where: { seasonId: season.id, isTest: false },
    select: {
      id: true,
      weekNumber: true,
      _count: { select: { waiverContests: true } },
      waiverSnapshots: { where: { currentForWeekId: { not: null } }, select: { id: true }, take: 1 },
      games: { orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } },
    },
  });
  const selected = selectWaiverPlayWeek(
    weeks.map((week) => ({
      weekId: week.id,
      weekNumber: week.weekNumber,
      hasWaiverActivity: week._count.waiverContests > 0 || week.waiverSnapshots.length > 0,
      firstKickoffAt: week.games[0]?.startsAt ?? null,
    })),
    now ?? (await readWaiverClock()),
  );
  return selected?.weekId ?? null;
}

async function eligibleCountsByPosition(snapshotId: string): Promise<Map<string, number>> {
  const groups = await prisma.waiverSnapshotEntry.groupBy({
    by: ["position"],
    where: { snapshotId, evidenceRole: "CANDIDATE", eligibility: "ELIGIBLE" },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.position, group._count._all]));
}

async function loadPlayPool(snapshotId: string, position: WaiverPosition): Promise<WaiverPlayPoolEntry[]> {
  const rows = await prisma.waiverSnapshotEntry.findMany({
    where: { snapshotId, position, evidenceRole: "CANDIDATE", eligibility: "ELIGIBLE" },
    orderBy: { inputLineNumber: "asc" },
    select: {
      rankableEntryId: true,
      displayNameAtFreeze: true,
      teamAtFreeze: true,
      opponentAtFreeze: true,
      kickoffAtFreeze: true,
      rosteredBps: true,
      availabilityDesignationAtFreeze: true,
      nflGame: { select: { homeTeam: true, awayTeam: true } },
    },
  });
  return rows.map((row) => ({
    rankableEntryId: row.rankableEntryId,
    displayName: row.displayNameAtFreeze,
    team: row.teamAtFreeze,
    opponent: row.opponentAtFreeze,
    matchupSide: resolveWaiverMatchupSide({
      teamAtFreeze: row.teamAtFreeze ? normalizeTeamAbbr(row.teamAtFreeze) : null,
      opponentAtFreeze: row.opponentAtFreeze ? normalizeTeamAbbr(row.opponentAtFreeze) : null,
      pinnedGame: row.nflGame
        ? { homeTeam: normalizeTeamAbbr(row.nflGame.homeTeam), awayTeam: normalizeTeamAbbr(row.nflGame.awayTeam) }
        : null,
    }),
    kickoffAt: iso(row.kickoffAtFreeze),
    rosteredBps: row.rosteredBps,
    availabilityDesignation: row.availabilityDesignationAtFreeze,
  }));
}

async function loadPlayConsensus(contestId: string, pool: WaiverPlayPoolEntry[]): Promise<WaiverPlayConsensus | null> {
  const revealed = await loadRevealableWaiverBoards(contestId);
  if (!revealed.revealed) return null;
  // The public consensus is human-only: AI boards never enter it.
  const consensus = publishWaiverConsensus(
    buildWaiverConsensus({
      boards: filterWaiverBoardsByCategory(revealed.boards, "HUMANS"),
      poolOrder: pool.map((entry) => entry.rankableEntryId),
    }),
  );
  if (consensus.status === "WITHHELD") return { status: "WITHHELD" };
  const names = new Map(pool.map((entry) => [entry.rankableEntryId, { displayName: entry.displayName, team: entry.team }]));
  const missing = consensus.rows.map((row) => row.rankableEntryId).filter((id) => !names.has(id));
  if (missing.length > 0) {
    const entries = await prisma.rankableEntry.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true, team: true },
    });
    for (const entry of entries) names.set(entry.id, { displayName: entry.name, team: entry.team });
  }
  return {
    status: "PUBLISHED",
    boardCount: consensus.boardCount,
    callingBoardCount: consensus.callingBoardCount,
    abstentionCount: consensus.abstentionCount,
    rows: consensus.rows.map((row) => ({
      ...row,
      displayName: names.get(row.rankableEntryId)?.displayName ?? "Unknown player",
      team: names.get(row.rankableEntryId)?.team ?? null,
    })),
  };
}

function emptySelected(position: WaiverPosition, state: WaiverPlayState): WaiverPlayView["selected"] {
  return {
    position,
    state,
    contestId: null,
    locksAt: null,
    maxCalls: WAIVER_MAX_CALLS[position],
    availableSlots: 0,
    snapshot: null,
    pool: [],
    board: null,
    consensus: null,
  };
}

/** One week's Waivers surface for one position and (optionally) one signed-in profile. */
export async function loadWaiverPlayWeekView(input: {
  weekId: string | null;
  position: WaiverPosition;
  viewerProfileId: string | null;
}): Promise<WaiverPlayView> {
  const now = await readWaiverClock();
  const week = input.weekId
    ? await prisma.week.findUnique({
        where: { id: input.weekId },
        select: {
          id: true,
          weekNumber: true,
          label: true,
          season: { select: { year: true } },
          waiverContests: {
            select: {
              id: true,
              position: true,
              status: true,
              locksAt: true,
              maxCalls: true,
              snapshotId: true,
              snapshot: { select: { observedAt: true, sourceLabel: true, thresholdBps: true } },
            },
          },
          waiverSnapshots: {
            where: { currentForWeekId: { not: null } },
            select: { id: true },
            take: 1,
          },
        },
      })
    : null;

  if (!week) {
    return {
      week: null,
      now: now.toISOString(),
      tabs: WAIVER_POSITIONS.map((position) => ({ position, state: "NO_WEEK" as const, viewerStatus: null })),
      selected: emptySelected(input.position, "NO_WEEK"),
    };
  }

  const currentSnapshotId = week.waiverSnapshots[0]?.id ?? null;
  const currentCounts = currentSnapshotId ? await eligibleCountsByPosition(currentSnapshotId) : new Map<string, number>();
  const contestByPosition = new Map(week.waiverContests.map((contest) => [contest.position as string, contest]));
  const pinnedCounts = new Map<string, Map<string, number>>();
  for (const snapshotId of new Set(week.waiverContests.map((contest) => contest.snapshotId))) {
    pinnedCounts.set(snapshotId, await eligibleCountsByPosition(snapshotId));
  }

  const ownSubmissions = input.viewerProfileId && week.waiverContests.length > 0
    ? await prisma.waiverSubmission.findMany({
        where: {
          contestId: { in: week.waiverContests.map((contest) => contest.id) },
          universalProfileId: input.viewerProfileId,
        },
        select: { contestId: true, status: true, currentRevision: { select: { callCount: true } } },
      })
    : [];
  const ownByContest = new Map(ownSubmissions.map((submission) => [submission.contestId, submission]));

  const isLocked = (contest: { locksAt: Date; status: string }) =>
    contest.status !== "OPEN" || waiverPhaseAt(contest.locksAt, now) === "LOCKED";

  const tabs: WaiverPlayTab[] = WAIVER_POSITIONS.map((position) => {
    const contest = contestByPosition.get(position) ?? null;
    const state = resolveWaiverPlayState({
      hasWeek: true,
      hasCurrentSnapshot: currentSnapshotId !== null,
      snapshotEligibleAtPosition: currentCounts.get(position) ?? 0,
      contest: contest
        ? { locked: isLocked(contest), poolSize: pinnedCounts.get(contest.snapshotId)?.get(position) ?? 0 }
        : null,
    });
    let viewerStatus: WaiverViewerBoardStatus | null = null;
    if (contest && input.viewerProfileId) {
      const own = ownByContest.get(contest.id);
      viewerStatus = resolveWaiverViewerBoardStatus({
        locked: isLocked(contest),
        board: own ? { competitive: own.status !== "DRAFT", callCount: own.currentRevision?.callCount ?? 0 } : null,
      });
    }
    return { position, state, viewerStatus };
  });

  const weekView = { id: week.id, weekNumber: week.weekNumber, label: week.label, seasonYear: week.season.year };
  const selectedTab = tabs.find((tab) => tab.position === input.position)!;
  const contest = contestByPosition.get(input.position) ?? null;
  if (!contest) {
    return { week: weekView, now: now.toISOString(), tabs, selected: emptySelected(input.position, selectedTab.state) };
  }

  const pool = await loadPlayPool(contest.snapshotId, input.position);
  const own = input.viewerProfileId
    ? await getOwnWaiverBoard({ contestId: contest.id, universalProfileId: input.viewerProfileId })
    : null;
  const locked = isLocked(contest) || own?.contest.phase === "LOCKED";
  const state: WaiverPlayState = locked ? "LOCKED" : selectedTab.state;
  if (locked) selectedTab.state = "LOCKED";

  let board: WaiverPlayBoard | null = null;
  if (own?.board) {
    const status = resolveWaiverViewerBoardStatus({
      locked,
      board: { competitive: own.board.competitive, callCount: own.board.calls.length },
    });
    selectedTab.viewerStatus = status;
    board = {
      status,
      revisionNumber: own.board.revisionNumber,
      submittedAt: iso(own.board.submittedAt),
      lockedAt: iso(own.board.lockedAt),
      calls: own.board.calls,
      affectedEntryIds: own.board.affectedCalls.map((call) => call.rankableEntryId),
      needsReview: own.board.needsReview,
    };
  } else if (input.viewerProfileId) {
    selectedTab.viewerStatus = resolveWaiverViewerBoardStatus({ locked, board: null });
  }

  return {
    week: weekView,
    now: now.toISOString(),
    tabs,
    selected: {
      position: input.position,
      state,
      contestId: contest.id,
      locksAt: contest.locksAt.toISOString(),
      maxCalls: contest.maxCalls,
      availableSlots: effectiveMaxCalls(contest.maxCalls, pool.length),
      snapshot: {
        observedAt: contest.snapshot.observedAt.toISOString(),
        sourceLabel: contest.snapshot.sourceLabel,
        thresholdBps: contest.snapshot.thresholdBps,
      },
      pool,
      board,
      consensus: locked ? await loadPlayConsensus(contest.id, pool) : null,
    },
  };
}

/** The public /waivers page model: resolves the Waivers week, then loads it. */
export async function loadWaiverPlayPage(input: {
  position: WaiverPosition;
  viewerProfileId: string | null;
}): Promise<WaiverPlayView> {
  const weekId = await resolveWaiverPlayWeekId();
  return loadWaiverPlayWeekView({ weekId, position: input.position, viewerProfileId: input.viewerProfileId });
}
