/** UI helper: Save may present as validated only when preview is fresh and ready. */
export function schedulePreviewIsReadyToSave(
  preview: { ready: boolean } | null,
  stale: boolean,
): boolean {
  return preview != null && !stale && preview.ready;
}
