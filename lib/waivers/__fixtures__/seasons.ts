import { prisma } from "@/lib/db";

/**
 * Creates a fixture Season on the lowest year in [min, max] that no Season
 * uses. Allocation and creation share one transaction under a fixed advisory
 * lock, so concurrent test files never receive the same year.
 */
export async function createFixtureSeason(range: { min: number; max: number }, sport: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('rankeyeq-waivers-fixture-season'))::text`;
    const used = await tx.season.findMany({ where: { year: { gte: range.min, lte: range.max } }, select: { year: true } });
    const taken = new Set(used.map((season) => season.year));
    let year = range.min;
    while (year <= range.max && taken.has(year)) year += 1;
    if (year > range.max) throw new Error(`No free fixture season year in ${range.min}–${range.max}; clean up leftover fixture seasons`);
    return tx.season.create({ data: { year, sport, active: false } });
  });
}
