import { listSelectableProfiles } from "@/lib/active-profile";
import { DevProfileSelector } from "@/components/rank/DevProfileSelector";

/**
 * Optional local-only debug chrome. Never renders in production.
 * Enable with RANKIQ_DEV_PROFILE_SWITCHER=1 in development.
 * Does not control ranking mutations (session-derived UniversalProfile does).
 */
export async function DevProfileChrome() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.RANKIQ_DEV_PROFILE_SWITCHER !== "1"
  ) {
    return null;
  }

  let profiles: Awaited<ReturnType<typeof listSelectableProfiles>> = [];
  try {
    profiles = await listSelectableProfiles();
  } catch {
    return null;
  }

  if (profiles.length === 0) return null;

  const selectable = profiles.map((profile) => ({
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    profileType: profile.profileType,
  }));

  return (
    <DevProfileSelector profiles={selectable} activeProfileId={null} />
  );
}
