import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";
import { createResultsFixture } from "@/lib/waivers/__fixtures__/results";

/**
 * Stage 4B.3 commit-time verification benchmark (local synthetic data only).
 * Opt-in: RANKEYEQ_WAIVER_BENCH=1 [RANKEYEQ_WAIVER_BENCH_OUT=/path/report.txt] \
 *   npx vitest run lib/waivers/results/grading-scale.benchmark.integration.test.ts
 *
 * For each WR pool size, the week is graded end to end. Each write phase runs
 * in one transaction, timed as: row inserts (BEFORE guards and CHECKs), then
 * SET CONSTRAINTS ALL IMMEDIATE (every deferred commit-time check), then the
 * commit itself.
 */

const SIZES = [
  { wrPoolSize: 100, wrBoards: 50 },
  { wrPoolSize: 500, wrBoards: 250 },
  { wrPoolSize: 1000, wrBoards: 500 },
];
const TX = { maxWait: 10_000, timeout: 1_800_000 } as const;

type Phase = { insertMs: number; deferredChecksMs: number; commitMs: number; totalMs: number };

async function timedPhase(write: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>): Promise<Phase> {
  const start = performance.now();
  let insertMs = 0;
  let deferredChecksMs = 0;
  let checksDone = 0;
  await prisma.$transaction(async (tx) => {
    const t0 = performance.now();
    await write(tx);
    const t1 = performance.now();
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    checksDone = performance.now();
    insertMs = t1 - t0;
    deferredChecksMs = checksDone - t1;
  }, TX);
  const end = performance.now();
  return { insertMs, deferredChecksMs, commitMs: end - checksDone, totalMs: end - start };
}

const round = (ms: number) => Math.round(ms);

describe.skipIf(!process.env.RANKEYEQ_WAIVER_BENCH)("week-atomic commit-time checks at scale", () => {
  it(
    "grades 100 / 500 / 1,000 member WR pools with realistic boards",
    async () => {
      const report: Array<Record<string, number | string>> = [];
      for (const scale of SIZES) {
        const f = await createResultsFixture(`bench${scale.wrPoolSize}`, { scale });
        try {
          const artifact = await f.importArtifact(1);
          await f.resolve({ position: "WR", key: "wr6", artifact, resolution: "NEUTRALIZED" });
          const ids = {} as Record<WaiverPosition, string>;
          for (const position of WAIVER_POSITIONS) {
            if (position !== "WR") ids[position] = (await f.writeContestResult(await f.buildContestResult(position, { artifact }))).id;
          }
          const wrBuilt = await f.buildContestResult("WR", { artifact });
          const contestResult = await timedPhase(async (tx) => {
            ids.WR = (await f.writeContestResult(wrBuilt, tx)).id;
          });

          const built = await f.buildGradeRun(ids);
          let runId = "";
          const gradeRun = await timedPhase(async (tx) => {
            runId = (await f.writeGradeRun(built, tx)).id;
          });
          const approval = await f.approve(runId);
          const apply = await timedPhase((tx) => f.applyAuthority(runId, approval.id, {}, tx));

          const calls = built.boards.reduce((sum, b) => sum + b.calls.length, 0);
          expect(await prisma.waiverBoardGradeAuthority.count({ where: { weekId: f.weekId } })).toBe(built.boards.length);
          for (const [phase, t] of [["contest result (WR)", contestResult], ["grade run", gradeRun], ["authority apply", apply]] as const) {
            report.push({
              wrPool: scale.wrPoolSize,
              poolRows: wrBuilt.rows.length,
              boards: built.boards.length,
              callGrades: calls,
              phase,
              insertMs: round(t.insertMs),
              deferredChecksMs: round(t.deferredChecksMs),
              commitMs: round(t.commitMs),
              totalMs: round(t.totalMs),
            });
          }
        } finally {
          await f.cleanup();
        }
      }
      const lines = report.map((r) => JSON.stringify(r));
      const byPhase = (phase: string) => report.filter((r) => r.phase === phase);
      for (const phase of ["contest result (WR)", "grade run", "authority apply"]) {
        const rows = byPhase(phase);
        const first = rows[0];
        const last = rows[rows.length - 1];
        lines.push(
          `${phase}: deferred checks x${(Number(last.deferredChecksMs) / Math.max(1, Number(first.deferredChecksMs))).toFixed(1)}, ` +
            `total x${(Number(last.totalMs) / Math.max(1, Number(first.totalMs))).toFixed(1)} for x${Number(last.wrPool) / Number(first.wrPool)} pool size`,
        );
      }
      if (process.env.RANKEYEQ_WAIVER_BENCH_OUT) writeFileSync(process.env.RANKEYEQ_WAIVER_BENCH_OUT, `${lines.join("\n")}\n`);
      else process.stdout.write(`${lines.join("\n")}\n`);
    },
    3_600_000,
  );
});
