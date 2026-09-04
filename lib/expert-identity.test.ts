import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";
import {
  EXPERT_SOURCE_KIND,
  createExpertAnalyst,
  formatExpertAffiliationBadge,
  formatExpertPrimaryName,
  isExpertProfile,
  setExpertDirectoryActive,
  slugifyExpertUsername,
} from "@/lib/expert-identity";
import { ensureOfficialBenchmarkSources } from "@/lib/benchmark-sources-sync";

const suffix = `exp-${Date.now()}`;

describe("expert display helpers", () => {
  it("formats analyst primary name and publisher badge", () => {
    expect(
      formatExpertPrimaryName({
        displayName: "Justin Boone",
        analystName: "Justin Boone",
        publicationName: "Yahoo Fantasy",
      }),
    ).toBe("Justin Boone");
    expect(
      formatExpertAffiliationBadge({
        displayName: "Justin Boone",
        analystName: "Justin Boone",
        publicationName: "Yahoo Fantasy",
        sourceKind: EXPERT_SOURCE_KIND.ANALYST,
      }),
    ).toBe("EXPERT · Yahoo Fantasy");
  });

  it("falls back to displayName for publisher shells", () => {
    expect(
      formatExpertPrimaryName({
        displayName: "Yahoo Fantasy",
        publicationName: "Yahoo Fantasy",
        sourceKind: EXPERT_SOURCE_KIND.PUBLISHER,
      }),
    ).toBe("Yahoo Fantasy");
    expect(
      formatExpertAffiliationBadge({
        displayName: "Yahoo Fantasy",
        publicationName: "Yahoo Fantasy",
        sourceKind: EXPERT_SOURCE_KIND.PUBLISHER,
      }),
    ).toBe("EXPERT · Yahoo Fantasy");
  });

  it("slugifies expert usernames", () => {
    expect(slugifyExpertUsername("Justin Boone")).toBe("justin_boone");
  });
});

describe("expert analyst identities", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.universalProfile.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("treats BENCHMARK profiles as experts", () => {
    expect(isExpertProfile("BENCHMARK")).toBe(true);
    expect(isExpertProfile("HUMAN")).toBe(false);
    expect(isExpertProfile("AI")).toBe(false);
  });

  it("creates an individual analyst without a publisher-level ballot identity", async () => {
    await ensureOfficialBenchmarkSources();

    const profile = await createExpertAnalyst({
      analystName: `Justin Boone ${suffix}`,
      publicationName: "Yahoo Fantasy",
      username: `justin_boone_${suffix.slice(-6)}`,
      sourceUrl: "https://example.com/boone",
      positionsCovered: ["QB", "RB", "WR", "TE", "DEF"],
      competitorActive: true,
    });
    createdIds.push(profile.id);

    const meta = await prisma.expertSourceProfile.findUniqueOrThrow({
      where: { universalProfileId: profile.id },
    });
    expect(meta.sourceKind).toBe("ANALYST");
    expect(meta.analystName).toContain("Justin Boone");
    expect(meta.publicationName).toBe("Yahoo Fantasy");
    expect(profile.competitorActive).toBe(true);
    expect(profile.profileType).toBe("BENCHMARK");

    const yahooShell = await prisma.universalProfile.findUniqueOrThrow({
      where: { username: "yahoo-fantasy" },
    });
    expect(yahooShell.competitorActive).toBe(false);
    expect(yahooShell.id).not.toBe(profile.id);
  });

  it("can deactivate without deleting historical expert rows", async () => {
    const profile = await createExpertAnalyst({
      analystName: `Temp Analyst ${suffix}`,
      publicationName: "ESPN Fantasy",
      username: `temp_analyst_${suffix.slice(-6)}`,
    });
    createdIds.push(profile.id);

    await setExpertDirectoryActive({
      universalProfileId: profile.id,
      active: false,
    });
    const after = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { expertSource: true },
    });
    expect(after.competitorActive).toBe(false);
    expect(after.expertSource?.active).toBe(false);

    await setExpertDirectoryActive({
      universalProfileId: profile.id,
      active: true,
    });
    const reactivated = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profile.id },
    });
    expect(reactivated.competitorActive).toBe(true);
  });

  it("upserts analysts idempotently without reactivating publisher shells", async () => {
    const { upsertExpertAnalyst } = await import("@/lib/expert-identity");
    await ensureOfficialBenchmarkSources();

    const first = await upsertExpertAnalyst({
      analystName: `Idempotent Analyst ${suffix}`,
      publicationName: "Yahoo Fantasy",
      username: `idem_analyst_${suffix.slice(-6)}`,
      positionsCovered: ["QB", "RB", "WR", "TE", "DEF"],
      competitorActive: true,
    });
    createdIds.push(first.profile.id);
    expect(first.action).toBe("created");

    const second = await upsertExpertAnalyst({
      analystName: `Idempotent Analyst ${suffix}`,
      publicationName: "Yahoo Fantasy",
      username: `idem_analyst_${suffix.slice(-6)}`,
      positionsCovered: ["QB", "RB", "WR", "TE", "DEF"],
      competitorActive: true,
    });
    expect(second.action).toBe("unchanged");
    expect(second.profile.id).toBe(first.profile.id);

    const yahoo = await prisma.universalProfile.findUniqueOrThrow({
      where: { username: "yahoo-fantasy" },
    });
    expect(yahoo.competitorActive).toBe(false);
  });

  it("Expert Consensus only counts submitted Expert ballots (no publisher double-count by default)", () => {
    const submissions = [
      { id: "a", status: "LOCKED" as const, profileType: "BENCHMARK" as const },
      { id: "b", status: "DRAFT" as const, profileType: "BENCHMARK" as const },
      { id: "c", status: "LOCKED" as const, profileType: "HUMAN" as const },
    ];
    const expert = filterEligibleConsensusSubmissions(submissions, "EXPERT");
    expect(expert.map((row) => row.id)).toEqual(["a"]);
  });
});
