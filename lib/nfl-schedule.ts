/** Mock Week 1 slate used to attach opponent + kickoff metadata to players. */

export type TeamMatchup = {
  opponent: string;
  gameDay: string;
  gameTime: string;
  home: boolean;
};

const MATCHUPS: {
  away: string;
  home: string;
  gameDay: string;
  gameTime: string;
}[] = [
  { away: "GB", home: "PHI", gameDay: "Thu", gameTime: "8:20 PM ET" },
  { away: "KC", home: "LAC", gameDay: "Fri", gameTime: "8:00 PM ET" },
  { away: "ARI", home: "NO", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "ATL", home: "PIT", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "BAL", home: "BUF", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "CAR", home: "NYJ", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "CHI", home: "TEN", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "CIN", home: "NE", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "HOU", home: "IND", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "JAX", home: "MIA", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "MIN", home: "NYG", gameDay: "Sun", gameTime: "1:00 PM ET" },
  { away: "CLE", home: "DAL", gameDay: "Sun", gameTime: "4:25 PM ET" },
  { away: "DEN", home: "SEA", gameDay: "Sun", gameTime: "4:25 PM ET" },
  { away: "LV", home: "WAS", gameDay: "Sun", gameTime: "4:25 PM ET" },
  { away: "LAR", home: "DET", gameDay: "Sun", gameTime: "8:20 PM ET" },
  { away: "TB", home: "SF", gameDay: "Mon", gameTime: "8:15 PM ET" },
];

const byTeam = new Map<string, TeamMatchup>();

for (const m of MATCHUPS) {
  byTeam.set(m.away, {
    opponent: `@ ${m.home}`,
    gameDay: m.gameDay,
    gameTime: m.gameTime,
    home: false,
  });
  byTeam.set(m.home, {
    opponent: `vs ${m.away}`,
    gameDay: m.gameDay,
    gameTime: m.gameTime,
    home: true,
  });
}

export const NFL_TEAMS = [
  { abbr: "ARI", name: "Arizona Cardinals" },
  { abbr: "ATL", name: "Atlanta Falcons" },
  { abbr: "BAL", name: "Baltimore Ravens" },
  { abbr: "BUF", name: "Buffalo Bills" },
  { abbr: "CAR", name: "Carolina Panthers" },
  { abbr: "CHI", name: "Chicago Bears" },
  { abbr: "CIN", name: "Cincinnati Bengals" },
  { abbr: "CLE", name: "Cleveland Browns" },
  { abbr: "DAL", name: "Dallas Cowboys" },
  { abbr: "DEN", name: "Denver Broncos" },
  { abbr: "DET", name: "Detroit Lions" },
  { abbr: "GB", name: "Green Bay Packers" },
  { abbr: "HOU", name: "Houston Texans" },
  { abbr: "IND", name: "Indianapolis Colts" },
  { abbr: "JAX", name: "Jacksonville Jaguars" },
  { abbr: "KC", name: "Kansas City Chiefs" },
  { abbr: "LAC", name: "Los Angeles Chargers" },
  { abbr: "LAR", name: "Los Angeles Rams" },
  { abbr: "LV", name: "Las Vegas Raiders" },
  { abbr: "MIA", name: "Miami Dolphins" },
  { abbr: "MIN", name: "Minnesota Vikings" },
  { abbr: "NE", name: "New England Patriots" },
  { abbr: "NO", name: "New Orleans Saints" },
  { abbr: "NYG", name: "New York Giants" },
  { abbr: "NYJ", name: "New York Jets" },
  { abbr: "PHI", name: "Philadelphia Eagles" },
  { abbr: "PIT", name: "Pittsburgh Steelers" },
  { abbr: "SEA", name: "Seattle Seahawks" },
  { abbr: "SF", name: "San Francisco 49ers" },
  { abbr: "TB", name: "Tampa Bay Buccaneers" },
  { abbr: "TEN", name: "Tennessee Titans" },
  { abbr: "WAS", name: "Washington Commanders" },
] as const;

export function getTeamMatchup(team: string): TeamMatchup {
  return (
    byTeam.get(team) ?? {
      opponent: "TBD",
      gameDay: "Sun",
      gameTime: "1:00 PM ET",
      home: true,
    }
  );
}
