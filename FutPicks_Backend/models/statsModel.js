/* ═══════════════════════════════════════════════════════
   statsModel.js — FutPicks AI v7
   ═══════════════════════════════════════════════════════
   ALL season-sensitive queries now require season_id.
   New endpoints added:
     getTopScorersByLeagueSeason(leagueId, seasonId)
     getTopAssistsByLeagueSeason(leagueId, seasonId)
     getTeamPowerBySeason(seasonId)
     getTeamFormBySeason(teamName, seasonId)
     getTeamStatsBySeason(teamName, seasonId)
   ═══════════════════════════════════════════════════════ */

const db = require('../config/db');

/* ── Standings (uses dedicated filtered query) ── */
const getStandings = async () => {
  const [rows] = await db.query(`SELECT * FROM vw_standings`);
  return rows;
};

const getStandingsByLeagueSeason = async (leagueId, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      t.team_name,
      SUM(CASE WHEN home_goals > away_goals THEN 3
               WHEN home_goals = away_goals THEN 1
               ELSE 0 END) AS points,
      COUNT(*) AS played,
      SUM(CASE WHEN home_goals > away_goals THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN home_goals = away_goals THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN home_goals < away_goals THEN 1 ELSE 0 END) AS losses,
      SUM(home_goals) AS goals_for,
      SUM(away_goals) AS goals_against,
      SUM(home_goals) - SUM(away_goals) AS goal_diff
    FROM matches m
    JOIN teams t ON t.team_id = m.home_team_id
    WHERE m.league_id = ? AND m.season_id = ?
    GROUP BY t.team_id, t.team_name

    UNION ALL

    SELECT
      t.team_name,
      SUM(CASE WHEN away_goals > home_goals THEN 3
               WHEN away_goals = home_goals THEN 1
               ELSE 0 END) AS points,
      COUNT(*) AS played,
      SUM(CASE WHEN away_goals > home_goals THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN away_goals = home_goals THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN away_goals < home_goals THEN 1 ELSE 0 END) AS losses,
      SUM(away_goals) AS goals_for,
      SUM(home_goals) AS goals_against,
      SUM(away_goals) - SUM(home_goals) AS goal_diff
    FROM matches m
    JOIN teams t ON t.team_id = m.away_team_id
    WHERE m.league_id = ? AND m.season_id = ?
    GROUP BY t.team_id, t.team_name
  `, [leagueId, seasonId, leagueId, seasonId]);

  /* Merge home + away rows per team */
  const map = new Map();
  for (const r of rows) {
    const k = r.team_name;
    if (!map.has(k)) {
      map.set(k, { team_name: k, points: 0, played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0 });
    }
    const e = map.get(k);
    e.points       += Number(r.points);
    e.played       += Number(r.played);
    e.wins         += Number(r.wins);
    e.draws        += Number(r.draws);
    e.losses       += Number(r.losses);
    e.goals_for    += Number(r.goals_for);
    e.goals_against+= Number(r.goals_against);
  }
  return [...map.values()]
    .map(t => ({ ...t, goal_diff: t.goals_for - t.goals_against }))
    .sort((a, b) => b.points - a.points || b.goal_diff - a.goal_diff || b.goals_for - a.goals_for);
};

/* ── Top Scorers ── */
const getTopScorers = async () => {
  const [rows] = await db.query(`SELECT * FROM vw_top_scorers LIMIT 100`);
  return rows;
};

/* Filtered by league only (legacy) */
const getTopScorersByLeague = async (leagueId) => {
  const [rows] = await db.query(`
    SELECT p.player_name, t.team_name, ps.goals, ps.season_id
    FROM player_standard ps
    JOIN players p ON p.player_id = ps.player_id
    JOIN teams t ON t.team_id = ps.team_id
    WHERE ps.league_id = ?
    ORDER BY ps.goals DESC
    LIMIT 100
  `, [leagueId]);
  return rows;
};

/* ★ NEW: Filtered by league AND season */
const getTopScorersByLeagueSeason = async (leagueId, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      p.player_name,
      p.nation,
      p.position,
      p.birth_year,
      t.team_name,
      l.league_name,
      ps.goals,
      ps.assists,
      ps.mp,
      ps.minutes,
      ps.starts,
      ps.season_id
    FROM player_standard ps
    JOIN players p ON p.player_id = ps.player_id
    JOIN teams   t ON t.team_id   = ps.team_id
    JOIN leagues l ON l.league_id = ps.league_id
    WHERE ps.league_id = ?
      AND ps.season_id = ?
    ORDER BY ps.goals DESC
    LIMIT 100
  `, [leagueId, seasonId]);
  return rows;
};

/* ── Top Assists ── */
const getTopAssists = async () => {
  const [rows] = await db.query(`SELECT * FROM vw_top_assists LIMIT 100`);
  return rows;
};

const getTopAssistsByLeague = async (leagueId) => {
  const [rows] = await db.query(`
    SELECT p.player_name, t.team_name, pp.assists, pp.season_id
    FROM player_passing pp
    JOIN players p ON p.player_id = pp.player_id
    JOIN player_standard ps
      ON ps.player_id = pp.player_id
     AND ps.league_id = pp.league_id
     AND ps.season_id = pp.season_id
    JOIN teams t ON t.team_id = ps.team_id
    WHERE pp.league_id = ?
    ORDER BY pp.assists DESC
    LIMIT 100
  `, [leagueId]);
  return rows;
};

/* ★ NEW: Filtered by league AND season */
const getTopAssistsByLeagueSeason = async (leagueId, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      p.player_name,
      p.nation,
      p.position,
      p.birth_year,
      t.team_name,
      l.league_name,
      pp.assists,
      pp.key_passes,
      pp.pass_pct,
      ps.goals,
      ps.mp,
      ps.minutes,
      pp.season_id
    FROM player_passing pp
    JOIN players p ON p.player_id = pp.player_id
    JOIN player_standard ps
      ON ps.player_id = pp.player_id
     AND ps.league_id = pp.league_id
     AND ps.season_id = pp.season_id
    JOIN teams   t ON t.team_id   = ps.team_id
    JOIN leagues l ON l.league_id = pp.league_id
    WHERE pp.league_id = ?
      AND pp.season_id = ?
    ORDER BY pp.assists DESC
    LIMIT 100
  `, [leagueId, seasonId]);
  return rows;
};

/* ── Goalkeepers ── */
const getGoalkeepers = async () => {
  const [rows] = await db.query(`SELECT * FROM vw_best_goalkeepers LIMIT 200`);
  return rows;
};

/* ★ NEW: GK filtered by league + season */
const getGoalkeepersByLeagueSeason = async (leagueId, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      p.player_name,
      p.nation,
      p.birth_year,
      t.team_name,
      ps.mp,
      g.goals_against,
      g.saves,
      g.save_pct,
      g.clean_sheets,
      g.clean_sheet_pct,
      /* Bayesian-smoothed score: shrinks low-volume keepers toward league avg (~68%).
         Prior = 25 saves out of 37 faced (≈68%). Score rewards high save% WITH volume. */
      (g.saves + 25.0) / (g.saves + g.goals_against + 37.0) * 100 AS score
    FROM goalkeepers g
    JOIN players p ON p.player_id = g.player_id
    JOIN player_standard ps
      ON ps.player_id = g.player_id
     AND ps.league_id = g.league_id
     AND ps.season_id = g.season_id
    JOIN teams t ON t.team_id = ps.team_id
    WHERE g.league_id = ?
      AND g.season_id = ?
      AND ps.mp >= 3
    ORDER BY score DESC, g.clean_sheets DESC
    LIMIT 100
  `, [leagueId, seasonId]);
  return rows;
};

/* ── Team Power (historical — used only for predictions) ── */
const getTeamPower = async () => {
  const [rows] = await db.query(`SELECT * FROM vw_team_power`);
  return rows;
};

/* ★ NEW: Team power calculated per season — avoids Düsseldorf problem */
const getTeamPowerBySeason = async (leagueId, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      t.team_name,
      COUNT(*) AS played,
      ROUND(AVG(scored), 2) AS avg_scored,
      ROUND(AVG(conceded), 2) AS avg_conceded,
      SUM(CASE WHEN scored > conceded THEN 3
               WHEN scored = conceded THEN 1
               ELSE 0 END) AS points
    FROM (
      SELECT home_team_id AS team_id, home_goals AS scored, away_goals AS conceded
      FROM matches
      WHERE league_id = ? AND season_id = ?

      UNION ALL

      SELECT away_team_id, away_goals AS scored, home_goals AS conceded
      FROM matches
      WHERE league_id = ? AND season_id = ?
    ) x
    JOIN teams t ON t.team_id = x.team_id
    GROUP BY t.team_id, t.team_name
    HAVING COUNT(*) >= 3
    ORDER BY points DESC
  `, [leagueId, seasonId, leagueId, seasonId]);
  return rows;
};

/* ── Player search ── */
const getPlayerByName = async (name) => {
  const [rows] = await db.query(`
    SELECT * FROM players WHERE player_name LIKE ? LIMIT 50
  `, [`%${name}%`]);
  return rows;
};

/* ★ NEW: Full player stats for a specific season */
const getPlayerStatsBySeason = async (playerName, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      p.player_id,
      p.player_name,
      p.nation,
      p.position,
      p.birth_year,
      t.team_name,
      l.league_name,
      ps.goals,
      ps.assists,
      ps.mp,
      ps.minutes,
      ps.starts,
      ps.yellow_cards,
      ps.red_cards,
      ps.season_id
    FROM player_standard ps
    JOIN players p ON p.player_id = ps.player_id
    JOIN teams   t ON t.team_id   = ps.team_id
    JOIN leagues l ON l.league_id = ps.league_id
    WHERE p.player_name LIKE ?
      AND ps.season_id = ?
    ORDER BY ps.goals DESC
    LIMIT 20
  `, [`%${playerName}%`, seasonId]);
  return rows;
};

/* ★ NEW: All seasons a player has data for */
const getPlayerSeasons = async (playerName) => {
  const [rows] = await db.query(`
    SELECT DISTINCT
      s.season_id,
      s.season_name,
      t.team_name,
      l.league_name,
      ps.goals,
      ps.assists
    FROM player_standard ps
    JOIN players p ON p.player_id = ps.player_id
    JOIN seasons s ON s.season_id = ps.season_id
    JOIN teams   t ON t.team_id   = ps.team_id
    JOIN leagues l ON l.league_id = ps.league_id
    WHERE p.player_name LIKE ?
    ORDER BY s.season_name DESC
  `, [`%${playerName}%`]);
  return rows;
};

/* ── Team search & matches ── */
const getTeamByName = async (name) => {
  const [rows] = await db.query(`SELECT * FROM teams WHERE team_name LIKE ? LIMIT 50`, [`%${name}%`]);
  return rows;
};

const getTeamMatches = async (teamName) => {
  const [rows] = await db.query(`
    SELECT m.match_id, l.league_name, s.season_name,
           ht.team_name AS home_team, at.team_name AS away_team,
           m.match_date, m.home_goals, m.away_goals,
           m.attendance, m.venue, m.referee
    FROM matches m
    JOIN leagues l ON l.league_id = m.league_id
    JOIN seasons s ON s.season_id = m.season_id
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE ht.team_name = ? OR at.team_name = ?
    ORDER BY m.match_date DESC
  `, [teamName, teamName]);
  return rows;
};

const getTeamSeasonMatches = async (teamName, seasonId) => {
  const [rows] = await db.query(`
    SELECT m.match_id, l.league_name, s.season_name,
           ht.team_name AS home_team, at.team_name AS away_team,
           m.match_date, m.home_goals, m.away_goals,
           m.attendance, m.venue, m.referee
    FROM matches m
    JOIN leagues l ON l.league_id = m.league_id
    JOIN seasons s ON s.season_id = m.season_id
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE (ht.team_name = ? OR at.team_name = ?)
      AND m.season_id = ?
    ORDER BY m.match_date DESC
  `, [teamName, teamName, seasonId]);
  return rows;
};

const getMatchesByLeague = async (leagueId) => {
  const [rows] = await db.query(`
    SELECT m.match_id, l.league_name, s.season_name,
           ht.team_name AS home_team, at.team_name AS away_team,
           m.match_date, m.home_goals, m.away_goals,
           m.attendance, m.venue, m.referee
    FROM matches m
    JOIN leagues l ON l.league_id = m.league_id
    JOIN seasons s ON s.season_id = m.season_id
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE m.league_id = ?
    ORDER BY m.match_date DESC
  `, [leagueId]);
  return rows;
};

const getMatchesByLeagueSeason = async (leagueId, seasonId) => {
  const [rows] = await db.query(`
    SELECT m.match_id, l.league_name, s.season_name,
           ht.team_name AS home_team, at.team_name AS away_team,
           m.match_date, m.home_goals, m.away_goals,
           m.attendance, m.venue, m.referee
    FROM matches m
    JOIN leagues l ON l.league_id = m.league_id
    JOIN seasons s ON s.season_id = m.season_id
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE m.league_id = ? AND m.season_id = ?
    ORDER BY m.match_date DESC
  `, [leagueId, seasonId]);
  return rows;
};

const getTeamsByLeague = async (leagueId) => {
  const [rows] = await db.query(`
    SELECT DISTINCT t.team_id, t.team_name
    FROM teams t
    JOIN player_standard ps ON ps.team_id = t.team_id
    WHERE ps.league_id = ?
    ORDER BY t.team_name
  `, [leagueId]);
  return rows;
};

/* ★ NEW: Teams that have played matches in a specific league+season */
const getTeamsByLeagueSeason = async (leagueId, seasonId) => {
  const [rows] = await db.query(`
    SELECT DISTINCT t.team_id, t.team_name
    FROM teams t
    JOIN (
      SELECT home_team_id AS team_id FROM matches WHERE league_id = ? AND season_id = ?
      UNION
      SELECT away_team_id FROM matches WHERE league_id = ? AND season_id = ?
    ) x ON x.team_id = t.team_id
    ORDER BY t.team_name
  `, [leagueId, seasonId, leagueId, seasonId]);
  return rows;
};

/* ── Team stats (used for predictions — intentionally historical) ── */
const getTeamStats = async (teamName) => {
  const [rows] = await db.query(`
    SELECT tp.team_name, tp.attack_strength, tp.defense_strength, s.points
    FROM vw_team_power tp
    LEFT JOIN vw_standings s ON s.team_name = tp.team_name
    WHERE tp.team_name = ?
  `, [teamName]);
  return rows;
};

/* ★ NEW: Team form filtered by season */
const getTeamFormBySeason = async (teamName, seasonId) => {
  const [rows] = await db.query(`
    SELECT match_date,
      CASE
        WHEN ht.team_name = ? AND home_goals > away_goals THEN 'W'
        WHEN at.team_name = ? AND away_goals > home_goals THEN 'W'
        WHEN home_goals = away_goals THEN 'D'
        ELSE 'L'
      END AS result
    FROM matches m
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE (ht.team_name = ? OR at.team_name = ?)
      AND m.season_id = ?
    ORDER BY m.match_date DESC
    LIMIT 10
  `, [teamName, teamName, teamName, teamName, seasonId]);
  return rows;
};

/* ── Form (all time — for predictions) ── */
const getTeamForm = async (teamName) => {
  const [rows] = await db.query(`
    SELECT * FROM (
      SELECT m.match_date,
        CASE
          WHEN ht.team_name = ? AND m.home_goals > m.away_goals THEN 'W'
          WHEN at.team_name = ? AND m.away_goals > m.home_goals THEN 'W'
          WHEN m.home_goals = m.away_goals THEN 'D'
          ELSE 'L'
        END AS result
      FROM matches m
      JOIN teams ht ON ht.team_id = m.home_team_id
      JOIN teams at ON at.team_id = m.away_team_id
      WHERE ht.team_name = ? OR at.team_name = ?
      ORDER BY m.match_date DESC
      LIMIT 10
    ) x
  `, [teamName, teamName, teamName, teamName]);
  return rows;
};

const getHeadToHead = async (homeTeam, awayTeam) => {
  const [rows] = await db.query(`
    SELECT m.*, ht.team_name AS home_team, at.team_name AS away_team
    FROM matches m
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE (ht.team_name = ? AND at.team_name = ?)
       OR (ht.team_name = ? AND at.team_name = ?)
    ORDER BY m.match_date DESC
    LIMIT 20
  `, [homeTeam, awayTeam, awayTeam, homeTeam]);
  return rows;
};

const getTeamGoals = async (teamName) => {
  const [rows] = await db.query(`
    SELECT
      ROUND(AVG(CASE WHEN ht.team_name = ? THEN m.home_goals ELSE m.away_goals END), 2) AS avg_scored,
      ROUND(AVG(CASE WHEN ht.team_name = ? THEN m.away_goals ELSE m.home_goals END), 2) AS avg_conceded
    FROM matches m
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE ht.team_name = ? OR at.team_name = ?
  `, [teamName, teamName, teamName, teamName]);
  return rows;
};

const getTeamHomeAway = async (teamName) => {
  const [rows] = await db.query(`
    SELECT
      ROUND(100 * SUM(CASE WHEN ht.team_name = ? AND m.home_goals > m.away_goals THEN 1 ELSE 0 END)
            / NULLIF(SUM(CASE WHEN ht.team_name = ? THEN 1 ELSE 0 END), 0), 2) AS home_win_pct,
      ROUND(100 * SUM(CASE WHEN at.team_name = ? AND m.away_goals > m.home_goals THEN 1 ELSE 0 END)
            / NULLIF(SUM(CASE WHEN at.team_name = ? THEN 1 ELSE 0 END), 0), 2) AS away_win_pct
    FROM matches m
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE ht.team_name = ? OR at.team_name = ?
  `, [teamName, teamName, teamName, teamName, teamName, teamName]);
  return rows;
};

const getLastMatches = async (teamName) => {
  const [rows] = await db.query(`
    SELECT m.*
    FROM matches m
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE ht.team_name = ? OR at.team_name = ?
    ORDER BY m.match_date DESC
    LIMIT 10
  `, [teamName, teamName]);
  return rows;
};

const searchAll = async (search) => {
  const [players] = await db.query(`
    SELECT player_id, player_name FROM players WHERE player_name LIKE ? LIMIT 20
  `, [`%${search}%`]);
  const [teams] = await db.query(`
    SELECT team_id, team_name FROM teams WHERE team_name LIKE ? LIMIT 20
  `, [`%${search}%`]);
  return { players, teams };
};

const getSummary = async () => {
  const db = require('../config/db');
  const [[row]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM leagues)  AS leagues,
      (SELECT COUNT(*) FROM seasons)  AS seasons,
      (SELECT COUNT(*) FROM teams)    AS teams,
      (SELECT COUNT(*) FROM matches WHERE home_goals IS NOT NULL) AS matches,
      (SELECT COUNT(DISTINCT player_name) FROM top_scorers) AS players
  `);
  return row;
};


/* ── Player full stats (all tables joined) for profile ── */
const getPlayerFullStats = async (playerName, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      p.player_id, p.player_name, p.nation, p.position, p.birth_year,
      t.team_name, l.league_name,
      ps.mp, ps.starts, ps.minutes, ps.goals AS std_goals, ps.assists AS std_assists,
      ps.yellow_cards, ps.red_cards, ps.nineties,
      sh.shots, sh.shots_on_target, sh.shot_accuracy, sh.shots_per90, sh.goals AS sh_goals,
      pp.passes_completed, pp.passes_attempted, pp.pass_pct, pp.assists AS pass_assists, pp.key_passes,
      pd.tackles, pd.tackles_won, pd.interceptions, pd.clearances, pd.errors,
      pg.sca, pg.sca90, pg.gca, pg.gca90,
      pm.fouls_committed, pm.fouls_drawn, pm.offsides,
      gk.goals_against, gk.saves, gk.save_pct AS gk_save_pct, gk.clean_sheets, gk.clean_sheet_pct
    FROM player_standard ps
    JOIN players  p  ON p.player_id  = ps.player_id
    JOIN teams    t  ON t.team_id    = ps.team_id
    JOIN leagues  l  ON l.league_id  = ps.league_id
    LEFT JOIN player_shooting   sh ON sh.player_id = ps.player_id AND sh.season_id = ps.season_id
    LEFT JOIN player_passing    pp ON pp.player_id = ps.player_id AND pp.season_id = ps.season_id
    LEFT JOIN player_defense    pd ON pd.player_id = ps.player_id AND pd.season_id = ps.season_id
    LEFT JOIN player_gca        pg ON pg.player_id = ps.player_id AND pg.season_id = ps.season_id
    LEFT JOIN player_misc       pm ON pm.player_id = ps.player_id AND pm.season_id = ps.season_id
    LEFT JOIN goalkeepers       gk ON gk.player_id = ps.player_id AND gk.season_id = ps.season_id
    WHERE p.player_name LIKE ? AND ps.season_id = ?
    ORDER BY ps.goals DESC
    LIMIT 1
  `, [`%${playerName}%`, seasonId]);
  return rows;
};

/* ── Top players for a team in a season (for match prediction) ── */
const getTeamKeyPlayers = async (teamName, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      p.player_name, p.position,
      ps.goals, ps.assists, ps.mp, ps.nineties,
      sh.shots_per90, sh.shot_accuracy, sh.shots_on_target,
      t.team_name,
      (SELECT SUM(ps2.goals) FROM player_standard ps2
       JOIN teams t2 ON t2.team_id = ps2.team_id
       WHERE t2.team_name LIKE ? AND ps2.season_id = ?) AS team_total_goals
    FROM player_standard ps
    JOIN players  p ON p.player_id = ps.player_id
    JOIN teams    t ON t.team_id   = ps.team_id
    LEFT JOIN player_shooting sh ON sh.player_id = ps.player_id AND sh.season_id = ps.season_id
    WHERE t.team_name LIKE ? AND ps.season_id = ? AND ps.mp >= 3
    GROUP BY p.player_id
    ORDER BY (ps.goals + ps.assists * 0.6) DESC
    LIMIT 5
  `, [`%${teamName}%`, seasonId, `%${teamName}%`, seasonId]);
  return rows;
};

/* ── Top card players for a team (for match prediction) ── */
const getTeamCardPlayers = async (teamName, seasonId) => {
  const [rows] = await db.query(`
    SELECT
      p.player_name, p.position,
      ps.yellow_cards, ps.red_cards, ps.mp, ps.nineties,
      t.team_name
    FROM player_standard ps
    JOIN players p ON p.player_id = ps.player_id
    JOIN teams   t ON t.team_id   = ps.team_id
    WHERE t.team_name LIKE ? AND ps.season_id = ? AND ps.mp >= 3
      AND (ps.yellow_cards > 0 OR ps.red_cards > 0)
    GROUP BY p.player_id
    ORDER BY (ps.yellow_cards + ps.red_cards * 2) DESC
    LIMIT 4
  `, [`%${teamName}%`, seasonId]);
  return rows;
};

module.exports = {
  getSummary,
  getStandings,
  getStandingsByLeagueSeason,
  getTopScorers,
  getTopScorersByLeague,
  getTopScorersByLeagueSeason,      // ★ NEW
  getTopAssists,
  getTopAssistsByLeague,
  getTopAssistsByLeagueSeason,      // ★ NEW
  getGoalkeepers,
  getGoalkeepersByLeagueSeason,     // ★ NEW
  getTeamPower,
  getTeamPowerBySeason,             // ★ NEW
  getPlayerByName,
  getPlayerStatsBySeason,
  getPlayerSeasons,
  getPlayerFullStats,
  getTeamsByLeague,
  getTeamsByLeagueSeason,
  getTeamKeyPlayers,
  getTeamCardPlayers,
  getTeamByName,
  getTeamMatches,
  getTeamSeasonMatches,
  getMatchesByLeague,
  getMatchesByLeagueSeason,
  getHeadToHead,
  getTeamForm,
  getTeamFormBySeason,
  getTeamStats,
  getTeamGoals,
  getTeamHomeAway,
  getLastMatches,
  searchAll,
};
