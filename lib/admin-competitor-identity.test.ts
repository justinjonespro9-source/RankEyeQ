import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createAiCompetitor,
  setAiDirectoryActive,
} from "@/lib/ai-identity";
import {
  createCreatorCompetitor,
  setCreatorDirectoryActive,
} from "@/lib/creator-identity";
import {
  EXPERT_SOURCE_KIND,
  createExpertAnalyst,
  setExpertDirectoryActive,
} from "@/lib/expert-identity";
import { competitorIdentityChip } from "@/lib/profile-labels";
import { listActiveAiCompetitors } from "@/lib/ai-competitors-sync";
import { listActiveCreatorCompetitors } from "@/lib/creator-identity";
import { canAccessAdmin } from "@/lib/admin/access";

const suffix = `cmp-${Date.now().toString(36)}`;
const createdIds: string[] = [];

describe("admin competitor creation", () => {
  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.universalProfile.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("restricts admin capability to ADMIN role", () => {
    expect(canAccessAdmin("ADMIN")).toBe(true);
    expect(canAccessAdmin("USER")).toBe(false);
    expect(canAccessAdmin(null)).toBe(false);
  });

  it("creates an AI competitor that is active by default", async () => {
    const profile = await createAiCompetitor({
      displayName: `Test AI ${suffix}`,
      username: `test_ai_${suffix.slice(-8)}`,
      bio: "Manual test model",
    });
    createdIds.push(profile.id);

    expect(profile.profileType).toBe("AI");
    expect(profile.competitorActive).toBe(true);
    expect(profile.publicVisible).toBe(true);
    expect(profile.bio).toBe("Manual test model");
    expect(
      competitorIdentityChip({
        profileType: "AI",
        aiModel: profile.displayName,
      }).label,
    ).toBe(`AI · ${profile.displayName}`);

    const active = await listActiveAiCompetitors();
    expect(active.some((row) => row.id === profile.id)).toBe(true);

    await setAiDirectoryActive({
      universalProfileId: profile.id,
      active: false,
    });
    const after = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { submissions: true },
    });
    expect(after.competitorActive).toBe(false);
    expect(after.submissions).toEqual([]);
  });

  it("creates a Creator as UNCLAIMED tracked identity", async () => {
    const profile = await createCreatorCompetitor({
      personName: `Creator ${suffix}`,
      brandName: "Test Channel",
      username: `creator_${suffix.slice(-8)}`,
      socialHandle: "@testchannel",
      creatorSiteUrl: "https://example.com/creator",
    });
    createdIds.push(profile.id);

    const row = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { creatorCompetitor: true },
    });
    expect(row.profileType).toBe("CREATOR");
    expect(row.competitorActive).toBe(true);
    expect(row.creatorCompetitor?.claimStatus).toBe("UNCLAIMED");
    expect(row.creatorCompetitor?.brandName).toBe("Test Channel");
    expect(row.creatorCompetitor?.verifiedAt).toBeNull();
    expect(
      competitorIdentityChip({
        profileType: "CREATOR",
        creatorBrand: row.creatorCompetitor?.brandName,
      }).label,
    ).toBe("CREATOR · Test Channel");

    const active = await listActiveCreatorCompetitors();
    expect(active.some((item) => item.id === profile.id)).toBe(true);

    await setCreatorDirectoryActive({
      universalProfileId: profile.id,
      active: false,
    });
    const deactivated = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profile.id },
    });
    expect(deactivated.competitorActive).toBe(false);
  });

  it("creates an Expert analyst with ANALYST source kind", async () => {
    const profile = await createExpertAnalyst({
      analystName: `Analyst ${suffix}`,
      publicationName: "Test Fantasy Desk",
      username: `analyst_${suffix.slice(-8)}`,
      sourceUrl: "https://example.com/rankings",
    });
    createdIds.push(profile.id);

    const row = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { expertSource: true },
    });
    expect(row.profileType).toBe("BENCHMARK");
    expect(row.expertSource?.sourceKind).toBe(EXPERT_SOURCE_KIND.ANALYST);
    expect(row.expertSource?.publicationName).toBe("Test Fantasy Desk");
    expect(
      competitorIdentityChip({
        profileType: "BENCHMARK",
        expertPublisher: row.expertSource?.publicationName,
      }).label,
    ).toBe("EXPERT · Test Fantasy Desk");

    await setExpertDirectoryActive({
      universalProfileId: profile.id,
      active: false,
    });
    const deactivated = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { submissions: true },
    });
    expect(deactivated.competitorActive).toBe(false);
    expect(deactivated.submissions).toEqual([]);
  });

  it("enforces unique usernames and does not overwrite existing identities", async () => {
    const first = await createAiCompetitor({
      displayName: `Unique AI ${suffix}`,
      username: `unique_ai_${suffix.slice(-8)}`,
    });
    createdIds.push(first.id);

    await expect(
      createAiCompetitor({
        displayName: `Other AI ${suffix}`,
        username: first.username,
      }),
    ).rejects.toThrow(/already taken/i);

    await expect(
      createCreatorCompetitor({
        personName: `Clash ${suffix}`,
        brandName: "Clash Brand",
        username: first.username,
      }),
    ).rejects.toThrow(/already belongs|already taken/i);
  });
});
