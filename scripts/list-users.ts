/**
 * Read-only: list every Auth.js User (email, role, id, name, createdAt, Google account).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/list-users.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

function maskDbUrl(url: string) {
  return url.replace(/:\/\/([^:/?#]+):([^@]+)@/, "://$1:***@");
}

async function main() {
  console.log("=== list-users (read-only) ===");
  console.log("DATABASE_URL:", maskDbUrl(process.env.DATABASE_URL ?? "(not set)"));
  console.log("");

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      createdAt: true,
      accounts: {
        select: { provider: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { email: "asc" }],
  });

  console.log(`Users: ${users.length}`);
  console.log("");

  for (const user of users) {
    const hasGoogle = user.accounts.some((a) => a.provider === "google");
    const providers = user.accounts.map((a) => a.provider).join(", ") || "none";
    console.log({
      email: user.email,
      role: user.role,
      id: user.id,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      hasGoogleAccount: hasGoogle,
      accountProviders: providers,
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
