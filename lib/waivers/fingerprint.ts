import { createHash } from "node:crypto";

/**
 * sha256 over the ordered board content and the snapshot version it was
 * validated against. Identical boards on the same snapshot share a fingerprint;
 * the same calls re-validated on a superseding snapshot do not.
 */
export function waiverBoardFingerprint(input: {
  contestId: string;
  snapshotId: string;
  rankableEntryIds: ReadonlyArray<string>;
}): string {
  const payload = JSON.stringify({
    v: 1,
    contestId: input.contestId,
    snapshotId: input.snapshotId,
    calls: [...input.rankableEntryIds],
  });
  return createHash("sha256").update(payload).digest("hex");
}
