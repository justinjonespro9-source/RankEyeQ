import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import { buildAuthProviders } from "@/lib/auth/providers";
import "@/lib/auth/types";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: buildAuthProviders(),
  session: {
    strategy: "database",
  },
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/verify",
    error: "/signin",
    newUser: "/account/setup",
  },
  trustHost: true,
  callbacks: {
    async session({ session, user }) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: { universalProfile: true },
      });

      session.user.id = user.id;
      session.user.email = user.email ?? null;
      session.user.name = user.name ?? null;
      session.user.image = user.image ?? null;
      session.user.role = dbUser?.role ?? "USER";
      session.user.universalProfileId = dbUser?.universalProfileId ?? null;
      session.user.username = dbUser?.universalProfile?.username ?? null;
      session.user.displayName = dbUser?.universalProfile?.displayName ?? null;

      return session;
    },
  },
});
