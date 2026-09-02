import { getTeamMatchup, NFL_TEAMS } from "@/lib/nfl-schedule";
import type {
  PlayerAvailability,
  Position,
  RankingPlayer,
} from "@/types/contest";

type PlayerSeed = {
  name: string;
  team: string;
  availability?: PlayerAvailability;
};

function enrich(
  position: Position,
  seeds: PlayerSeed[],
): RankingPlayer[] {
  return seeds.map((seed, index) => {
    const matchup = getTeamMatchup(seed.team);
    return {
      id: `${position}-${index + 1}`,
      name: seed.name,
      team: seed.team,
      opponent: matchup.opponent,
      position,
      gameDay: matchup.gameDay,
      gameTime: matchup.gameTime,
      availability: seed.availability ?? "active",
    };
  });
}

const QB_SEEDS: PlayerSeed[] = [
  { name: "Josh Allen", team: "BUF" },
  { name: "Lamar Jackson", team: "BAL" },
  { name: "Jalen Hurts", team: "PHI" },
  { name: "Patrick Mahomes", team: "KC" },
  { name: "Joe Burrow", team: "CIN" },
  { name: "Dak Prescott", team: "DAL" },
  { name: "Justin Herbert", team: "LAC" },
  { name: "C.J. Stroud", team: "HOU" },
  { name: "Anthony Richardson", team: "IND", availability: "questionable" },
  { name: "Jordan Love", team: "GB" },
  { name: "Tua Tagovailoa", team: "MIA" },
  { name: "Kirk Cousins", team: "ATL" },
  { name: "Jared Goff", team: "DET" },
  { name: "Baker Mayfield", team: "TB" },
  { name: "Trevor Lawrence", team: "JAX" },
  { name: "Kyler Murray", team: "ARI" },
  { name: "Geno Smith", team: "SEA" },
  { name: "Derek Carr", team: "NO" },
  { name: "Matthew Stafford", team: "LAR" },
  { name: "Aaron Rodgers", team: "NYJ", availability: "questionable" },
  { name: "Brock Purdy", team: "SF" },
  { name: "Daniel Jones", team: "MIN" },
];

const RB_SEEDS: PlayerSeed[] = [
  { name: "Christian McCaffrey", team: "SF" },
  { name: "Breece Hall", team: "NYJ" },
  { name: "Bijan Robinson", team: "ATL" },
  { name: "Saquon Barkley", team: "PHI" },
  { name: "Jahmyr Gibbs", team: "DET" },
  { name: "Jonathan Taylor", team: "IND" },
  { name: "Derrick Henry", team: "BAL" },
  { name: "Kyren Williams", team: "LAR" },
  { name: "Josh Jacobs", team: "GB" },
  { name: "De'Von Achane", team: "MIA" },
  { name: "James Cook", team: "BUF" },
  { name: "Alvin Kamara", team: "NO" },
  { name: "Kenneth Walker III", team: "SEA" },
  { name: "Isiah Pacheco", team: "KC" },
  { name: "Rachaad White", team: "TB" },
  { name: "Joe Mixon", team: "HOU" },
  { name: "Aaron Jones", team: "MIN" },
  { name: "David Montgomery", team: "DET" },
  { name: "Najee Harris", team: "PIT" },
  { name: "Tony Pollard", team: "TEN" },
  { name: "Zack Moss", team: "CIN" },
  { name: "Jerome Ford", team: "CLE" },
  { name: "Travis Etienne Jr.", team: "JAX" },
  { name: "Rhamondre Stevenson", team: "NE" },
  { name: "D'Andre Swift", team: "CHI" },
  { name: "Brian Robinson Jr.", team: "WAS" },
  { name: "Javonte Williams", team: "DEN", availability: "questionable" },
  { name: "Gus Edwards", team: "LAC" },
  { name: "Chuba Hubbard", team: "CAR" },
  { name: "Devin Singletary", team: "NYG" },
  { name: "Zamir White", team: "LV" },
  { name: "James Conner", team: "ARI", availability: "doubtful" },
];

const WR_SEEDS: PlayerSeed[] = [
  { name: "Tyreek Hill", team: "MIA" },
  { name: "CeeDee Lamb", team: "DAL" },
  { name: "Ja'Marr Chase", team: "CIN" },
  { name: "Amon-Ra St. Brown", team: "DET" },
  { name: "A.J. Brown", team: "PHI" },
  { name: "Justin Jefferson", team: "MIN" },
  { name: "Puka Nacua", team: "LAR" },
  { name: "Garrett Wilson", team: "NYJ" },
  { name: "Davante Adams", team: "NYJ" },
  { name: "Chris Olave", team: "NO" },
  { name: "DK Metcalf", team: "SEA" },
  { name: "Mike Evans", team: "TB" },
  { name: "DeVonta Smith", team: "PHI" },
  { name: "Jaylen Waddle", team: "MIA" },
  { name: "Nico Collins", team: "HOU" },
  { name: "Brandon Aiyuk", team: "SF" },
  { name: "Tee Higgins", team: "CIN", availability: "questionable" },
  { name: "DJ Moore", team: "CHI" },
  { name: "Marvin Harrison Jr.", team: "ARI" },
  { name: "Malik Nabers", team: "NYG" },
  { name: "Drake London", team: "ATL" },
  { name: "Stefon Diggs", team: "HOU" },
  { name: "Amari Cooper", team: "CLE" },
  { name: "Cooper Kupp", team: "LAR", availability: "questionable" },
  { name: "Chris Godwin", team: "TB" },
  { name: "Zay Flowers", team: "BAL" },
  { name: "George Pickens", team: "PIT" },
  { name: "DeAndre Hopkins", team: "TEN" },
  { name: "Courtland Sutton", team: "DEN" },
  { name: "Terry McLaurin", team: "WAS" },
  { name: "Calvin Ridley", team: "TEN" },
  { name: "Michael Pittman Jr.", team: "IND" },
  { name: "Christian Kirk", team: "JAX" },
  { name: "Jordan Addison", team: "MIN" },
  { name: "Rome Odunze", team: "CHI" },
  { name: "Ladd McConkey", team: "LAC" },
  { name: "Xavier Worthy", team: "KC" },
  { name: "Jayden Reed", team: "GB" },
  { name: "Rashee Rice", team: "KC", availability: "out" },
  { name: "Jaxon Smith-Njigba", team: "SEA" },
  { name: "Keon Coleman", team: "BUF" },
  { name: "Brian Thomas Jr.", team: "JAX" },
];

const TE_SEEDS: PlayerSeed[] = [
  { name: "Travis Kelce", team: "KC" },
  { name: "Sam LaPorta", team: "DET" },
  { name: "Mark Andrews", team: "BAL" },
  { name: "Trey McBride", team: "ARI" },
  { name: "George Kittle", team: "SF" },
  { name: "Evan Engram", team: "JAX" },
  { name: "Dallas Goedert", team: "PHI" },
  { name: "Kyle Pitts", team: "ATL" },
  { name: "David Njoku", team: "CLE" },
  { name: "Jake Ferguson", team: "DAL" },
  { name: "Pat Freiermuth", team: "PIT" },
  { name: "Cole Kmet", team: "CHI" },
  { name: "Dalton Kincaid", team: "BUF" },
  { name: "T.J. Hockenson", team: "MIN", availability: "questionable" },
  { name: "Hunter Henry", team: "NE" },
  { name: "Cade Otton", team: "TB" },
  { name: "Tyler Conklin", team: "NYJ" },
  { name: "Noah Fant", team: "SEA" },
  { name: "Juwan Johnson", team: "NO" },
  { name: "Isaiah Likely", team: "BAL" },
  { name: "Chigoziem Okonkwo", team: "TEN" },
  { name: "Jonnu Smith", team: "MIA" },
];

function buildDefensePool(): RankingPlayer[] {
  return NFL_TEAMS.map((team, index) => {
    const matchup = getTeamMatchup(team.abbr);
    return {
      id: `def-${index + 1}`,
      name: team.name,
      team: team.abbr,
      opponent: matchup.opponent,
      position: "def" as const,
      gameDay: matchup.gameDay,
      gameTime: matchup.gameTime,
      availability: "active" as const,
    };
  });
}

const PLAYER_POOLS: Record<Position, RankingPlayer[]> = {
  qb: enrich("qb", QB_SEEDS),
  rb: enrich("rb", RB_SEEDS),
  wr: enrich("wr", WR_SEEDS),
  te: enrich("te", TE_SEEDS),
  def: buildDefensePool(),
};

export function getSamplePlayers(position: Position): RankingPlayer[] {
  return PLAYER_POOLS[position];
}

export function getPlayerById(
  position: Position,
  id: string,
): RankingPlayer | undefined {
  return PLAYER_POOLS[position].find((player) => player.id === id);
}

export function getPlayersByIds(
  position: Position,
  ids: (string | null)[],
): (RankingPlayer | null)[] {
  return ids.map((id) => (id ? (getPlayerById(position, id) ?? null) : null));
}
