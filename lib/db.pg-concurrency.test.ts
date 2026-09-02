import "dotenv/config";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { prisma } from "@/lib/db";
import { getPublicPositionContest } from "@/lib/contests";
import {
  getOrCreateDraftSubmission,
  submitRanking,
  SubmissionError,
} from "@/lib/submissions";

function installOverlapCounter() {
  const original = pg.Client.prototype.query;
  const inflight = new WeakMap<object, number>();
  let overlaps = 0;

  // Loose patch — only used to count same-client concurrency in tests.
  (pg.Client.prototype as { query: (...args: unknown[]) => unknown }).query =
    function patched(this: object, ...args: unknown[]) {
      const n = inflight.get(this) ?? 0;
      if (n > 0) overlaps += 1;
      inflight.set(this, n + 1);
      const result = (
        original as unknown as (this: object, ...a: unknown[]) => unknown
      ).apply(this, args);
      const done = () => inflight.set(this, (inflight.get(this) ?? 1) - 1);
      if (result && typeof (result as { then?: unknown }).then === "function") {
        return (result as Promise<unknown>).finally(done);
      }
      done();
      return result;
    };

  return {
    get overlaps() {
      return overlaps;
    },
    restore() {
      pg.Client.prototype.query = original;
    },
  };
}

describe("ranking path avoids same-client concurrent pg queries", () => {
  it("PositionRankPage helpers + submitRanking do not overlap on one Client", async () => {
    const counter = installOverlapCounter();
    try {
      const contest = await getPublicPositionContest("qb");
      const profile = await prisma.universalProfile.findFirst({
        where: { profileType: "HUMAN", status: "ACTIVE" },
      });
      expect(contest.contestId).toBeTruthy();
      expect(profile).toBeTruthy();
      if (!contest.contestId || !profile) return;

      await getOrCreateDraftSubmission(contest.contestId, profile.id).catch(
        (error) => {
          if (!(error instanceof SubmissionError)) throw error;
        },
      );

      const ranked = contest.players
        .slice(0, contest.challenge.slotCount)
        .map((player) => player.id);
      try {
        await submitRanking({
          contestId: contest.contestId,
          universalProfileId: profile.id,
          rankedEntryIds: ranked,
        });
      } catch (error) {
        if (!(error instanceof SubmissionError)) throw error;
      }

      expect(counter.overlaps).toBe(0);
    } finally {
      counter.restore();
    }
  });

  it("write then findUnique include stays free of same-client overlap", async () => {
    const submission = await prisma.rankingSubmission.findFirst({
      where: { picks: { some: {} } },
    });
    expect(submission).toBeTruthy();
    if (!submission) return;

    const counter = installOverlapCounter();
    try {
      await prisma.rankingSubmission.update({
        where: { id: submission.id },
        data: { updatedAt: new Date() },
      });
      await prisma.rankingSubmission.findUniqueOrThrow({
        where: { id: submission.id },
        include: {
          picks: {
            include: { rankableEntry: { include: { game: true } } },
          },
          universalProfile: true,
          contest: true,
        },
      });
      expect(counter.overlaps).toBe(0);
    } finally {
      counter.restore();
    }
  });
});
