/**
 * Pure lifecycle stage of a stored grade run, from facts the database holds.
 *
 *   STORED     run (and its results) exist; no approval yet
 *   APPROVED   an approval exists; this run is not the week's authority
 *   APPLIED    this run is the week's CURRENT authority, not published
 *   PUBLISHED  this run is CURRENT and its authority change is published
 *   SUPERSEDED a later authority change replaced this run
 */
export type WaiverGradeRunStage = "STORED" | "APPROVED" | "APPLIED" | "PUBLISHED" | "SUPERSEDED";

export function waiverGradeRunStage(facts: {
  approved: boolean;
  /** The run was the authority of some earlier change. */
  everApplied: boolean;
  isCurrentAuthority: boolean;
  currentPublished: boolean;
}): WaiverGradeRunStage {
  if (facts.isCurrentAuthority) return facts.currentPublished ? "PUBLISHED" : "APPLIED";
  if (facts.everApplied) return "SUPERSEDED";
  return facts.approved ? "APPROVED" : "STORED";
}

/** Which operator action a stage offers next (null = none). */
export function waiverGradeRunNextAction(stage: WaiverGradeRunStage): "APPROVE" | "APPLY" | "PUBLISH" | null {
  switch (stage) {
    case "STORED":
      return "APPROVE";
    case "APPROVED":
      return "APPLY";
    case "APPLIED":
      return "PUBLISH";
    default:
      return null;
  }
}
