/**
 * Idempotently seed the launch Creator competitor identities.
 *
 *   DATABASE_URL=... npx tsx scripts/seed-creator-competitors.ts
 *
 * Does not create empty weekly ballots.
 * Does not import rankings — use /admin/benchmarks after.
 * Refuses to convert existing Human / Expert / AI usernames.
 */
import "dotenv/config";
import {
  CreatorIdentityError,
  upsertCreatorCompetitor,
} from "@/lib/creator-identity";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";

const ALL: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

/** Launch Creator competitors (person + brand affiliation). */
const CREATORS: Array<{
  personName: string;
  brandName: string;
  username?: string;
  sourceUrl?: string;
  positionsCovered?: ContestPosition[];
}> = [
  {
    personName: "Tyler Cohen",
    brandName: "TCO Fantasy Show",
    username: "tyler_cohen",
  },
  {
    personName: "Sal Vetri",
    brandName: "Sal Vetri",
    username: "sal_vetri",
  },
  {
    personName: "Max Jacobson",
    brandName: "Fantasy Football AZ",
    username: "max_jacobson",
  },
  {
    personName: "Seth Burton",
    brandName: "No BS Fantasy Football",
    username: "seth_burton",
  },
  {
    personName: "Mason Dodd",
    brandName: "Flock Fantasy",
    username: "mason_dodd",
  },
];

async function main() {
  console.log(`Seeding ${CREATORS.length} Creator competitors…`);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const creator of CREATORS) {
    try {
      const result = await upsertCreatorCompetitor({
        personName: creator.personName,
        brandName: creator.brandName,
        username: creator.username,
        sourceUrl: creator.sourceUrl ?? null,
        positionsCovered: creator.positionsCovered ?? ALL,
        competitorActive: true,
      });
      if (result.action === "created") created += 1;
      else if (result.action === "updated") updated += 1;
      else unchanged += 1;

      console.log(
        `${result.action.toUpperCase()} ${creator.personName} — ${creator.brandName} (@${result.profile.username}) competitorActive=${result.profile.competitorActive}`,
      );
    } catch (error) {
      failed += 1;
      const message =
        error instanceof CreatorIdentityError
          ? error.message
          : error instanceof Error
            ? error.message
            : "unknown error";
      console.error(`FAIL ${creator.personName}: ${message}`);
    }
  }

  console.log(
    `Done. created=${created} updated=${updated} unchanged=${unchanged} failed=${failed}`,
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
