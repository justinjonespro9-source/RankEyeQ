/**
 * Admin-only preview of test-week data without exposing it on public routes.
 *
 * Public routes exclude isTest weeks by default. Admins append ?adminTest=1
 * while signed in to include test weeks in leaderboards, consensus, etc.
 */
export const ADMIN_TEST_PREVIEW_PARAM = "adminTest";

export function isAdminTestPreviewRequested(
  searchParams: Record<string, string | undefined> | undefined,
): boolean {
  return searchParams?.[ADMIN_TEST_PREVIEW_PARAM] === "1";
}

export function resolveIncludeTestWeeks(input: {
  isAdmin: boolean;
  adminTestPreview?: boolean;
  /** Legacy dev param — only honored for admins to avoid public test leakage. */
  legacyTestParam?: boolean;
}): boolean {
  if (!input.isAdmin) return false;
  return Boolean(input.adminTestPreview || input.legacyTestParam);
}

export function adminTestPreviewLinks(weekId: string) {
  const q = `${ADMIN_TEST_PREVIEW_PARAM}=1&weekId=${weekId}`;
  return [
    { label: "Consensus", href: `/consensus?${q}` },
    { label: "Leaderboards", href: `/leaderboards?${q}` },
    { label: "Results", href: `/results?${q}` },
    { label: "Players", href: `/players?${q}` },
    { label: "Rankers", href: `/rankers?${q}` },
  ];
}
