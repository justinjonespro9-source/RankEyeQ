import { describe, expect, it } from "vitest";
import {
  allBallotsFromGroups,
  classifyOverDepthGrade,
  contributingGroupsFromCounts,
  emptySegmentCounts,
  formatWeek1RepairDryRun,
  type Week1RepairPlan,
} from "@/lib/week1-repair-plan";

describe("classifyOverDepthGrade", () => {
  it("marks over-depth gradeable boards as GRADE_TOP_N at rankingDepth", () => {
    expect(classifyOverDepthGrade({ pickCount: 11, rankingDepth: 10 })).toEqual(
      {
        action: "GRADE_TOP_N",
        scoringDepthUsed: 10,
      },
    );
    expect(classifyOverDepthGrade({ pickCount: 12, rankingDepth: 10 })).toEqual(
      {
        action: "GRADE_TOP_N",
        scoringDepthUsed: 10,
      },
    );
    expect(classifyOverDepthGrade({ pickCount: 17, rankingDepth: 15 })).toEqual(
      {
        action: "GRADE_TOP_N",
        scoringDepthUsed: 15,
      },
    );
  });

  it("returns null for exact-depth boards", () => {
    expect(
      classifyOverDepthGrade({ pickCount: 10, rankingDepth: 10 }),
    ).toBeNull();
  });

  it("returns null for incomplete or beyond gradeable ceiling", () => {
    expect(
      classifyOverDepthGrade({ pickCount: 9, rankingDepth: 10 }),
    ).toBeNull();
    expect(
      classifyOverDepthGrade({ pickCount: 13, rankingDepth: 10 }),
    ).toBeNull();
  });
});

describe("segment ballot helpers", () => {
  it("computes All ballots from non-empty Human/Expert/Creator/AI groups", () => {
    const counts = emptySegmentCounts();
    counts.HUMAN = 1;
    counts.AI = 8;
    counts.EXPERT = 12;
    counts.CREATOR = 1;
    counts.PUBLISHER = 3;
    const groups = contributingGroupsFromCounts(counts);
    expect(groups).toEqual(["HUMAN", "EXPERT", "CREATOR", "AI"]);
    expect(allBallotsFromGroups(counts, groups)).toBe(22);
  });

  it("omits empty Creator from DEF-style group set", () => {
    const counts = emptySegmentCounts();
    counts.HUMAN = 1;
    counts.AI = 8;
    counts.EXPERT = 10;
    const groups = contributingGroupsFromCounts(counts);
    expect(groups).toEqual(["HUMAN", "EXPERT", "AI"]);
    expect(allBallotsFromGroups(counts, groups)).toBe(19);
  });
});

describe("formatWeek1RepairDryRun", () => {
  it("prints GRADE_TOP_N lines and zero-write safety for dry runs", () => {
    const plan: Week1RepairPlan = {
      weekId: "w1",
      weekLabel: "Week 1",
      weekStatus: "OPEN",
      canonicalLock: "2026-09-13T15:00:00.000Z",
      snapshotPlans: [
        {
          position: "RB",
          contestId: "c-rb",
          existingSnapshotId: "snap-rb",
          existingLockedAt: "2026-09-06T15:00:00.000Z",
          existingSampleCounts: {
            sampleSizeAll: 1,
            sampleSizeHuman: 1,
            sampleSizeAi: 0,
            sampleSizeExpert: 0,
            sampleSizeCreator: 0,
            sampleSizePublisher: 0,
          },
          existingEntryCount: 40,
          replacementLockedAt: "2026-09-13T15:00:00.000Z",
          reconstructedCounts: {
            HUMAN: 1,
            AI: 8,
            EXPERT: 12,
            CREATOR: 2,
            PUBLISHER: 0,
          },
          allBallots: 23,
          contributingGroups: ["HUMAN", "EXPERT", "CREATOR", "AI"],
          contributingGroupCount: 4,
          wouldDeleteSnapshotRows: 1,
          wouldDeleteSnapshotEntries: 40,
          wouldCreateSnapshotRows: 1,
          wouldCreateSnapshotEntries: 40,
          qualifyingSubmissionIds: ["s1"],
        },
      ],
      gradingPlans: [
        {
          position: "RB",
          contestId: "c-rb",
          currentStatus: "LOCKED",
          rankingDepth: 10,
          reserveCount: 0,
          rankedEntryCount: 40,
          consideredCount: 30,
          willGradeCount: 28,
          skipCount: 2,
          alreadyGradedCount: 0,
          skipReasons: { "incomplete: pickCount 8 < rankingDepth 10": 2 },
          overDepthBoards: [
            {
              displayName: "Heath Cummings",
              submissionId: "h1",
              status: "LOCKED",
              pickCount: 11,
              rankingDepth: 10,
              action: "GRADE_TOP_N",
              scoringDepthUsed: 10,
            },
            {
              displayName: "Dave Richard",
              submissionId: "d1",
              status: "LOCKED",
              pickCount: 11,
              rankingDepth: 10,
              action: "GRADE_TOP_N",
              scoringDepthUsed: 10,
            },
          ],
          skips: [],
          expectedFinalStatus: "FINAL",
          normalizedScoreWrites: 28,
        },
      ],
      lifecycle: {
        expectedContestStatuses: { RB: "FINAL" },
        expectedWeekStatus: "COMPLETE",
        totalGradedSubmissions: 28,
        totalNormalizedScoreWrites: 28,
        totalSkippedIncompletes: 2,
        pickMutations: false,
        actualRankFantasyPointsMutations: false,
      },
      allQualifyingSubmissionIds: ["s1"],
    };

    const text = formatWeek1RepairDryRun(plan);
    expect(text).toContain("SNAPSHOT REBUILD PLAN");
    expect(text).toContain("GRADE_TOP_N");
    expect(text).toContain("Heath Cummings");
    expect(text).toContain("Dave Richard");
    expect(text).toContain('"writesExecuted": 0');
    expect(text).toContain('"snapshotDeletes": 0');
    expect(text).toContain('"pickMutations": false');
  });
});
