import { prisma } from "@/lib/db";
import { POST_KICKOFF_FACTUAL_CORRECTION_ACTION } from "@/lib/eligibility/post-kickoff-factual-correction";
import {
  resolveKickoffFreeze,
  type KickoffFactualCorrectionEvidence,
  type KickoffFreezeDecision,
  type KickoffRosterEvidence,
  type KickoffWeekAvailabilityEvidence,
} from "@/lib/reserves/kickoff-freeze-evidence";

export type KickoffFreezeEvidence = {
  weekRow: KickoffWeekAvailabilityEvidence | null;
  roster: KickoffRosterEvidence | null;
  factualCorrection: KickoffFactualCorrectionEvidence | null;
};

export type KickoffFreezeEvidenceMap = Map<string, KickoffFreezeEvidence>;

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Persisted evidence (with write timestamps) for kickoff-time freeze decisions.
 * Factual corrections come from the audited post-kickoff correction path only.
 */
export async function loadKickoffFreezeEvidence(input: {
  weekId: string;
  seasonId: string;
  rankableEntryIds: string[];
}): Promise<KickoffFreezeEvidenceMap> {
  const ids = [...new Set(input.rankableEntryIds)];
  const out: KickoffFreezeEvidenceMap = new Map();
  if (ids.length === 0) return out;

  const [weekRows, rosterRows, corrections] = await Promise.all([
    prisma.playerWeekAvailability.findMany({
      where: { weekId: input.weekId, rankableEntryId: { in: ids } },
    }),
    prisma.seasonPlayer.findMany({
      where: { seasonId: input.seasonId, rankableEntryId: { in: ids } },
      select: { rankableEntryId: true, nflStatus: true, updatedAt: true },
    }),
    prisma.adminAuditLog.findMany({
      where: {
        action: POST_KICKOFF_FACTUAL_CORRECTION_ACTION,
        entityId: input.weekId,
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, metadata: true },
    }),
  ]);

  const correctionByEntry = new Map<string, KickoffFactualCorrectionEvidence>();
  for (const audit of corrections) {
    const metadata =
      audit.metadata && typeof audit.metadata === "object"
        ? (audit.metadata as Record<string, unknown>)
        : null;
    if (!metadata) continue;
    const entryId = readString(metadata, "rankableEntryId");
    const designation = readString(metadata, "correctedDesignation");
    const metadataWeekId = readString(metadata, "weekId");
    if (!entryId || !designation) continue;
    if (metadataWeekId && metadataWeekId !== input.weekId) continue;
    correctionByEntry.set(entryId, {
      designation,
      correctedAt: audit.createdAt,
    });
  }

  const weekById = new Map(weekRows.map((row) => [row.rankableEntryId, row]));
  const rosterById = new Map(
    rosterRows.map((row) => [row.rankableEntryId, row]),
  );

  for (const id of ids) {
    const week = weekById.get(id);
    const roster = rosterById.get(id);
    out.set(id, {
      weekRow: week
        ? {
            designation: week.designation,
            injuryDescription: week.injuryDescription,
            practiceStatus: week.practiceStatus,
            sourceType: week.sourceType,
            sourceUrl: week.sourceUrl,
            sourcePublishedAt: week.sourcePublishedAt,
            observedAt: week.observedAt,
            manualOverride: week.manualOverride,
            updatedAt: week.updatedAt,
          }
        : null,
      roster: roster
        ? { nflStatus: roster.nflStatus, updatedAt: roster.updatedAt }
        : null,
      factualCorrection: correctionByEntry.get(id) ?? null,
    });
  }
  return out;
}

export function resolveKickoffFreezeFromEvidence(
  evidence: KickoffFreezeEvidenceMap,
  rankableEntryId: string,
  kickoffAt: Date,
): KickoffFreezeDecision {
  const row = evidence.get(rankableEntryId);
  return resolveKickoffFreeze({
    kickoffAt,
    weekRow: row?.weekRow ?? null,
    roster: row?.roster ?? null,
    factualCorrection: row?.factualCorrection ?? null,
  });
}
