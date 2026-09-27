import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  buildSeasonStanding,
  classFilterForStanding,
  deriveTrophyCase,
  type SeasonStanding,
  type TrophyCase,
} from "@/lib/competitive-resume";
import { getSeasonBoardSet, type SeasonBoardSet } from "@/lib/leaderboards";
import { isPublisherConsensusSource } from "@/lib/expert-identity";

/** Request-scoped: profile stats, standing and trophies share one load per season. */
export const getCachedSeasonBoardSet = cache(
  (seasonId: string, includeTest: boolean) =>
    getSeasonBoardSet({ seasonId, includeTest }),
);

export type CompetitiveResume = {
  standing: SeasonStanding | null;
  trophyCase: TrophyCase;
};

export async function getCompetitiveResume(input: {
  profileId: string;
  username: string;
  profileType: string;
  expertSourceKind: string | null;
  includeTest?: boolean;
}): Promise<CompetitiveResume> {
  const includeTest = Boolean(input.includeTest);
  const seasons = await prisma.season.findMany({
    where: {
      OR: [
        { active: true },
        {
          contests: {
            some: {
              submissions: {
                some: { universalProfileId: input.profileId, status: "GRADED" },
              },
            },
          },
        },
      ],
    },
    select: { id: true, year: true, active: true },
    orderBy: { year: "asc" },
  });

  const sets = (
    await Promise.all(
      seasons.map((season) => getCachedSeasonBoardSet(season.id, includeTest)),
    )
  ).filter((set): set is SeasonBoardSet => set != null);

  const standingSet =
    sets.find((set) => set.seasonActive) ?? sets[sets.length - 1] ?? null;

  return {
    standing: standingSet
      ? buildSeasonStanding({
          profileId: input.profileId,
          set: standingSet,
          classFilter: classFilterForStanding({
            profileType: input.profileType,
            isPublisherConsensus: isPublisherConsensusSource(input.expertSourceKind),
          }),
        })
      : null,
    trophyCase: deriveTrophyCase({
      profileId: input.profileId,
      username: input.username,
      sets,
    }),
  };
}
