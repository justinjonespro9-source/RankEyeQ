import { prisma } from "@/lib/db";
import { readWaiverClock, type WaiverDb } from "@/lib/waivers/clock";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";
import {
  loadWaiverEntryFacts,
  loadWaiverMatchIndex,
  loadWaiverPreviewContext,
  loadWaiverWeek,
  loadWaiverWeekGames,
} from "@/lib/waivers/snapshot/facts";
import { parseWaiverInput } from "@/lib/waivers/snapshot/input";
import {
  assembleWaiverSnapshotPreview,
  matchedWaiverEntryIds,
  matchWaiverInputRows,
  type WaiverSnapshotPreview,
} from "@/lib/waivers/snapshot/preview-model";

export type WaiverSnapshotPreviewInput = {
  weekId: string;
  rawText: string;
  sourceLabel: string;
  sourceUrl: string | null;
  observedAt: Date | null;
};

/**
 * Builds the snapshot preview from the raw paste and canonical facts. Reads
 * only: no snapshot, entry, import-log, audit, player or alias writes. Freeze
 * calls this with its transaction client and compares fingerprints.
 */
export async function buildWaiverSnapshotPreview(db: WaiverDb, input: WaiverSnapshotPreviewInput): Promise<WaiverSnapshotPreview> {
  const week = await loadWaiverWeek(db, input.weekId);
  if (!week) throw new WaiverSnapshotError("NOT_FOUND", "Week not found");
  const now = await readWaiverClock(db);
  const games = await loadWaiverWeekGames(db, week.id);
  const parse = parseWaiverInput(input.rawText);
  const index = await loadWaiverMatchIndex(db, {
    seasonId: week.seasonId,
    idLookups: parse.rows.flatMap((row) => (row.rankEyeQId ? [row.rankEyeQId] : [])),
  });
  const matched = matchWaiverInputRows(parse.rows, index);
  const factsById = await loadWaiverEntryFacts(db, {
    weekId: week.id,
    seasonId: week.seasonId,
    rankableEntryIds: matchedWaiverEntryIds(matched),
    games,
  });
  const context = await loadWaiverPreviewContext(db, { week, now, games });
  return assembleWaiverSnapshotPreview({
    form: { weekId: week.id, sourceLabel: input.sourceLabel, sourceUrl: input.sourceUrl, observedAt: input.observedAt },
    parse,
    matched,
    factsById,
    context,
  });
}

export async function previewWaiverSnapshot(input: WaiverSnapshotPreviewInput): Promise<WaiverSnapshotPreview> {
  return buildWaiverSnapshotPreview(prisma, input);
}
