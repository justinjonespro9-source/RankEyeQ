import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AiHistoricalBackfillError,
  commitAiHistoricalBoard,
  previewAiHistoricalBoard,
} from "@/lib/rankings/ai-historical-backfill";
import { prisma } from "@/lib/db";
import { saveSubmissionPicks, SubmissionError } from "@/lib/submissions";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `aihbf${Date.now()}`;
const thursdayKickoff = zonedLocalToUtc(2026, 11, 19, 19, 15); // ~01:15Z Nov 20
const sundayKickoff = zonedLocalToUtc(2026, 11, 22, 12, 0);
const sundayLock = zonedLocalToUtc(2026, 11, 22, 10, 0);
const rankingsOpen = zonedLocalToUtc(2026, 11, 17, 0, 0);
const preKickoffPrediction = zonedLocalToUtc(2026, 11, 19, 18, 40);
const postKickoffPrediction = zonedLocalToUtc(2026, 11, 19, 20, 0);
const afterLockPrediction = zonedLocalToUtc(2026, 11, 22, 11, 0);
const fridayCapture = zonedLocalToUtc(2026, 11, 20, 14, 0);

describe("Rankings AI verified historical backfill (integration)", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let adminUserId = "";
  let aiProfileId = "";
  let aiDupProfileId = "";
  let aiExtraProfileId = "";
  let humanProfileId = "";
  let humanSubmissionId = "";
  let entryIds: string[] = [];
  let thursdayIds: string[] = [];
  let sundayIds: string[] = [];

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: 2097, sport: `AI-HBF-${suffix}`, active: false },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 11,
        label: "AI Historical Fixture Week",
        startsAt: rankingsOpen,
        endsAt: zonedLocalToUtc(2026, 11, 24, 0, 0),
        status: "OPEN",
        rankingsOpenAt: rankingsOpen,
        fullLockAt: sundayLock,
        isTest: true,
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "AI Historical RB",
        rankingDepth: 4,
        reserveCount: 0,
        status: "OPEN",
      },
    });
    contestId = contest.id;

    const admin = await prisma.user.create({
      data: {
        email: `admin-aihbf-${suffix}@example.com`,
        name: "AI Historical Admin",
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;

    const ai = await prisma.universalProfile.create({
      data: {
        username: `ai-hbf-${suffix}`,
        displayName: "Fixture Claude",
        profileType: "AI",
        universalUserId: `uu_ai_${suffix}`,
        competitorActive: true,
        publicVisible: true,
        status: "ACTIVE",
      },
    });
    aiProfileId = ai.id;

    const aiDup = await prisma.universalProfile.create({
      data: {
        username: `ai-hbf-dup-${suffix}`,
        displayName: "Fixture GPT",
        profileType: "AI",
        universalUserId: `uu_ai_dup_${suffix}`,
        competitorActive: true,
        publicVisible: true,
        status: "ACTIVE",
      },
    });
    aiDupProfileId = aiDup.id;

    const aiExtra = await prisma.universalProfile.create({
      data: {
        username: `ai-hbf-x-${suffix}`,
        displayName: "Fixture Extra AI",
        profileType: "AI",
        universalUserId: `uu_ai_x_${suffix}`,
        competitorActive: true,
        publicVisible: true,
        status: "ACTIVE",
      },
    });
    aiExtraProfileId = aiExtra.id;

    const human = await prisma.universalProfile.create({
      data: {
        username: `human-hbf-${suffix}`,
        displayName: "Fixture Human",
        profileType: "HUMAN",
        universalUserId: `uu_human_${suffix}`,
        competitorActive: true,
        publicVisible: true,
        status: "ACTIVE",
      },
    });
    humanProfileId = human.id;

    const gameThu = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `ai-thu-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2097,
        weekNumber: 11,
        homeTeam: "BUF",
        awayTeam: "DET",
        startsAt: thursdayKickoff,
        status: "FINAL",
      },
    });
    const gameSun = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `ai-sun-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2097,
        weekNumber: 11,
        homeTeam: "KC",
        awayTeam: "PHI",
        startsAt: sundayKickoff,
        status: "SCHEDULED",
      },
    });

    // Pool/identity createdAt must predate the claimed prediction time so
    // historical pool integrity checks treat these as valid original options.
    const poolCreatedAt = zonedLocalToUtc(2026, 11, 17, 12, 0);
    const players = [];
    for (let i = 0; i < 4; i += 1) {
      const isThu = i < 2;
      const kickoff = isThu ? thursdayKickoff : sundayKickoff;
      const gameId = isThu ? gameThu.id : gameSun.id;
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `ai-rb-${suffix}-${i}`,
          type: "PLAYER",
          name: `AI RB ${i + 1}`,
          shortName: `AIRB${i + 1}`,
          team: isThu ? "BUF" : "KC",
          opponent: isThu ? "DET" : "PHI",
          position: "RB",
          active: true,
          availability: "ACTIVE",
          gameStartsAt: kickoff,
          gameId,
          createdAt: poolCreatedAt,
        },
      });
      players.push(entry);
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: entry.id,
          gameId,
          actualRank: null,
          fantasyPoints: null,
          createdAt: poolCreatedAt,
        },
      });
    }
    entryIds = players.map((p) => p.id);
    thursdayIds = entryIds.slice(0, 2);
    sundayIds = entryIds.slice(2);

    // Pre-existing human board on the same contest — must remain untouched.
    const humanSub = await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: humanProfileId,
        status: "LOCKED",
        submittedAt: preKickoffPrediction,
        lockedAt: preKickoffPrediction,
        authority: "OWNER_AUTHORED",
        historicalBackfill: false,
        picks: {
          create: entryIds.map((rankableEntryId, index) => ({
            rankableEntryId,
            predictedRank: index + 1,
            committedAt: preKickoffPrediction,
          })),
        },
      },
    });
    humanSubmissionId = humanSub.id;
  });

  afterAll(async () => {
    await prisma.rankingAiHistoricalProvenance.deleteMany({
      where: { contestId },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { adminUserId },
    });
    await prisma.rankingPick.deleteMany({
      where: { submission: { contestId } },
    });
    await prisma.rankingSubmission.deleteMany({ where: { contestId } });
    await prisma.playerWeekAvailability.deleteMany({ where: { weekId } });
    await prisma.contestEntry.deleteMany({ where: { contestId } });
    await prisma.rankableEntry.deleteMany({
      where: {
        provider: "test",
        OR: [
          { externalId: { startsWith: `ai-rb-${suffix}` } },
          { externalId: `ai-rb-late-${suffix}` },
        ],
      },
    });
    await prisma.nflGame.deleteMany({
      where: {
        provider: "test",
        externalId: { in: [`ai-thu-${suffix}`, `ai-sun-${suffix}`] },
      },
    });
    await prisma.rankIQContest.deleteMany({ where: { id: contestId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.universalProfile.deleteMany({
      where: {
        id: {
          in: [
            aiProfileId,
            aiDupProfileId,
            aiExtraProfileId,
            humanProfileId,
          ],
        },
      },
    });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
  });

  const baseEvidence = {
    evidenceType: "CHAT_TRANSCRIPT",
    evidenceReference: `vault://fixture-${suffix}/claude-rb`,
    sourceIdentifier: `chat-${suffix}`,
    rawResponseText: "1. AI RB 1\n2. AI RB 2\n3. AI RB 3\n4. AI RB 4",
    attestationAccepted: true,
  };

  it("rejects missing evidence / attestation", async () => {
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      evidenceType: "CHAT_TRANSCRIPT",
      evidenceReference: "   ",
      attestationAccepted: false,
      capturedAt: fridayCapture,
    });
    expect(preview.status).toBe("BLOCKED");
    expect(preview.blockers.some((b) => /evidence reference/i.test(b))).toBe(
      true,
    );
    expect(preview.blockers.some((b) => /attestation/i.test(b))).toBe(true);
  });

  it("rejects original prediction after Sunday full lock", async () => {
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: afterLockPrediction,
      ...baseEvidence,
      capturedAt: afterLockPrediction,
    });
    expect(preview.status).toBe("BLOCKED");
    expect(preview.blockers.some((b) => /full lock/i.test(b))).toBe(true);
  });

  it("rejects Thursday players when original prediction is after kickoff", async () => {
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: postKickoffPrediction,
      ...baseEvidence,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("BLOCKED");
    expect(
      preview.pickIssues.some((p) => p.code === "KICKED_OFF_AT_PREDICTION"),
    ).toBe(true);
    expect(preview.thursdayPlayerCount).toBe(0);
  });

  it("later OUT after legitimate prediction stays READY with warning (never auto-invalidates)", async () => {
    await prisma.playerWeekAvailability.create({
      data: {
        weekId,
        rankableEntryId: thursdayIds[0]!,
        designation: "OUT",
        sourcePublishedAt: fridayCapture,
        observedAt: fridayCapture,
        sourceType: "MANUAL",
      },
    });

    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("READY");
    expect(preview.ready).toBe(true);
    expect(
      preview.pickIssues.some((p) => p.code === "LATER_OUT_AFTER_PREDICTION"),
    ).toBe(true);
    expect(preview.warnings.some((w) => /not applied retroactively/i.test(w))).toBe(
      true,
    );

    await prisma.playerWeekAvailability.deleteMany({
      where: { weekId, rankableEntryId: thursdayIds[0]! },
    });
  });

  it("warns on later team correction without changing identity eligibility", async () => {
    const targetId = sundayIds[0]!;
    await prisma.contestEntry.update({
      where: {
        contestId_rankableEntryId: {
          contestId,
          rankableEntryId: targetId,
        },
      },
      data: { weekTeam: "BUF" },
    });
    await prisma.rankableEntry.update({
      where: { id: targetId },
      data: { team: "KC" },
    });

    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("READY");
    expect(
      preview.warnings.some((w) => /weekTeam=BUF.*team=KC/i.test(w)),
    ).toBe(true);

    await prisma.contestEntry.update({
      where: {
        contestId_rankableEntryId: {
          contestId,
          rankableEntryId: targetId,
        },
      },
      data: { weekTeam: null },
    });
  });

  it("HOLDs when contest pool row was added after claimed prediction time", async () => {
    const latePlayer = await prisma.rankableEntry.create({
      data: {
        provider: "test",
        externalId: `ai-rb-late-${suffix}`,
        type: "PLAYER",
        name: "Late Add RB",
        shortName: "LATE",
        team: "KC",
        opponent: "PHI",
        position: "RB",
        active: true,
        availability: "ACTIVE",
        createdAt: preKickoffPrediction,
      },
    });
    const lateEntry = await prisma.contestEntry.create({
      data: {
        contestId,
        rankableEntryId: latePlayer.id,
        createdAt: fridayCapture, // after prediction
      },
    });

    const ranked = [...entryIds.slice(0, 3), latePlayer.id];
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: ranked,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("HOLD");
    expect(
      preview.pickIssues.some((p) => p.code === "POOL_ADDED_AFTER_PREDICTION"),
    ).toBe(true);
    await expect(
      commitAiHistoricalBoard({
        contestId,
        universalProfileId: aiProfileId,
        adminUserId,
        rankedEntryIds: ranked,
        originalPredictionAt: preKickoffPrediction,
        ...baseEvidence,
        previewFingerprint: preview.previewFingerprint,
        capturedAt: fridayCapture,
      }),
    ).rejects.toMatchObject({ code: "HOLD" });

    await prisma.contestEntry.delete({ where: { id: lateEntry.id } });
    await prisma.rankableEntry.delete({ where: { id: latePlayer.id } });
  });

  it("rejects stale Preview fingerprint on commit", async () => {
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiExtraProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      evidenceReference: `vault://fixture-${suffix}/stale`,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("READY");
    await expect(
      commitAiHistoricalBoard({
        contestId,
        universalProfileId: aiExtraProfileId,
        adminUserId,
        rankedEntryIds: entryIds,
        originalPredictionAt: preKickoffPrediction,
        ...baseEvidence,
        evidenceReference: `vault://fixture-${suffix}/stale`,
        previewFingerprint: "not-the-real-fingerprint",
        capturedAt: fridayCapture,
      }),
    ).rejects.toMatchObject({ code: "STALE_PREVIEW" });

    const orphan = await prisma.rankingSubmission.findUnique({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: aiExtraProfileId,
        },
      },
    });
    expect(orphan).toBeNull();
  });

  it("rolls back atomically when audit/provenance actor is invalid", async () => {
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiExtraProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      evidenceReference: `vault://fixture-${suffix}/atomic`,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("READY");

    await expect(
      commitAiHistoricalBoard({
        contestId,
        universalProfileId: aiExtraProfileId,
        adminUserId: "missing-admin-actor-id",
        rankedEntryIds: entryIds,
        originalPredictionAt: preKickoffPrediction,
        ...baseEvidence,
        evidenceReference: `vault://fixture-${suffix}/atomic`,
        previewFingerprint: preview.previewFingerprint,
        capturedAt: fridayCapture,
      }),
    ).rejects.toBeTruthy();

    const orphan = await prisma.rankingSubmission.findUnique({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: aiExtraProfileId,
        },
      },
      include: { picks: true, aiHistoricalProvenance: true },
    });
    expect(orphan).toBeNull();
  });

  it("blocks concurrent duplicate commits for the same AI + contest", async () => {
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiExtraProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      evidenceReference: `vault://fixture-${suffix}/concurrent`,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("READY");

    const input = {
      contestId,
      universalProfileId: aiExtraProfileId,
      adminUserId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      evidenceReference: `vault://fixture-${suffix}/concurrent`,
      previewFingerprint: preview.previewFingerprint,
      capturedAt: fridayCapture,
    };

    const settled = await Promise.allSettled([
      commitAiHistoricalBoard(input),
      commitAiHistoricalBoard(input),
    ]);
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const boards = await prisma.rankingSubmission.findMany({
      where: {
        contestId,
        universalProfileId: aiExtraProfileId,
      },
      include: { picks: true, aiHistoricalProvenance: true },
    });
    expect(boards).toHaveLength(1);
    expect(boards[0]!.picks).toHaveLength(4);
    expect(boards[0]!.aiHistoricalProvenance).not.toBeNull();
  });

  it("blocks hard-unavailable with dated evidence before prediction", async () => {
    await prisma.playerWeekAvailability.create({
      data: {
        weekId,
        rankableEntryId: thursdayIds[1]!,
        designation: "OUT",
        sourcePublishedAt: zonedLocalToUtc(2026, 11, 18, 12, 0),
        observedAt: zonedLocalToUtc(2026, 11, 18, 12, 0),
        sourceType: "MANUAL",
      },
    });

    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("BLOCKED");
    expect(
      preview.pickIssues.some(
        (p) => p.code === "HARD_UNAVAILABLE_BEFORE_PREDICTION",
      ),
    ).toBe(true);

    await prisma.playerWeekAvailability.deleteMany({
      where: { weekId, rankableEntryId: thursdayIds[1]! },
    });
  });

  it("commits valid pre-kickoff historical board with dual-clock provenance", async () => {
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("READY");
    expect(preview.thursdayPlayerCount).toBe(2);
    expect(preview.competitiveAt).toBe(preKickoffPrediction.toISOString());
    expect(preview.capturedAt).toBe(fridayCapture.toISOString());

    const result = await commitAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      adminUserId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      previewFingerprint: preview.previewFingerprint,
      capturedAt: fridayCapture,
    });

    expect(result.historicalBackfill).toBe(true);
    expect(result.competitiveAt).toBe(preKickoffPrediction.toISOString());
    expect(result.capturedAt).toBe(fridayCapture.toISOString());

    const submission = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: aiProfileId,
        },
      },
      include: {
        picks: { orderBy: { predictedRank: "asc" } },
        aiHistoricalProvenance: true,
      },
    });

    expect(submission.status).toBe("LOCKED");
    expect(submission.historicalBackfill).toBe(true);
    expect(submission.authority).toBe("SYSTEM_OPERATED");
    expect(submission.submittedAt?.toISOString()).toBe(
      preKickoffPrediction.toISOString(),
    );
    expect(submission.lockedAt?.toISOString()).toBe(
      preKickoffPrediction.toISOString(),
    );
    // createdAt is wall-clock insert — never backdated to prediction time
    expect(submission.createdAt.getTime()).toBeGreaterThan(
      preKickoffPrediction.getTime(),
    );

    expect(submission.picks.map((p) => p.rankableEntryId)).toEqual(entryIds);
    expect(submission.picks.every((p) => p.slotLocked === false)).toBe(true);

    const prov = submission.aiHistoricalProvenance;
    expect(prov).not.toBeNull();
    expect(prov!.originalPredictionAt.toISOString()).toBe(
      preKickoffPrediction.toISOString(),
    );
    expect(prov!.capturedAt.toISOString()).toBe(fridayCapture.toISOString());
    expect(prov!.evidenceType).toBe("CHAT_TRANSCRIPT");
    expect(prov!.evidenceReference).toContain(suffix);
    expect(prov!.adminUserId).toBe(adminUserId);
    expect(Array.isArray(prov!.rankedEntryIds)).toBe(true);
    expect(prov!.rankedEntryIds).toEqual(entryIds);

    const audit = await prisma.adminAuditLog.findUniqueOrThrow({
      where: { id: result.auditLogId },
    });
    expect(audit.action).toBe("ai.board_locked_historical_backfill");

    // Existing human board on this contest must be unchanged.
    const human = await prisma.rankingSubmission.findUniqueOrThrow({
      where: { id: humanSubmissionId },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });
    expect(human.historicalBackfill).toBe(false);
    expect(human.status).toBe("LOCKED");
    expect(human.universalProfileId).toBe(humanProfileId);
    expect(human.picks.map((p) => p.rankableEntryId)).toEqual(entryIds);
  });

  it("blocks duplicate historical board for same AI + contest", async () => {
    const preview = await previewAiHistoricalBoard({
      contestId,
      universalProfileId: aiProfileId,
      rankedEntryIds: entryIds,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("BLOCKED");
    expect(preview.blockers.some((b) => /already has a board/i.test(b))).toBe(
      true,
    );
  });

  it("blocks normal edits on historicalBackfill submissions", async () => {
    await expect(
      saveSubmissionPicks({
        contestId,
        universalProfileId: aiProfileId,
        rankedEntryIds: [...sundayIds, ...thursdayIds],
        authority: "SYSTEM_OPERATED",
        requireComplete: false,
      }),
    ).rejects.toBeInstanceOf(SubmissionError);
  });

  it("retains reserve order on a reserve-enabled contest", async () => {
    const reserveContest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "WR",
        title: "AI Historical WR reserves",
        rankingDepth: 10,
        reserveCount: 2,
        status: "OPEN",
      },
    });

    const poolCreatedAt = zonedLocalToUtc(2026, 11, 17, 12, 0);
    const reserveEntries: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `ai-wr-${suffix}-${i}`,
          type: "PLAYER",
          name: `AI WR ${i + 1}`,
          shortName: `AIWR${i + 1}`,
          team: "KC",
          opponent: "PHI",
          position: "WR",
          active: true,
          availability: "ACTIVE",
          createdAt: poolCreatedAt,
        },
      });
      reserveEntries.push(entry.id);
      await prisma.contestEntry.create({
        data: {
          contestId: reserveContest.id,
          rankableEntryId: entry.id,
          createdAt: poolCreatedAt,
        },
      });
    }

    const ordered = [...reserveEntries].reverse();
    const preview = await previewAiHistoricalBoard({
      contestId: reserveContest.id,
      universalProfileId: aiDupProfileId,
      rankedEntryIds: ordered,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      evidenceReference: `vault://fixture-${suffix}/gpt-wr`,
      capturedAt: fridayCapture,
      now: fridayCapture,
    });
    expect(preview.status).toBe("READY");
    expect(preview.rankedEntryIds).toEqual(ordered);

    const result = await commitAiHistoricalBoard({
      contestId: reserveContest.id,
      universalProfileId: aiDupProfileId,
      adminUserId,
      rankedEntryIds: ordered,
      originalPredictionAt: preKickoffPrediction,
      ...baseEvidence,
      evidenceReference: `vault://fixture-${suffix}/gpt-wr`,
      previewFingerprint: preview.previewFingerprint,
      capturedAt: fridayCapture,
    });

    const picks = await prisma.rankingPick.findMany({
      where: { submissionId: result.submissionId },
      orderBy: { predictedRank: "asc" },
    });
    expect(picks).toHaveLength(12);
    expect(picks.map((p) => p.rankableEntryId)).toEqual(ordered);
    expect(picks[10]!.predictedRank).toBe(11);
    expect(picks[11]!.predictedRank).toBe(12);

    await prisma.rankingAiHistoricalProvenance.deleteMany({
      where: { contestId: reserveContest.id },
    });
    await prisma.rankingPick.deleteMany({
      where: { submission: { contestId: reserveContest.id } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contestId: reserveContest.id },
    });
    await prisma.contestEntry.deleteMany({
      where: { contestId: reserveContest.id },
    });
    await prisma.rankableEntry.deleteMany({
      where: {
        provider: "test",
        externalId: { startsWith: `ai-wr-${suffix}` },
      },
    });
    await prisma.rankIQContest.deleteMany({ where: { id: reserveContest.id } });
  });
});
