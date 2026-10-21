import { prisma } from "@/lib/db";
import { waiverGradeRunNextAction, waiverGradeRunStage, type WaiverGradeRunStage } from "@/lib/waivers/grading/state-model";

/** Read-only operator view of a week's stored runs, approvals, authority and publication. JSON-serializable. */

const userLabel = (user: { name: string | null; email: string | null } | null) => (user ? (user.name ?? user.email ?? "admin") : "system");

export type WaiverGradingRunView = {
  id: string;
  runNumber: number;
  stage: WaiverGradeRunStage;
  nextAction: "APPROVE" | "APPLY" | "PUBLISH" | null;
  /** Which verified source the run was graded from. */
  sourceKind: "SNG_ARTIFACT" | "RANKEYEQ_SNAPSHOT";
  /** The source revision (SNG artifact or RankEyeQ snapshot). */
  artifactRevision: number;
  /** The source content checksum. */
  artifactContentChecksum: string;
  inputFingerprint: string;
  outputFingerprint: string;
  boardGradeCount: number;
  createdAt: string;
  initiatedBy: string;
  /** The approval an Apply would use (latest unused). */
  approvalId: string | null;
  approvals: Array<{ id: string; approvedBy: string; approvedAt: string; policy: string; applied: boolean }>;
};

export type WaiverGradingLifecycleState = {
  weekId: string;
  runs: WaiverGradingRunView[];
  authority: { changeId: string; gradeRunId: string; runNumber: number; sequence: number; appliedAt: string } | null;
  publication: { id: string; publishedAt: string; publishedBy: string } | null;
};

export async function loadWaiverGradingLifecycleState(weekId: string): Promise<WaiverGradingLifecycleState> {
  const [runs, authority] = await Promise.all([
    prisma.waiverGradeRun.findMany({
      where: { weekId },
      orderBy: { runNumber: "desc" },
      take: 25,
      include: {
        artifact: { select: { revision: true } },
        rankEyeQSnapshot: { select: { revision: true } },
        initiatedBy: { select: { name: true, email: true } },
        approvals: { orderBy: { approvedAt: "asc" }, include: { approvedBy: { select: { name: true, email: true } }, change: { select: { id: true } } } },
        changesAsNew: { select: { id: true } },
      },
    }),
    prisma.waiverWeekGradeAuthority.findUnique({
      where: { weekId },
      include: { change: { select: { sequence: true } }, gradeRun: { select: { runNumber: true } } },
    }),
  ]);
  const publication = authority
    ? await prisma.waiverWeekGradePublication.findUnique({
        where: { changeId: authority.changeId },
        select: { id: true, publishedAt: true, publishedBy: { select: { name: true, email: true } } },
      })
    : null;

  return {
    weekId,
    runs: runs.map((run) => {
      const isCurrent = authority?.gradeRunId === run.id;
      const stage = waiverGradeRunStage({
        approved: run.approvals.length > 0,
        everApplied: run.changesAsNew.length > 0,
        isCurrentAuthority: isCurrent,
        currentPublished: isCurrent && publication !== null,
      });
      const unused = [...run.approvals].reverse().find((a) => a.change === null);
      return {
        id: run.id,
        runNumber: run.runNumber,
        stage,
        nextAction: waiverGradeRunNextAction(stage),
        sourceKind: run.rankEyeQSnapshotId !== null ? ("RANKEYEQ_SNAPSHOT" as const) : ("SNG_ARTIFACT" as const),
        artifactRevision: (run.artifact ?? run.rankEyeQSnapshot)?.revision ?? 0,
        artifactContentChecksum: run.artifactContentChecksum,
        inputFingerprint: run.inputFingerprint,
        outputFingerprint: run.outputFingerprint,
        boardGradeCount: run.boardGradeCount,
        createdAt: run.createdAt.toISOString(),
        initiatedBy: userLabel(run.initiatedBy),
        approvalId: unused?.id ?? null,
        approvals: run.approvals.map((a) => ({
          id: a.id,
          approvedBy: userLabel(a.approvedBy),
          approvedAt: a.approvedAt.toISOString(),
          policy: a.approvalPolicy,
          applied: a.change !== null,
        })),
      };
    }),
    authority: authority
      ? {
          changeId: authority.changeId,
          gradeRunId: authority.gradeRunId,
          runNumber: authority.gradeRun.runNumber,
          sequence: authority.change.sequence,
          appliedAt: authority.updatedAt.toISOString(),
        }
      : null,
    publication: publication ? { id: publication.id, publishedAt: publication.publishedAt.toISOString(), publishedBy: userLabel(publication.publishedBy) } : null,
  };
}
