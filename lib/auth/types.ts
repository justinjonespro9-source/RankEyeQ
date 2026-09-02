import type { UserRole } from "@/lib/generated/prisma/client";

export type SessionUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  role: UserRole;
  universalProfileId: string | null;
  username: string | null;
  displayName: string | null;
};

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }

  interface User {
    role?: UserRole;
    universalProfileId?: string | null;
  }
}
