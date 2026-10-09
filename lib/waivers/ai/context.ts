import { buildWaiverAiPrompt, type WaiverAiPrompt } from "@/lib/waivers/ai/prompt";
import type { WaiverAiFrozenRow } from "@/lib/waivers/ai/response-parser";
import type { WaiverDb } from "@/lib/waivers/clock";
import type { WaiverPosition } from "@/lib/waivers/constants";

/**
 * The pinned frozen context of one Waiver contest: the contest, its pinned
 * snapshot, every frozen row of that snapshot, and the WAIVEREYEQ_AI_V1
 * prompt built from it. Reads frozen evidence only (never live availability).
 */
export type WaiverAiContestContext = {
  contest: {
    id: string;
    weekId: string;
    position: WaiverPosition;
    status: string;
    maxCalls: number;
    locksAt: Date;
    snapshotId: string;
  };
  week: { seasonYear: number; weekNumber: number; label: string; isTest: boolean };
  snapshot: { id: string; version: number; entriesFingerprint: string; thresholdBps: number; frozenAt: Date };
  rows: WaiverAiFrozenRow[];
  prompt: WaiverAiPrompt;
};

export async function loadWaiverAiContestContext(db: WaiverDb, contestId: string): Promise<WaiverAiContestContext | null> {
  const contest = await db.waiverContest.findUnique({
    where: { id: contestId },
    select: {
      id: true,
      weekId: true,
      position: true,
      status: true,
      maxCalls: true,
      locksAt: true,
      snapshotId: true,
      week: { select: { weekNumber: true, label: true, isTest: true, season: { select: { year: true } } } },
      snapshot: { select: { id: true, version: true, entriesFingerprint: true, thresholdBps: true, frozenAt: true } },
    },
  });
  if (!contest) return null;
  const entries = await db.waiverSnapshotEntry.findMany({
    where: { snapshotId: contest.snapshotId },
    orderBy: [{ inputLineNumber: "asc" }, { id: "asc" }],
    select: {
      id: true,
      rankableEntryId: true,
      position: true,
      displayNameAtFreeze: true,
      teamAtFreeze: true,
      opponentAtFreeze: true,
      rosteredBps: true,
      evidenceRole: true,
      eligibility: true,
    },
  });
  const position = contest.position as WaiverPosition;
  const rows: WaiverAiFrozenRow[] = entries.map((entry) => ({
    snapshotEntryId: entry.id,
    rankableEntryId: entry.rankableEntryId,
    position: entry.position,
    displayName: entry.displayNameAtFreeze,
    team: entry.teamAtFreeze,
    eligible: entry.evidenceRole === "CANDIDATE" && entry.eligibility === "ELIGIBLE",
  }));
  const pool = entries
    .filter((entry) => entry.position === position && entry.evidenceRole === "CANDIDATE" && entry.eligibility === "ELIGIBLE")
    .map((entry) => ({
      displayName: entry.displayNameAtFreeze,
      team: entry.teamAtFreeze,
      opponent: entry.opponentAtFreeze,
      rosteredBps: entry.rosteredBps,
    }));
  const prompt = buildWaiverAiPrompt({
    seasonYear: contest.week.season.year,
    weekNumber: contest.week.weekNumber,
    position,
    maxCalls: contest.maxCalls,
    snapshot: {
      version: contest.snapshot.version,
      entriesFingerprint: contest.snapshot.entriesFingerprint,
      thresholdBps: contest.snapshot.thresholdBps,
    },
    pool,
  });
  return {
    contest: {
      id: contest.id,
      weekId: contest.weekId,
      position,
      status: contest.status,
      maxCalls: contest.maxCalls,
      locksAt: contest.locksAt,
      snapshotId: contest.snapshotId,
    },
    week: {
      seasonYear: contest.week.season.year,
      weekNumber: contest.week.weekNumber,
      label: contest.week.label,
      isTest: contest.week.isTest,
    },
    snapshot: contest.snapshot,
    rows,
    prompt,
  };
}
