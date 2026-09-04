import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertClientProfileMatchesSession,
  isAiProfileWithoutAuth,
  isBenchmarkProfileWithoutAuth,
  isCreatorProfileWithoutAuth,
  resolveParticipationState,
} from "@/lib/auth/participation";
import {
  createOrResolveUniversalProfile,
  ProfileLinkError,
} from "@/lib/auth/profile-link";
import { ForbiddenError } from "@/lib/auth/errors";
import { prisma } from "@/lib/db";
import { validateUsername } from "@/lib/username";

const suffix = `auth${Date.now()}`;

describe("username validation", () => {
  it("accepts valid usernames and rejects reserved/invalid", () => {
    expect(validateUsername("grid_fan_01").ok).toBe(true);
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("Admin").ok).toBe(false);
    expect(validateUsername("pipes").ok).toBe(false);
    expect(validateUsername("gpt").ok).toBe(false);
    expect(validateUsername("ChatGPT").ok).toBe(false);
    expect(validateUsername("espn-fantasy").ok).toBe(false);
    expect(validateUsername("fantasypros-ecr").ok).toBe(false);
  });
});

describe("participation + profile spoofing guards", () => {
  it("maps signed-out / needs-setup / ready states", () => {
    expect(
      resolveParticipationState({
        signedIn: false,
        universalProfileId: null,
      }),
    ).toBe("signed-out");
    expect(
      resolveParticipationState({
        signedIn: true,
        universalProfileId: null,
      }),
    ).toBe("needs-setup");
    expect(
      resolveParticipationState({
        signedIn: true,
        universalProfileId: "p1",
        profileType: "HUMAN",
      }),
    ).toBe("ready");
    expect(
      resolveParticipationState({
        signedIn: true,
        universalProfileId: "p1",
        profileType: "BENCHMARK",
      }),
    ).toBe("needs-setup");
  });

  it("rejects submitting as another UniversalProfile", () => {
    expect(
      assertClientProfileMatchesSession("mine", "someone-else").ok,
    ).toBe(false);
    expect(assertClientProfileMatchesSession("mine", "mine").ok).toBe(true);
    expect(assertClientProfileMatchesSession("mine", undefined).ok).toBe(true);
  });

  it("treats AI, benchmark, and creator profiles as auth-free identities", () => {
    expect(isAiProfileWithoutAuth("AI")).toBe(true);
    expect(isAiProfileWithoutAuth("HUMAN")).toBe(false);
    expect(isBenchmarkProfileWithoutAuth("BENCHMARK")).toBe(true);
    expect(isBenchmarkProfileWithoutAuth("HUMAN")).toBe(false);
    expect(isCreatorProfileWithoutAuth("CREATOR")).toBe(true);
    expect(isCreatorProfileWithoutAuth("HUMAN")).toBe(false);
  });
});

describe("UniversalProfile first-login linking", () => {
  let userId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${suffix}@example.com`,
        emailVerified: new Date(),
        name: "Auth Tester",
        role: "USER",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (!userId) return;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.universalProfileId) {
      await prisma.user.update({
        where: { id: userId },
        data: { universalProfileId: null },
      });
      await prisma.universalProfile.delete({
        where: { id: user.universalProfileId },
      });
    }
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it("creates a UniversalProfile on first setup and reuses it on repeat", async () => {
    const username = `u_${suffix}`.slice(0, 24);
    const first = await createOrResolveUniversalProfile({
      userId,
      username,
      displayName: "Auth Tester",
    });
    expect(first.username).toBe(username);
    expect(first.profileType).toBe("HUMAN");

    const linked = await prisma.user.findUnique({ where: { id: userId } });
    expect(linked?.universalProfileId).toBe(first.id);

    const second = await createOrResolveUniversalProfile({
      userId,
      username: `other_${suffix}`.slice(0, 24),
      displayName: "Should Not Duplicate",
    });
    expect(second.id).toBe(first.id);
    expect(second.username).toBe(username);

    const count = await prisma.universalProfile.count({
      where: { username },
    });
    expect(count).toBe(1);
  });

  it("enforces username uniqueness against existing profiles", async () => {
    const taken = `taken_${suffix}`.slice(0, 24);
    await prisma.universalProfile.create({
      data: {
        username: taken,
        displayName: "Taken Name",
        profileType: "HUMAN",
      },
    });

    const otherUser = await prisma.user.create({
      data: {
        email: `dup_${suffix}@example.com`,
        role: "USER",
      },
    });

    await expect(
      createOrResolveUniversalProfile({
        userId: otherUser.id,
        username: taken,
        displayName: "Imposter",
      }),
    ).rejects.toBeInstanceOf(ProfileLinkError);

    await prisma.user.delete({ where: { id: otherUser.id } });
    await prisma.universalProfile.delete({ where: { username: taken } });
  });
});

describe("admin authorization helper", () => {
  it("ForbiddenError identifies unauthorized admin access", () => {
    const error = new ForbiddenError("Admin access required");
    expect(error.name).toBe("ForbiddenError");
    expect(error.message).toContain("Admin");
  });
});

describe("AI profiles remain without auth accounts", () => {
  it("seeded AI usernames have UniversalProfiles but no User rows", async () => {
    const ai = await prisma.universalProfile.findUnique({
      where: { username: "gpt" },
      include: { authUser: true },
    });
    if (!ai) {
      // Seed may not have run in this environment.
      expect(ai).toBeNull();
      return;
    }
    expect(ai.profileType).toBe("AI");
    expect(ai.displayName).toBe("GPT");
    expect(ai.authUser).toBeNull();
  });
});
