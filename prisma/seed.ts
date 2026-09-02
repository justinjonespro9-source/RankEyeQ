import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ContestPosition,
  ContestStatus,
  EntryAvailability,
  PrismaClient,
  ProfileType,
  RankableEntryType,
  UserRole,
  WeekStatus,
} from "../lib/generated/prisma/client";
import { rankingDepthForPosition } from "../lib/contest-defaults";
import { ensureOfficialAiCompetitors } from "../lib/ai-competitors-sync";
import { ensureOfficialBenchmarkSources } from "../lib/benchmark-sources-sync";
import { getSamplePlayers } from "../lib/mock-players";
import type { PlayerAvailability, Position } from "../types/contest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const AVAILABILITY: Record<PlayerAvailability, EntryAvailability> = {
  active: "ACTIVE",
  questionable: "QUESTIONABLE",
  doubtful: "DOUBTFUL",
  out: "OUT",
};

const DAY_OFFSET: Record<string, number> = {
  Thu: 0,
  Fri: 1,
  Sat: 2,
  Sun: 3,
  Mon: 4,
};

function parseGameStartsAt(gameDay: string, gameTime: string, weekStart: Date) {
  const dayOffset = DAY_OFFSET[gameDay] ?? 3;
  const date = new Date(weekStart);
  date.setUTCDate(date.getUTCDate() + dayOffset);

  const match = gameTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3].toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    // Store as approx ET → UTC (+4 during Sep EDT)
    date.setUTCHours(hour + 4, minute, 0, 0);
  }

  return date;
}

function shortName(name: string, position: Position) {
  if (position === "def") return name.split(" ").pop() ?? name;
  const parts = name.split(" ");
  return parts[parts.length - 1] ?? name;
}

async function seedProfiles() {
  const profiles = [
    {
      username: "gridironmind",
      displayName: "Gridiron Mind",
      profileType: ProfileType.HUMAN,
      universalUserId: "uu_demo_001",
    },
  ];

  for (const profile of profiles) {
    await prisma.universalProfile.upsert({
      where: { username: profile.username },
      update: {
        displayName: profile.displayName,
        profileType: profile.profileType,
        universalUserId: profile.universalUserId,
      },
      create: profile,
    });
  }

  // Official 8 AI competitors (GPT, Claude, DeepSeek, Gemini, Llama, Mistral, Perplexity, Grok).
  // AI bots intentionally have no Auth.js User / credentials.
  await ensureOfficialAiCompetitors(prisma);

  // Official 8 expert/benchmark sources. Not HUMAN or AI. No Auth.js accounts.
  await ensureOfficialBenchmarkSources(prisma);
}

async function seedAdminUser() {
  const email = (
    process.env.SEED_ADMIN_EMAIL ?? "admin@rankiq.local"
  ).toLowerCase();

  await prisma.user.upsert({
    where: { email },
    update: {
      role: UserRole.ADMIN,
      emailVerified: new Date(),
      name: "RankEYEQ Admin",
    },
    create: {
      email,
      emailVerified: new Date(),
      name: "RankEYEQ Admin",
      role: UserRole.ADMIN,
    },
  });

  console.log(`  Admin auth user ready: ${email} (sign in via magic link)`);
}

async function seedEntriesForPosition(
  position: Position,
  dbPosition: ContestPosition,
  weekStart: Date,
) {
  const players = getSamplePlayers(position);
  const ids: string[] = [];

  for (const player of players) {
    const externalId = `mock-${player.id}`;
    const entry = await prisma.rankableEntry.upsert({
      where: {
        provider_externalId: { provider: "mock", externalId },
      },
      update: {
        name: player.name,
        shortName: shortName(player.name, position),
        team: player.team,
        opponent: player.opponent,
        position: dbPosition,
        type: position === "def" ? RankableEntryType.DEFENSE : RankableEntryType.PLAYER,
        gameStartsAt: parseGameStartsAt(player.gameDay, player.gameTime, weekStart),
        availability: AVAILABILITY[player.availability],
        active: true,
      },
      create: {
        provider: "mock",
        externalId,
        name: player.name,
        shortName: shortName(player.name, position),
        team: player.team,
        opponent: player.opponent,
        position: dbPosition,
        type: position === "def" ? RankableEntryType.DEFENSE : RankableEntryType.PLAYER,
        gameStartsAt: parseGameStartsAt(player.gameDay, player.gameTime, weekStart),
        availability: AVAILABILITY[player.availability],
        active: true,
      },
    });
    ids.push(entry.id);
  }

  return ids;
}

async function main() {
  console.log("Seeding RankEYEQ…");

  await seedProfiles();
  await seedAdminUser();

  const season = await prisma.season.upsert({
    where: { year_sport: { year: 2026, sport: "NFL" } },
    update: { active: true },
    create: {
      year: 2026,
      sport: "NFL",
      active: true,
    },
  });

  // Deactivate other seasons
  await prisma.season.updateMany({
    where: { NOT: { id: season.id } },
    data: { active: false },
  });

  const weekStart = new Date("2026-09-03T00:00:00.000Z");
  const weekEnd = new Date("2026-09-08T23:59:59.000Z");
  const { computeNflTimingWindows } = await import("../lib/timing/week-windows");
  const timing = computeNflTimingWindows(weekStart, weekEnd);

  const week = await prisma.week.upsert({
    where: {
      seasonId_weekNumber: { seasonId: season.id, weekNumber: 1 },
    },
    update: {
      label: "Week 1",
      startsAt: weekStart,
      endsAt: weekEnd,
      status: WeekStatus.OPEN,
      rankingsOpenAt: timing.rankingsOpenAt,
      fullLockAt: timing.fullLockAt,
      revealStartsAt: timing.revealStartsAt,
      publicReleaseAt: timing.publicReleaseAt,
    },
    create: {
      seasonId: season.id,
      weekNumber: 1,
      label: "Week 1",
      startsAt: weekStart,
      endsAt: weekEnd,
      status: WeekStatus.OPEN,
      rankingsOpenAt: timing.rankingsOpenAt,
      fullLockAt: timing.fullLockAt,
      revealStartsAt: timing.revealStartsAt,
      publicReleaseAt: timing.publicReleaseAt,
    },
  });

  const positions: { ui: Position; db: ContestPosition; title: string }[] = [
    { ui: "qb", db: "QB", title: "Rank the Top 10 fantasy quarterbacks for the week." },
    { ui: "rb", db: "RB", title: "Rank the Top 10 fantasy running backs for the week." },
    { ui: "wr", db: "WR", title: "Rank the Top 15 fantasy wide receivers for the week." },
    { ui: "te", db: "TE", title: "Rank the Top 10 fantasy tight ends for the week." },
    { ui: "def", db: "DEF", title: "Rank the Top 10 fantasy defenses for the week." },
  ];

  const opensAt = timing.rankingsOpenAt;
  const locksAt = timing.fullLockAt;

  for (const pos of positions) {
    const entryIds = await seedEntriesForPosition(pos.ui, pos.db, weekStart);
    const contest = await prisma.rankIQContest.upsert({
      where: {
        weekId_position: { weekId: week.id, position: pos.db },
      },
      update: {
        title: pos.title,
        rankingDepth: rankingDepthForPosition(pos.db),
        status: ContestStatus.OPEN,
        opensAt,
        locksAt,
        seasonId: season.id,
      },
      create: {
        seasonId: season.id,
        weekId: week.id,
        sport: "NFL",
        position: pos.db,
        title: pos.title,
        rankingDepth: rankingDepthForPosition(pos.db),
        status: ContestStatus.OPEN,
        opensAt,
        locksAt,
      },
    });

    for (const rankableEntryId of entryIds) {
      await prisma.contestEntry.upsert({
        where: {
          contestId_rankableEntryId: {
            contestId: contest.id,
            rankableEntryId,
          },
        },
        update: {},
        create: {
          contestId: contest.id,
          rankableEntryId,
        },
      });
    }

    console.log(
      `  ${pos.db}: contest ${contest.id} with ${entryIds.length} entries`,
    );
  }

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
