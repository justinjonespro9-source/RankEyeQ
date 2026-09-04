/**
 * Optional helper: ensure official publisher shells are inactive competitors,
 * then create Week 1 individual Expert analysts from a hard-coded list.
 *
 * Edit EXPERTS below, then:
 *   DATABASE_URL=... npx tsx scripts/seed-week1-expert-analysts.ts
 *
 * Does not delete publisher shells or historical rankings.
 * Does not open contests or import boards — import from /admin/benchmarks after.
 */
import "dotenv/config";
import { ensureOfficialBenchmarkSources } from "@/lib/benchmark-sources-sync";
import { createExpertAnalyst, ExpertIdentityError } from "@/lib/expert-identity";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";

const ALL: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

/** Replace with your ~20 Week 1 analysts. */
const EXPERTS: Array<{
  analystName: string;
  publicationName: string;
  sourceUrl?: string;
  positionsCovered?: ContestPosition[];
}> = [
  // Examples — replace before running in production:
  // { analystName: "Justin Boone", publicationName: "Yahoo Fantasy", sourceUrl: "https://..." },
  // { analystName: "Field Yates", publicationName: "ESPN Fantasy" },
];

async function main() {
  const shells = await ensureOfficialBenchmarkSources();
  console.log(
    `Publisher shells: ${shells.publisherShells}/${shells.expected} (competitorActive=false)`,
  );

  if (EXPERTS.length === 0) {
    console.log(
      "No EXPERTS configured in scripts/seed-week1-expert-analysts.ts — nothing created.",
    );
    console.log(
      "Prefer Admin → Experts → Add Expert analyst, or fill the EXPERTS array and re-run.",
    );
    return;
  }

  for (const expert of EXPERTS) {
    try {
      const profile = await createExpertAnalyst({
        analystName: expert.analystName,
        publicationName: expert.publicationName,
        sourceUrl: expert.sourceUrl ?? null,
        positionsCovered: expert.positionsCovered ?? ALL,
        competitorActive: true,
      });
      console.log(
        `Created ${expert.analystName} — ${expert.publicationName} (@${profile.username})`,
      );
    } catch (error) {
      const message =
        error instanceof ExpertIdentityError
          ? error.message
          : error instanceof Error
            ? error.message
            : "unknown error";
      console.error(`Skip ${expert.analystName}: ${message}`);
    }
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
