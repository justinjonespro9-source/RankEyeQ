/**
 * Ensure official publisher shells stay inactive competitors, then idempotently
 * upsert the launch Week 1 individual Expert analysts.
 *
 *   DATABASE_URL=... npx tsx scripts/seed-week1-expert-analysts.ts
 *
 * Does not delete publisher shells or historical rankings.
 * Does not create publisher-level ballots.
 * Does not import rankings — use /admin/benchmarks after.
 */
import "dotenv/config";
import { ensureOfficialBenchmarkSources } from "@/lib/benchmark-sources-sync";
import {
  ExpertIdentityError,
  upsertExpertAnalyst,
} from "@/lib/expert-identity";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";

const ALL: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

/** Launch Week 1 named Expert analysts (person + publisher affiliation). */
const EXPERTS: Array<{
  analystName: string;
  publicationName: string;
  sourceUrl?: string;
  positionsCovered?: ContestPosition[];
}> = [
  // Yahoo Fantasy
  { analystName: "Justin Boone", publicationName: "Yahoo Fantasy" },
  { analystName: "Matt Harmon", publicationName: "Yahoo Fantasy" },
  { analystName: "Josh Norris", publicationName: "Yahoo Fantasy" },
  { analystName: "Scott Pianowski", publicationName: "Yahoo Fantasy" },
  { analystName: "Joel Smyth", publicationName: "Yahoo Fantasy" },
  { analystName: "Hayden Winks", publicationName: "Yahoo Fantasy" },
  // CBS Sports
  { analystName: "Jamey Eisenberg", publicationName: "CBS Sports" },
  { analystName: "Dave Richard", publicationName: "CBS Sports" },
  { analystName: "Heath Cummings", publicationName: "CBS Sports" },
  // FantasyPros
  { analystName: "Derek Brown", publicationName: "FantasyPros" },
  { analystName: "Andrew Erickson", publicationName: "FantasyPros" },
  { analystName: "Pat Fitzmaurice", publicationName: "FantasyPros" },
  // Rotoworld / NBC Sports
  { analystName: "Patrick Daugherty", publicationName: "Rotoworld / NBC Sports" },
  { analystName: "Kyle Dvorchak", publicationName: "Rotoworld / NBC Sports" },
  { analystName: "Denny Carter", publicationName: "Rotoworld / NBC Sports" },
  // ESPN Fantasy
  { analystName: "Mike Clay", publicationName: "ESPN Fantasy" },
  { analystName: "Eric Karabell", publicationName: "ESPN Fantasy" },
  { analystName: "Tristan H. Cockcroft", publicationName: "ESPN Fantasy" },
  // NFL.com
  { analystName: "Dan Parr", publicationName: "NFL.com" },
  // PFF
  { analystName: "Nathan Jahnke", publicationName: "PFF" },
  // Sports Illustrated
  { analystName: "Michael Fabiano", publicationName: "Sports Illustrated" },
];

async function main() {
  console.log(`Seeding ${EXPERTS.length} Expert analysts…`);

  const shells = await ensureOfficialBenchmarkSources();
  console.log(
    `Publisher shells: ${shells.publisherShells}/${shells.expected} (competitorActive=false)`,
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const expert of EXPERTS) {
    try {
      const result = await upsertExpertAnalyst({
        analystName: expert.analystName,
        publicationName: expert.publicationName,
        sourceUrl: expert.sourceUrl ?? null,
        positionsCovered: expert.positionsCovered ?? ALL,
        competitorActive: true,
      });
      if (result.action === "created") created += 1;
      else if (result.action === "updated") updated += 1;
      else unchanged += 1;

      console.log(
        `${result.action.toUpperCase()} ${expert.analystName} — ${expert.publicationName} (@${result.profile.username}) sourceKind=ANALYST competitorActive=${result.profile.competitorActive}`,
      );
    } catch (error) {
      failed += 1;
      const message =
        error instanceof ExpertIdentityError
          ? error.message
          : error instanceof Error
            ? error.message
            : "unknown error";
      console.error(`FAIL ${expert.analystName}: ${message}`);
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`created:   ${created}`);
  console.log(`updated:   ${updated}`);
  console.log(`unchanged: ${unchanged}`);
  console.log(`failed:    ${failed}`);
  console.log(`total:     ${EXPERTS.length}`);
  console.log("No rankings imported.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
