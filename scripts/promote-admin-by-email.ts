/**
 * One-off production helper: promote an existing Auth.js User to ADMIN by email.
 *
 * Updates ONLY User.role. Does not touch contests, players, pools, rankings,
 * UniversalProfile fields, or create users/profiles.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/promote-admin-by-email.ts you@example.com
 *
 * Or:
 *   PROMOTE_ADMIN_EMAIL=you@example.com DATABASE_URL="..." npx tsx scripts/promote-admin-by-email.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

function maskDbUrl(url: string) {
  return url.replace(/:\/\/([^:/?#]+):([^@]+)@/, "://$1:***@");
}

async function main() {
  const emailArg =
    process.argv[2]?.trim() ||
    process.env.PROMOTE_ADMIN_EMAIL?.trim() ||
    "";

  if (!emailArg) {
    console.error(
      "Usage: DATABASE_URL=... npx tsx scripts/promote-admin-by-email.ts <email>",
    );
    process.exitCode = 1;
    return;
  }

  const email = emailArg.toLowerCase();
  const dbUrl = process.env.DATABASE_URL ?? "(not set)";

  console.log("=== promote-admin-by-email ===");
  console.log("DATABASE_URL:", maskDbUrl(dbUrl));
  console.log("Lookup email:", email);
  console.log("");

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
    },
    include: {
      universalProfile: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profileType: true,
          status: true,
        },
      },
      accounts: {
        select: { provider: true, providerAccountId: true },
      },
    },
  });

  if (!user) {
    console.error(`No User found with email matching: ${email}`);
    console.error("Refusing to create a user. Sign in once first, then re-run.");
    process.exitCode = 1;
    return;
  }

  const beforeRole = user.role;
  console.log("Matched User:");
  console.log("  id:              ", user.id);
  console.log("  email:           ", user.email);
  console.log("  name:            ", user.name);
  console.log("  role (before):   ", beforeRole);
  console.log("  universalProfileId:", user.universalProfileId);
  if (user.universalProfile) {
    console.log("  profile.username:", user.universalProfile.username);
    console.log("  profile.display: ", user.universalProfile.displayName);
    console.log("  profile.type:    ", user.universalProfile.profileType);
    console.log("  profile.status:  ", user.universalProfile.status);
  } else {
    console.log("  profile:         (none linked yet — admin access still works via User.role)");
  }
  console.log(
    "  accounts:        ",
    user.accounts.length
      ? user.accounts.map((a) => a.provider).join(", ")
      : "(none)",
  );

  if (beforeRole === "ADMIN") {
    console.log("");
    console.log("Already ADMIN — no update needed (idempotent no-op).");
  } else {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
      select: { id: true, email: true, role: true },
    });
    console.log("");
    console.log("Updated User.role:", beforeRole, "→", updated.role);
  }

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: {
      id: true,
      email: true,
      name: true,
      universalProfileId: true,
      accounts: { select: { provider: true } },
    },
    orderBy: { email: "asc" },
  });

  console.log("");
  console.log(`Current ADMIN users (${admins.length}):`);
  for (const admin of admins) {
    const providers = admin.accounts.map((a) => a.provider).join(",") || "none";
    console.log(
      `  - ${admin.email ?? "(no email)"}  id=${admin.id}  providers=${providers}  profile=${admin.universalProfileId ?? "none"}`,
    );
  }

  console.log("");
  console.log(
    "Note: Admin authorization reads User.role only (UniversalProfile has no admin flag).",
  );
  console.log(
    "Session strategy is database; refresh /admin after promote (re-sign-in if needed).",
  );
  console.log(
    "admin@rankiq.local was not modified. Demote/deactivate it only after verifying your real account can open /admin.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
