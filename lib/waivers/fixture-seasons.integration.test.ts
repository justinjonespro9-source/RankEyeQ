import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createFixtureSeason } from "@/lib/waivers/__fixtures__/seasons";

/** Fixture season years are allocated without collisions, even when fixtures are created concurrently. */
const RANGE = { min: 4100, max: 4107 };
const SPORT = `WAIVERS-ALLOC-${Date.now().toString(36)}`;

afterEach(async () => {
  await prisma.season.deleteMany({ where: { sport: { startsWith: SPORT } } });
});

describe("createFixtureSeason", () => {
  it("gives concurrent fixtures distinct years, lowest free first, and fails clearly when the range is exhausted", async () => {
    const seasons = await Promise.all(Array.from({ length: 8 }, (_, i) => createFixtureSeason(RANGE, `${SPORT}-${i}`)));
    expect(seasons.map((season) => season.year).sort()).toEqual([4100, 4101, 4102, 4103, 4104, 4105, 4106, 4107]);
    await expect(createFixtureSeason(RANGE, `${SPORT}-x`)).rejects.toThrow(/No free fixture season year in 4100–4107/);

    await prisma.season.delete({ where: { id: seasons.find((season) => season.year === 4103)!.id } });
    expect((await createFixtureSeason(RANGE, `${SPORT}-y`)).year).toBe(4103);
  });
});
