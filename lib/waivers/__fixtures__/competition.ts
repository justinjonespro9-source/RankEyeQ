import { prisma } from "@/lib/db";
import type { ContestPosition, ProfileType, Prisma } from "@/lib/generated/prisma/client";
import { WAIVER_EYEQ_V1, WAIVER_MAX_CALLS, WAIVER_RESULT_FIELD_SIZE, WAIVER_POSITIONS } from "@/lib/waivers/constants";
import { resolveWaiverLocksAt } from "@/lib/waivers/lock-time";
import { createFixtureSeason } from "@/lib/waivers/__fixtures__/seasons";

/**
 * Local-DB fixtures for Waiver competition integration tests. Everything is
 * namespaced by a unique suffix and removed by `cleanup()`, which uses the
 * fixture-maintenance switch documented in the Phase 2 migration.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const MAINTENANCE_SQL = "SET LOCAL rankeyeq.waiver_fixture_maintenance = 'on'";

export type FixturePlayer = { id: string; position: ContestPosition; name: string };

export type SnapshotRowSpec = {
  player: FixturePlayer;
  eligibility?: "ELIGIBLE" | "EXCLUDED" | "OBSERVATION_ONLY";
  evidenceRole?: "CANDIDATE" | "FOLLOW_UP";
  rosteredBps?: number;
  team?: string;
  opponent?: string;
  nflGameId?: string;
};

export async function withFixtureMaintenance<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(MAINTENANCE_SQL);
    return fn(tx);
  });
}

/** First kickoff comfortably in the future whose Tuesday 7 PM CT lock precedes it. */
export function futureFirstKickoff(daysAhead = 9): Date {
  let kickoff = new Date(Date.now() + daysAhead * DAY);
  for (let i = 0; i < 3 && !resolveWaiverLocksAt(kickoff).ok; i += 1) {
    kickoff = new Date(kickoff.getTime() + DAY);
  }
  return kickoff;
}

/** Far-future fixture seasons, unless a caller needs another range (e.g. SNG-valid seasons for canonical artifacts). */
export const WAIVER_FIXTURE_SEASON_YEARS = { min: 3900, max: 3989 } as const;

/** The season year is allocated collision-free from `years` (see createFixtureSeason). */
export async function createWaiverFixture(tag: string, options: { years?: { min: number; max: number } } = {}) {
  const suffix = `${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const season = await createFixtureSeason(options.years ?? WAIVER_FIXTURE_SEASON_YEARS, `WAIVERS-${suffix}`);
  const year = season.year;

  const userIds: string[] = [];
  const profileIds: string[] = [];
  const playerIds: string[] = [];
  const weekIds: string[] = [];
  let weekNumber = 0;

  const admin = await prisma.user.create({ data: { email: `waivers-admin-${suffix}@example.test`, role: "ADMIN" } });
  userIds.push(admin.id);

  async function addParticipant(label: string, profileType: ProfileType = "HUMAN", status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
    const profile = await prisma.universalProfile.create({
      data: { username: `w_${label}_${suffix}`.slice(0, 60), displayName: label, profileType, status },
    });
    profileIds.push(profile.id);
    const user = await prisma.user.create({
      data: { email: `waivers-${label}-${suffix}@example.test`, universalProfileId: profile.id },
    });
    userIds.push(user.id);
    return { userId: user.id, profileId: profile.id };
  }

  /** AI competitor profile with no login (as in production). */
  async function addAiCompetitor(label: string, options: { status?: "ACTIVE" | "SUSPENDED"; competitorActive?: boolean } = {}) {
    const profile = await prisma.universalProfile.create({
      data: {
        username: `w_ai_${label}_${suffix}`.slice(0, 60),
        displayName: `AI ${label}`,
        profileType: "AI",
        status: options.status ?? "ACTIVE",
        competitorActive: options.competitorActive ?? true,
      },
    });
    profileIds.push(profile.id);
    return { profileId: profile.id };
  }

  /** Extra ADMIN login (removed by cleanup). */
  async function addAdmin(label: string) {
    const user = await prisma.user.create({ data: { email: `waivers-admin-${label}-${suffix}@example.test`, role: "ADMIN" } });
    userIds.push(user.id);
    return { userId: user.id };
  }

  async function addPlayers(position: ContestPosition, count: number): Promise<FixturePlayer[]> {
    const players: FixturePlayer[] = [];
    for (let i = 0; i < count; i += 1) {
      const name = `${position} Player ${i + 1}`;
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "waivers-test",
          externalId: `${suffix}-${position}-${playerIds.length}`,
          type: position === "DEF" ? "DEFENSE" : "PLAYER",
          name,
          shortName: name,
          team: "SF",
          position,
        },
      });
      playerIds.push(entry.id);
      players.push({ id: entry.id, position, name });
    }
    return players;
  }

  /** Uniquely named player with a season roster row (the snapshot name universe). */
  async function addRosterPlayer(input: {
    position: ContestPosition;
    team: string;
    label?: string;
    nflStatus?: string;
    activeOnNFLRoster?: boolean;
    seasonPlayer?: boolean;
    adminNotes?: string;
  }): Promise<FixturePlayer & { team: string }> {
    const name = `${input.label ?? `${input.position} Roster ${playerIds.length + 1}`} ${suffix}`;
    const entry = await prisma.rankableEntry.create({
      data: {
        provider: "waivers-test",
        externalId: `${suffix}-roster-${playerIds.length}`,
        type: input.position === "DEF" ? "DEFENSE" : "PLAYER",
        name,
        shortName: name,
        team: input.team,
        position: input.position,
        adminNotes: input.adminNotes ?? null,
      },
    });
    playerIds.push(entry.id);
    if (input.seasonPlayer !== false) {
      await prisma.seasonPlayer.create({
        data: {
          seasonId: season.id,
          rankableEntryId: entry.id,
          displayName: name,
          team: input.team,
          position: input.position,
          nflStatus: input.nflStatus ?? "ACTIVE",
          activeOnNFLRoster: input.activeOnNFLRoster ?? true,
        },
      });
    }
    return { id: entry.id, position: input.position, name, team: input.team };
  }

  async function addWeek(
    input: {
      firstKickoff?: Date | null;
      games?: Array<{ homeTeam: string; awayTeam: string; startsAt?: Date; status?: "SCHEDULED" | "POSTPONED" | "CANCELED" }>;
    } = {},
  ) {
    weekNumber += 1;
    const kickoff = input.firstKickoff === undefined ? futureFirstKickoff() : input.firstKickoff;
    const week = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber,
        label: `W${weekNumber}`,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 14 * DAY),
        status: "OPEN",
        isTest: true,
      },
    });
    weekIds.push(week.id);
    if (kickoff) {
      const games = input.games ?? [{ homeTeam: "SF", awayTeam: "SEA" }];
      for (const [index, game] of games.entries()) {
        await prisma.nflGame.create({
          data: {
            provider: "waivers-test",
            externalId: `${suffix}-w${weekNumber}-${index}`,
            seasonId: season.id,
            weekId: week.id,
            seasonYear: year,
            weekNumber,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            startsAt: game.startsAt ?? kickoff,
            status: game.status ?? "SCHEDULED",
          },
        });
      }
    }
    return { weekId: week.id, firstKickoff: kickoff };
  }

  async function setAvailability(
    weekId: string,
    rankableEntryId: string,
    designation: "AVAILABLE" | "QUESTIONABLE" | "DOUBTFUL" | "OUT" | "INACTIVE" | "UNKNOWN",
    extra: { manualOverride?: boolean } = {},
  ) {
    await prisma.playerWeekAvailability.upsert({
      where: { weekId_rankableEntryId: { weekId, rankableEntryId } },
      create: { weekId, rankableEntryId, designation, sourceType: "MANUAL", manualOverride: extra.manualOverride ?? false, observedAt: new Date() },
      update: { designation, manualOverride: extra.manualOverride ?? false },
    });
  }

  async function markRosterSynced(at: Date | null = new Date()) {
    await prisma.season.update({ where: { id: season.id }, data: { rosterSyncedAt: at } });
  }

  /** Rankings weekly pool rows (read-only completeness cross-check). */
  async function addRankingsPool(weekId: string, position: ContestPosition, rankableEntryIds: string[]) {
    const contest = await prisma.rankIQContest.create({
      data: { seasonId: season.id, weekId, position, title: `${position} ${suffix}`, rankingDepth: 5 },
    });
    for (const rankableEntryId of rankableEntryIds) {
      await prisma.contestEntry.create({ data: { contestId: contest.id, rankableEntryId } });
    }
  }

  async function freezeSnapshot(input: { weekId: string; rows: SnapshotRowSpec[]; supersedesId?: string }) {
    const previous = await prisma.waiverSnapshot.findFirst({
      where: { weekId: input.weekId },
      orderBy: { version: "desc" },
      select: { id: true, version: true },
    });
    const version = (previous?.version ?? 0) + 1;
    return prisma.$transaction(async (tx) => {
      if (input.supersedesId) {
        await tx.waiverSnapshot.update({
          where: { id: input.supersedesId },
          data: { status: "SUPERSEDED", currentForWeekId: null },
        });
      }
      const eligibleCount = input.rows.filter((r) => (r.eligibility ?? "ELIGIBLE") === "ELIGIBLE" && (r.evidenceRole ?? "CANDIDATE") === "CANDIDATE").length;
      const snapshot = await tx.waiverSnapshot.create({
        data: {
          seasonId: season.id,
          weekId: input.weekId,
          version,
          currentForWeekId: input.weekId,
          sourceLabel: "Sleeper",
          observedAt: new Date(Date.now() - HOUR),
          frozenByUserId: admin.id,
          rawInputSha256: `raw-${suffix}-${version}`,
          entriesFingerprint: `fp-${suffix}-${version}`,
          candidateCount: input.rows.filter((r) => (r.evidenceRole ?? "CANDIDATE") === "CANDIDATE").length,
          eligibleCount,
          excludedCount: input.rows.filter((r) => r.eligibility === "EXCLUDED").length,
          followUpCount: input.rows.filter((r) => r.evidenceRole === "FOLLOW_UP").length,
          supersedesId: input.supersedesId ?? null,
          correctionCase: input.supersedesId ? "OPEN_WITH_SUBMISSIONS" : null,
          correctionReason: input.supersedesId ? "fixture correction" : null,
        },
      });
      let line = 0;
      for (const row of input.rows) {
        line += 1;
        const role = row.evidenceRole ?? "CANDIDATE";
        const eligibility = role === "FOLLOW_UP" ? "OBSERVATION_ONLY" : (row.eligibility ?? "ELIGIBLE");
        const identity = await tx.rankableEntry.findUniqueOrThrow({ where: { id: row.player.id }, select: { provider: true, externalId: true } });
        await tx.waiverSnapshotEntry.create({
          data: {
            snapshotId: snapshot.id,
            rankableEntryId: row.player.id,
            evidenceRole: role,
            position: row.player.position,
            displayNameAtFreeze: row.player.name,
            teamAtFreeze: row.team ?? "SF",
            opponentAtFreeze: row.opponent ?? null,
            nflGameId: row.nflGameId ?? null,
            rosteredBps: row.rosteredBps ?? (eligibility === "EXCLUDED" ? 6000 : 1200),
            sourceLabel: "Sleeper",
            observedAt: new Date(Date.now() - HOUR),
            inputLineNumber: line,
            inputLine: `${row.player.name}, SF`,
            matchMethod: "EXACT_NAME_TEAM",
            eligibility,
            exclusionReason: eligibility === "EXCLUDED" ? "AT_OR_ABOVE_THRESHOLD" : null,
            isByeAtFreeze: false,
            hardUnavailableAtFreeze: false,
            identityProviderAtFreeze: identity.provider,
            identityExternalIdAtFreeze: identity.externalId,
          },
        });
      }
      return snapshot;
    }, { timeout: 120_000 });
  }

  /** Direct contest row (bypasses the opening service) locking `locksInMs` from now. */
  async function createContest(input: { weekId: string; snapshotId: string; position: ContestPosition; locksInMs?: number }) {
    const locksAt = new Date(Date.now() + (input.locksInMs ?? HOUR));
    const position = input.position as (typeof WAIVER_POSITIONS)[number];
    return prisma.waiverContest.create({
      data: {
        weekId: input.weekId,
        position: input.position,
        snapshotId: input.snapshotId,
        maxCalls: WAIVER_MAX_CALLS[position],
        resultFieldSize: WAIVER_RESULT_FIELD_SIZE[position],
        scoringVersion: WAIVER_EYEQ_V1.slug,
        opensAt: new Date(locksAt.getTime() - 2 * HOUR),
        locksAt,
        openedByUserId: admin.id,
      },
    });
  }

  /** Moves a contest's lock window so it locks at `at` (no waiting). */
  async function moveLock(contestId: string, at: Date) {
    await withFixtureMaintenance((tx) =>
      tx.waiverContest.update({
        where: { id: contestId },
        data: { locksAt: at, opensAt: new Date(at.getTime() - 2 * HOUR) },
      }),
    );
  }

  /**
   * Simulates the lock instant passing: moves locksAt to `at` (default: now,
   * i.e. after every write so far) and waits until the clock is past it.
   */
  async function passLock(contestId: string, at: Date = new Date()) {
    await moveLock(contestId, at);
    const waitMs = at.getTime() - Date.now() + 10;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    return at;
  }

  async function cleanup() {
    await withFixtureMaintenance(async (tx) => {
      const contests = await tx.waiverContest.findMany({ where: { weekId: { in: weekIds } }, select: { id: true } });
      const contestIds = contests.map((c) => c.id);
      const submissions = await tx.waiverSubmission.findMany({ where: { contestId: { in: contestIds } }, select: { id: true } });
      const submissionIds = submissions.map((s) => s.id);
      await tx.waiverSubmission.updateMany({
        where: { id: { in: submissionIds } },
        data: { currentRevisionId: null, lockedRevisionId: null },
      });
      await tx.waiverAiLateEntryApproval.deleteMany({ where: { contestId: { in: contestIds } } });
      await tx.waiverAiLateEntryVerification.deleteMany({ where: { contestId: { in: contestIds } } });
      await tx.waiverAiResponse.deleteMany({ where: { contestId: { in: contestIds } } });
      await tx.waiverAiHistoricalEvidenceReview.deleteMany({ where: { evidence: { contestId: { in: contestIds } } } });
      await tx.waiverAiHistoricalEvidence.deleteMany({ where: { contestId: { in: contestIds } } });
      await tx.waiverCall.deleteMany({ where: { revision: { submissionId: { in: submissionIds } } } });
      await tx.waiverSubmissionRevision.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await tx.waiverSubmission.deleteMany({ where: { id: { in: submissionIds } } });
      await tx.waiverContest.deleteMany({ where: { id: { in: contestIds } } });
      await tx.adminAuditLog.deleteMany({ where: { adminUserId: { in: userIds } } });
      const snapshots = await tx.waiverSnapshot.findMany({
        where: { weekId: { in: weekIds } },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      await tx.waiverSnapshotCorrection.deleteMany({ where: { toSnapshotId: { in: snapshots.map((s) => s.id) } } });
      await tx.waiverSnapshotEntry.deleteMany({ where: { snapshotId: { in: snapshots.map((s) => s.id) } } });
      for (const snapshot of snapshots) await tx.waiverSnapshot.delete({ where: { id: snapshot.id } });
    });
    await prisma.manualImportLog.deleteMany({ where: { adminUserId: { in: userIds } } });
    await prisma.playerWeekAvailability.deleteMany({ where: { weekId: { in: weekIds } } });
    await prisma.rankIQContest.deleteMany({ where: { weekId: { in: weekIds } } });
    await prisma.nflGame.deleteMany({ where: { weekId: { in: weekIds } } });
    await prisma.week.deleteMany({ where: { id: { in: weekIds } } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.rankableEntry.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.universalProfile.deleteMany({ where: { id: { in: profileIds } } });
  }

  return {
    suffix,
    year,
    seasonId: season.id,
    adminUserId: admin.id,
    addParticipant,
    addAiCompetitor,
    addAdmin,
    addPlayers,
    addRosterPlayer,
    addWeek,
    setAvailability,
    markRosterSynced,
    addRankingsPool,
    freezeSnapshot,
    createContest,
    moveLock,
    passLock,
    cleanup,
  };
}

export type WaiverFixture = Awaited<ReturnType<typeof createWaiverFixture>>;

/** Expects a promise to be rejected by a named Waiver database guard. */
export async function expectDbGuard(promise: Promise<unknown>, code: "WAIVER_LOCKED" | "WAIVER_INVALID" | "WAIVER_IMMUTABLE") {
  let error: unknown = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  if (!error) throw new Error(`Expected ${code} rejection, but the write succeeded`);
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes(code)) throw new Error(`Expected ${code}, got: ${message.slice(0, 300)}`);
}
