import type { ProfileType } from "@/lib/generated/prisma/client";

export type SelectableProfile = {
  id: string;
  username: string;
  displayName: string;
  profileType: ProfileType;
};
