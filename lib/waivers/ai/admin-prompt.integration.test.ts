import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createWaiverFixture, expectDbGuard, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { createResultsFixture } from "@/lib/waivers/__fixtures__/results";
import { WAIVEREYEQ_AI_PROMPT_VERSION } from "@/lib/waivers/ai/constants";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { loadWaiverAiBoardView } from "@/lib/waivers/ai/queries";
import { importAiWaiverBoard, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { sha256Utf8 } from "@/lib/waivers/ai/text";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { submitWaiverBoard } from "@/lib/waivers/submissions";

/**
 * Stage 4B.3D: the admin AI board page shows the frozen prompt in every phase,
 * rebuilt from the contest's pinned snapshot (never live data), with its
 * provenance against the prompt hashes recorded on AI submissions.
 */

const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

afterAll(async () => {
  for (const fixture of fixtures) await fixture.cleanup();
});

async function importOnTime(f: WaiverFixture, contestId: string, profileId: string, text: string, pickIds: string[]) {
  const context = await loadWaiverAiContestContext(prisma, contestId);
  return importAiWaiverBoard({
    adminUserId: f.adminUserId,
    contestId,
    universalProfileId: profileId,
    responseText: text,
    expectedResponseSha256: sha256Utf8(text),
    expectedPromptSha256: context!.prompt.sha256,
    confirmedRankableEntryIds: pickIds,
    modelLabel: "Prompt model",
    statedGeneratedAt: null,
    sourceReference: null,
    sourceNote: null,
  });
}

describe("admin frozen prompt visibility", () => {
  it("is shown before and after the lock with the same version and sha256, from the pinned snapshot only", async () => {
    const f = await createWaiverFixture("aprompt");
    fixtures.push(f);
    const rb = await f.addPlayers("RB", 3);
    const week = await f.addWeek();
    const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: rb.map((player) => ({ player })) });
    const contestId = (await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "RB" })).id;
    const ai = (await f.addAiCompetitor("aprompt")).profileId;
    const other = (await f.addAiCompetitor("apromptother")).profileId;
    const human = await f.addParticipant("aprompthuman");

    const open = (await loadWaiverAiBoardView(ai, contestId))!;
    expect(open.phase).toBe("OPEN");
    expect(open.prompt.version).toBe(WAIVEREYEQ_AI_PROMPT_VERSION);
    expect(open.prompt.sha256).toBe(sha256Utf8(open.prompt.text));
    expect(open.prompt.text).toContain(`snapshot v${snapshot.version}, fingerprint ${snapshot.entriesFingerprint}`);
    for (const player of rb) expect(open.prompt.text).toContain(player.name);
    expect(open.prompt.provenance).toEqual({ status: "UNRECORDED", recordedResponses: 0, recordedHashes: [] });

    await importOnTime(f, contestId, other, `1. ${rb[1].name}\n`, [rb[1].id]);
    await submitWaiverBoard({ contestId, universalProfileId: human.profileId, userId: human.userId, playerIds: [rb[0].id] });
    const recorded = (await loadWaiverAiBoardView(ai, contestId))!;
    expect(recorded.prompt.provenance).toEqual({
      status: "CONFIRMED",
      recordedResponses: 1,
      recordedHashes: [{ version: WAIVEREYEQ_AI_PROMPT_VERSION, sha256: open.prompt.sha256 }],
    });

    await f.passLock(contestId, new Date(Date.now() + 5));
    await ensureWaiverContestLocked(contestId);
    // Live data changes after the freeze never reach the prompt.
    await prisma.rankableEntry.update({ where: { id: rb[2].id }, data: { name: "Renamed Live Player", shortName: "Renamed", team: "KC" } });

    const locked = (await loadWaiverAiBoardView(ai, contestId))!;
    expect(locked.phase).toBe("LOCKED");
    expect(locked.prompt).toMatchObject({ version: open.prompt.version, sha256: open.prompt.sha256, text: open.prompt.text });
    expect(locked.prompt.text).not.toContain("Renamed Live Player");
    expect(locked.prompt.provenance.status).toBe("CONFIRMED");

    // Participant and AI lock behavior is unchanged: ordinary writes are refused after the lock.
    await expect(submitWaiverBoard({ contestId, universalProfileId: human.profileId, userId: human.userId, playerIds: [rb[1].id] })).rejects.toThrow();
    await expect(importOnTime(f, contestId, ai, `1. ${rb[0].name}\n`, [rb[0].id])).rejects.toMatchObject({ code: "LOCKED" });
    await expect(importOnTime(f, contestId, ai, `1. ${rb[0].name}\n`, [rb[0].id])).rejects.toBeInstanceOf(WaiverAiError);
    await expectDbGuard(
      prisma.waiverSubmission.create({ data: { contestId, universalProfileId: ai, createdByUserId: f.adminUserId, authority: "SYSTEM_OPERATED" } }),
      "WAIVER_LOCKED",
    );
    expect(await prisma.waiverSubmission.count({ where: { contestId, universalProfileId: ai } })).toBe(0);
  });

  it("is shown after grading, unchanged, for the re-pinned snapshot rather than the superseded one", async () => {
    const f = await createResultsFixture("apromptgrade", { aiBoard: true });
    fixtures.push(f);
    const contestId = f.contests.DEF;
    const [v1, v2] = await Promise.all([
      prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: f.snapshots.v1 } }),
      prisma.waiverSnapshot.findUniqueOrThrow({ where: { id: f.snapshots.v2 } }),
    ]);
    const contest = await prisma.waiverContest.findUniqueOrThrow({ where: { id: contestId } });
    expect(contest.snapshotId).toBe(v2.id);

    const before = (await loadWaiverAiBoardView(f.ai!.profileId, contestId))!;
    expect(before.phase).toBe("LOCKED");
    expect(before.snapshot.id).toBe(v2.id);
    expect(before.prompt.text).toContain(`snapshot v${v2.version}, fingerprint ${v2.entriesFingerprint}`);
    expect(before.prompt.text).not.toContain(v1.entriesFingerprint);
    expect(before.prompt.provenance).toMatchObject({ status: "CONFIRMED", recordedResponses: 1 });
    const response = await prisma.waiverAiResponse.findFirstOrThrow({ where: { contestId, universalProfileId: f.ai!.profileId } });
    expect(response).toMatchObject({ promptVersion: before.prompt.version, promptSha256: before.prompt.sha256 });

    await f.gradeWeek();
    expect(await prisma.waiverGradeRun.count({ where: { weekId: f.weekId } })).toBeGreaterThan(0);
    const graded = (await loadWaiverAiBoardView(f.ai!.profileId, contestId))!;
    expect(graded.prompt).toEqual(before.prompt);
    expect(graded.lateSubmission.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/grade run/)]));
  });
});
