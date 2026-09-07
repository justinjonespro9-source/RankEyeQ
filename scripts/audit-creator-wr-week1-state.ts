/**
 * READ-ONLY audit: 2026 Week 1 Creator WR import / snapshot state.
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/audit-creator-wr-week1-state.ts
 *
 * Never writes. Never deletes.
 */
import "dotenv/config";
import { prisma } from "../lib/db";

function maskDbUrl(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:****@");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "(not set)";
  console.log("READ-ONLY audit — Creator WR Week 1 import state");
  console.log("DATABASE_URL:", maskDbUrl(dbUrl));
  console.log("looksLocal:", /localhost|127\.0\.0\.1/.test(dbUrl));
  console.log("");

  const week = await prisma.week.findFirst({
    where: {
      weekNumber: 1,
      isTest: false,
      season: { year: 2026 },
    },
    include: { season: true },
    orderBy: { createdAt: "desc" },
  });
  if (!week) {
    console.error("No 2026 Week 1 (non-test) found.");
    process.exit(1);
  }

  console.log("Week:", {
    id: week.id,
    label: week.label,
    season: `${week.season.year} ${week.season.sport}`,
  });

  const wrContest = await prisma.rankIQContest.findFirst({
    where: { weekId: week.id, position: "WR" },
  });
  if (!wrContest) {
    console.error("No WR contest for this week.");
    process.exit(1);
  }

  const rbContest = await prisma.rankIQContest.findFirst({
    where: { weekId: week.id, position: "RB" },
  });

  console.log("\n=== 1. WR contest rankingDepth ===");
  console.log({
    contestId: wrContest.id,
    title: wrContest.title,
    rankingDepth: wrContest.rankingDepth,
    expected: 15,
    ok: wrContest.rankingDepth === 15,
  });

  console.log("\n=== 2. Creator WR snapshots without LOCKED RankingSubmission ===");
  const creatorSnapshots = await prisma.benchmarkSnapshot.findMany({
    where: {
      contestId: wrContest.id,
      universalProfile: { profileType: "CREATOR" },
    },
    include: {
      universalProfile: {
        select: {
          id: true,
          username: true,
          displayName: true,
          createdAt: true,
        },
      },
      picks: { select: { id: true } },
    },
    orderBy: [{ universalProfileId: "asc" }, { createdAt: "desc" }],
  });

  const creatorIds = [
    ...new Set(creatorSnapshots.map((s) => s.universalProfileId)),
  ];
  const submissions = await prisma.rankingSubmission.findMany({
    where: {
      contestId: wrContest.id,
      universalProfileId: { in: creatorIds },
    },
    include: { picks: { select: { id: true } } },
  });
  const submissionByProfile = new Map(
    submissions.map((s) => [s.universalProfileId, s]),
  );

  const orphans = creatorSnapshots.filter((snap) => {
    const sub = submissionByProfile.get(snap.universalProfileId);
    return !sub || sub.status !== "LOCKED";
  });

  if (orphans.length === 0) {
    console.log("(none)");
  } else {
    for (const snap of orphans) {
      const sub = submissionByProfile.get(snap.universalProfileId);
      console.log({
        displayName: snap.universalProfile.displayName,
        username: snap.universalProfile.username,
        profileId: snap.universalProfileId,
        snapshotId: snap.id,
        captureType: snap.captureType,
        status: snap.status,
        capturedAt: snap.capturedAt.toISOString(),
        sourcePublishedAt: snap.sourcePublishedAt?.toISOString() ?? null,
        pickCount: snap.picks.length,
        submissionStatus: sub?.status ?? null,
        submissionPickCount: sub?.picks.length ?? null,
      });
    }
  }

  console.log("\n=== 3. Duplicate snapshots (profile + contest + captureType) ===");
  const groups = new Map<string, typeof creatorSnapshots>();
  for (const snap of creatorSnapshots) {
    const key = `${snap.universalProfileId}|${snap.contestId}|${snap.captureType}`;
    const list = groups.get(key) ?? [];
    list.push(snap);
    groups.set(key, list);
  }
  const dups = [...groups.entries()].filter(([, list]) => list.length > 1);
  if (dups.length === 0) {
    console.log("(none)");
  } else {
    for (const [, list] of dups) {
      const profile = list[0]!.universalProfile;
      console.log({
        displayName: profile.displayName,
        username: profile.username,
        profileId: profile.id,
        captureType: list[0]!.captureType,
        count: list.length,
        snapshotIds: list.map((s) => s.id),
        statuses: list.map((s) => s.status),
        capturedAts: list.map((s) => s.capturedAt.toISOString()),
      });
    }
  }

  console.log(
    "\n=== 4. Newest Creator with RB LOCKED + WR missing/incomplete ===",
  );
  const creators = await prisma.universalProfile.findMany({
    where: { profileType: "CREATOR" },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      username: true,
      displayName: true,
      createdAt: true,
      competitorActive: true,
    },
  });

  let foundFocus = false;
  if (rbContest) {
    for (const creator of creators) {
      const rbSub = await prisma.rankingSubmission.findUnique({
        where: {
          contestId_universalProfileId: {
            contestId: rbContest.id,
            universalProfileId: creator.id,
          },
        },
        include: { picks: true },
      });
      const wrSub = await prisma.rankingSubmission.findUnique({
        where: {
          contestId_universalProfileId: {
            contestId: wrContest.id,
            universalProfileId: creator.id,
          },
        },
        include: { picks: true },
      });
      const wrSnaps = creatorSnapshots.filter(
        (s) => s.universalProfileId === creator.id,
      );
      const rbOk = rbSub?.status === "LOCKED" && rbSub.picks.length > 0;
      const wrMissingOrIncomplete =
        !wrSub || wrSub.status !== "LOCKED" || wrSub.picks.length === 0;
      if (rbOk && wrMissingOrIncomplete) {
        foundFocus = true;
        console.log({
          profileId: creator.id,
          displayName: creator.displayName,
          username: creator.username,
          createdAt: creator.createdAt.toISOString(),
          competitorActive: creator.competitorActive,
          rbSubmissionStatus: rbSub?.status ?? null,
          rbPickCount: rbSub?.picks.length ?? 0,
          wrSubmissionStatus: wrSub?.status ?? null,
          wrPickCount: wrSub?.picks.length ?? 0,
          wrSnapshotCount: wrSnaps.length,
          wrSnapshots: wrSnaps.map((s) => ({
            id: s.id,
            captureType: s.captureType,
            status: s.status,
            capturedAt: s.capturedAt.toISOString(),
            pickCount: s.picks.length,
          })),
          partialOrphanData:
            wrSnaps.length > 0 ||
            (wrSub != null && wrSub.status !== "LOCKED"),
        });
        break;
      }
    }
  }

  if (!foundFocus) {
    console.log(
      "(no creator found with RB LOCKED and WR not LOCKED among 25 newest)",
    );
    console.log("Newest creators (up to 5):");
    for (const creator of creators.slice(0, 5)) {
      console.log({
        profileId: creator.id,
        displayName: creator.displayName,
        username: creator.username,
        createdAt: creator.createdAt.toISOString(),
      });
    }
  }

  console.log("\n=== Summary counts ===");
  console.log({
    creatorWrSnapshots: creatorSnapshots.length,
    orphanSnapshots: orphans.length,
    duplicateGroups: dups.length,
    creatorCountSampled: creators.length,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
