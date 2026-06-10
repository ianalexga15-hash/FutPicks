/* ═══════════════════════════════════════════════════════════════
   teamStrengthCalculator.js
   Calcula parámetros Dixon-Coles por equipo por temporada.

   Fórmula:
     attack_i  = goals_scored_i / avg_goals_league
     defense_i = goals_conceded_i / avg_goals_league
     home_adv  = ratio home_goals vs away_goals global

   Resultado por equipo:
     { team_id, team_name, attack, defense, home_adv,
       played, goals_for, goals_against, points,
       home_win_pct, away_win_pct, form }
═══════════════════════════════════════════════════════════════ */
'use strict';

const db = require('../config/db');

/* ── Filtro de temporada regular (excluye liguilla para Liga MX) ──
   Para ligas sin match_round (NULL en todos sus partidos), el filtro
   IS NULL pasa todo. Para Liga MX, excluye Quarter/Semi/Final/seed. */
const REGULAR_FILTER = `AND (m.match_round IS NULL OR m.match_round LIKE '%Regular%')`;
const REGULAR_FILTER_BARE = `AND (match_round IS NULL OR match_round LIKE '%Regular%')`;

/* ── Liga media de goles por equipo por partido ── */
async function leagueAvgGoals(leagueId, seasonId) {
  const [rows] = await db.query(`
    SELECT
      ROUND(AVG(half_goals), 4) AS avg
    FROM (
      SELECT home_goals AS half_goals FROM matches
      WHERE league_id = ? AND season_id = ? ${REGULAR_FILTER_BARE}
      UNION ALL
      SELECT away_goals FROM matches
      WHERE league_id = ? AND season_id = ? ${REGULAR_FILTER_BARE}
    ) x
  `, [leagueId, seasonId, leagueId, seasonId]);
  return parseFloat(rows[0]?.avg) || 1.35;
}

/* ── Estadísticas brutas por equipo en una liga+temporada ── */
async function teamRawStats(leagueId, seasonId) {
  const [rows] = await db.query(`
    SELECT
      t.team_id,
      t.team_name,
      COUNT(*) AS played,
      SUM(scored)      AS goals_for,
      SUM(conceded)    AS goals_against,
      SUM(CASE WHEN scored > conceded THEN 3 WHEN scored = conceded THEN 1 ELSE 0 END) AS points,
      SUM(CASE WHEN scored > conceded THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN scored = conceded THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN scored < conceded THEN 1 ELSE 0 END) AS losses
    FROM (
      SELECT home_team_id AS team_id, home_goals AS scored, away_goals AS conceded
      FROM matches WHERE league_id = ? AND season_id = ? ${REGULAR_FILTER_BARE}
      UNION ALL
      SELECT away_team_id, away_goals AS scored, home_goals AS conceded
      FROM matches WHERE league_id = ? AND season_id = ? ${REGULAR_FILTER_BARE}
    ) x
    JOIN teams t ON t.team_id = x.team_id
    GROUP BY t.team_id, t.team_name
    HAVING COUNT(*) >= 2
  `, [leagueId, seasonId, leagueId, seasonId, leagueId, seasonId]);
  return rows;
}

/* ── Home/Away split ── */
async function teamHomeAwaySplit(leagueId, seasonId) {
  const [rows] = await db.query(`
    SELECT
      t.team_id,
      COUNT(CASE WHEN m.home_team_id = t.team_id THEN 1 END) AS home_played,
      SUM(CASE WHEN m.home_team_id = t.team_id AND m.home_goals > m.away_goals THEN 1 ELSE 0 END) AS home_wins,
      COUNT(CASE WHEN m.away_team_id = t.team_id THEN 1 END) AS away_played,
      SUM(CASE WHEN m.away_team_id = t.team_id AND m.away_goals > m.home_goals THEN 1 ELSE 0 END) AS away_wins
    FROM teams t
    JOIN matches m ON (m.home_team_id = t.team_id OR m.away_team_id = t.team_id)
    WHERE m.league_id = ? AND m.season_id = ? ${REGULAR_FILTER}
    GROUP BY t.team_id
  `, [leagueId, seasonId]);

  const map = new Map();
  for (const r of rows) {
    const hp = Number(r.home_played) || 0;
    const ap = Number(r.away_played) || 0;
    map.set(Number(r.team_id), {
      home_win_pct: hp > 0 ? Math.round(Number(r.home_wins) / hp * 100) : 0,
      away_win_pct: ap > 0 ? Math.round(Number(r.away_wins) / ap * 100) : 0,
    });
  }
  return map;
}

/* ── Últimas 5 formas ── */
async function teamForm(leagueId, seasonId) {
  const [rows] = await db.query(`
    SELECT
      t.team_id,
      m.match_date,
      CASE
        WHEN m.home_team_id = t.team_id AND m.home_goals > m.away_goals THEN 'W'
        WHEN m.away_team_id = t.team_id AND m.away_goals > m.home_goals THEN 'W'
        WHEN m.home_goals = m.away_goals THEN 'D'
        ELSE 'L'
      END AS result
    FROM teams t
    JOIN matches m ON (m.home_team_id = t.team_id OR m.away_team_id = t.team_id)
    WHERE m.league_id = ? AND m.season_id = ? ${REGULAR_FILTER}
    ORDER BY t.team_id, m.match_date DESC
  `, [leagueId, seasonId]);

  const map = new Map();
  for (const r of rows) {
    const tid = Number(r.team_id);
    if (!map.has(tid)) map.set(tid, []);
    const arr = map.get(tid);
    if (arr.length < 5) arr.push(r.result);
  }
  return map;
}

/* ── FUNCIÓN PRINCIPAL ──────────────────────────────────────── */
async function calculateStrengths(leagueId, seasonId) {
  const [avg, raw, haMap, formMap] = await Promise.all([
    leagueAvgGoals(leagueId, seasonId),
    teamRawStats(leagueId, seasonId),
    teamHomeAwaySplit(leagueId, seasonId),
    teamForm(leagueId, seasonId),
  ]);

  const mu = avg || 1.35;

  return raw.map(t => {
    const played = Number(t.played) || 0;
    const gf     = Number(t.goals_for) || 0;
    const ga     = Number(t.goals_against) || 0;
    const ppg    = played > 0 ? (Number(t.points) / played) : 0;

    /* Dixon-Coles parameters */
    const avgScored    = played > 0 ? gf / played : mu;
    const avgConceded  = played > 0 ? ga / played : mu;
    const attack       = avgScored   / mu;
    const defense      = avgConceded / mu;

    const ha    = haMap.get(Number(t.team_id)) || { home_win_pct: 0, away_win_pct: 0 };
    const form  = formMap.get(Number(t.team_id)) || [];
    const formPts = form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
    const formMax = form.length * 3 || 1;
    const formMod = 0.85 + 0.30 * (formPts / formMax); // 0.85 – 1.15

    return {
      team_id:        Number(t.team_id),
      team_name:      t.team_name,
      played,
      goals_for:      gf,
      goals_against:  ga,
      goal_diff:      gf - ga,
      points:         Number(t.points),
      wins:           Number(t.wins),
      draws:          Number(t.draws),
      losses:         Number(t.losses),
      ppg:            parseFloat(ppg.toFixed(3)),
      attack:         parseFloat(attack.toFixed(4)),
      defense:        parseFloat(defense.toFixed(4)),
      form_mod:       parseFloat(formMod.toFixed(4)),
      form:           form,
      home_win_pct:   ha.home_win_pct,
      away_win_pct:   ha.away_win_pct,
      league_mu:      mu,
    };
  }).sort((a, b) => b.points - a.points || b.goal_diff - a.goal_diff);
}

/* ── Calcula fuerzas sobre MÚLTIPLES temporadas (para predicción) ── */
async function calculateHistoricalStrengths(leagueId, seasonIds) {
  const results = await Promise.all(
    seasonIds.map(sid => calculateStrengths(leagueId, sid).catch(() => []))
  );

  /* Promedio ponderado: temporada más reciente tiene peso 3x */
  const weights = seasonIds.map((_, i) => i + 1); // [1, 2, 3, 4, 5] → más reciente = 5
  const totalW  = weights.reduce((a, b) => a + b, 0);

  const teamAgg = new Map();

  results.forEach((seasonData, si) => {
    const w = weights[si];
    for (const t of seasonData) {
      if (!teamAgg.has(t.team_name)) {
        teamAgg.set(t.team_name, {
          team_name: t.team_name,
          wAttack: 0, wDefense: 0, wFormMod: 0,
          wHomePct: 0, wAwayPct: 0, wPpg: 0,
          totalW: 0,
        });
      }
      const agg = teamAgg.get(t.team_name);
      agg.wAttack   += t.attack   * w;
      agg.wDefense  += t.defense  * w;
      agg.wFormMod  += t.form_mod * w;
      agg.wHomePct  += t.home_win_pct * w;
      agg.wAwayPct  += t.away_win_pct * w;
      agg.wPpg      += t.ppg * w;
      agg.totalW    += w;
    }
  });

  const out = [];
  for (const [, agg] of teamAgg) {
    const tw = agg.totalW || 1;
    out.push({
      team_name:     agg.team_name,
      attack:        parseFloat((agg.wAttack   / tw).toFixed(4)),
      defense:       parseFloat((agg.wDefense  / tw).toFixed(4)),
      form_mod:      parseFloat((agg.wFormMod  / tw).toFixed(4)),
      home_win_pct:  parseFloat((agg.wHomePct  / tw).toFixed(1)),
      away_win_pct:  parseFloat((agg.wAwayPct  / tw).toFixed(1)),
      ppg:           parseFloat((agg.wPpg      / tw).toFixed(3)),
    });
  }
  return out;
}


/* ── Variante con fecha de corte (para backtesting) ── */
async function leagueAvgGoalsCutoff(leagueId, seasonId, cutoffDate) {
  const [rows] = await db.query(`
    SELECT ROUND(AVG(half_goals), 4) AS avg FROM (
      SELECT home_goals AS half_goals FROM matches
      WHERE league_id = ? AND season_id = ? AND match_date <= ? ${REGULAR_FILTER_BARE}
      UNION ALL
      SELECT away_goals FROM matches
      WHERE league_id = ? AND season_id = ? AND match_date <= ? ${REGULAR_FILTER_BARE}
    ) x
  `, [leagueId, seasonId, cutoffDate, leagueId, seasonId, cutoffDate]);
  return parseFloat(rows[0]?.avg) || 1.35;
}

async function teamRawStatsCutoff(leagueId, seasonId, cutoffDate) {
  const [rows] = await db.query(`
    SELECT
      t.team_id, t.team_name,
      COUNT(*) AS played,
      SUM(scored) AS goals_for, SUM(conceded) AS goals_against,
      SUM(CASE WHEN scored > conceded THEN 3 WHEN scored = conceded THEN 1 ELSE 0 END) AS points,
      SUM(CASE WHEN scored > conceded THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN scored = conceded THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN scored < conceded THEN 1 ELSE 0 END) AS losses
    FROM (
      SELECT home_team_id AS team_id, home_goals AS scored, away_goals AS conceded
      FROM matches WHERE league_id = ? AND season_id = ? AND match_date <= ? ${REGULAR_FILTER_BARE}
      UNION ALL
      SELECT away_team_id, away_goals AS scored, home_goals AS conceded
      FROM matches WHERE league_id = ? AND season_id = ? AND match_date <= ? ${REGULAR_FILTER_BARE}
    ) x
    JOIN teams t ON t.team_id = x.team_id
    GROUP BY t.team_id, t.team_name
    HAVING COUNT(*) >= 2
  `, [leagueId, seasonId, cutoffDate, leagueId, seasonId, cutoffDate, leagueId, seasonId, cutoffDate]);
  return rows;
}

async function teamHomeAwaySplitCutoff(leagueId, seasonId, cutoffDate) {
  const [rows] = await db.query(`
    SELECT
      t.team_id,
      COUNT(CASE WHEN m.home_team_id = t.team_id THEN 1 END) AS home_played,
      SUM(CASE WHEN m.home_team_id = t.team_id AND m.home_goals > m.away_goals THEN 1 ELSE 0 END) AS home_wins,
      COUNT(CASE WHEN m.away_team_id = t.team_id THEN 1 END) AS away_played,
      SUM(CASE WHEN m.away_team_id = t.team_id AND m.away_goals > m.home_goals THEN 1 ELSE 0 END) AS away_wins
    FROM teams t
    JOIN matches m ON (m.home_team_id = t.team_id OR m.away_team_id = t.team_id)
    WHERE m.league_id = ? AND m.season_id = ? AND m.match_date <= ? ${REGULAR_FILTER}
    GROUP BY t.team_id
  `, [leagueId, seasonId, cutoffDate]);

  const map = new Map();
  for (const r of rows) {
    const hp = Number(r.home_played) || 0;
    const ap = Number(r.away_played) || 0;
    map.set(Number(r.team_id), {
      home_win_pct: hp > 0 ? Math.round(Number(r.home_wins) / hp * 100) : 0,
      away_win_pct: ap > 0 ? Math.round(Number(r.away_wins) / ap * 100) : 0,
    });
  }
  return map;
}

async function teamFormCutoff(leagueId, seasonId, cutoffDate) {
  const [rows] = await db.query(`
    SELECT
      t.team_id, m.match_date,
      CASE
        WHEN m.home_team_id = t.team_id AND m.home_goals > m.away_goals THEN 'W'
        WHEN m.away_team_id = t.team_id AND m.away_goals > m.home_goals THEN 'W'
        WHEN m.home_goals = m.away_goals THEN 'D'
        ELSE 'L'
      END AS result
    FROM teams t
    JOIN matches m ON (m.home_team_id = t.team_id OR m.away_team_id = t.team_id)
    WHERE m.league_id = ? AND m.season_id = ? AND m.match_date <= ? ${REGULAR_FILTER}
    ORDER BY t.team_id, m.match_date DESC
  `, [leagueId, seasonId, cutoffDate]);

  const map = new Map();
  for (const r of rows) {
    const tid = Number(r.team_id);
    if (!map.has(tid)) map.set(tid, []);
    const arr = map.get(tid);
    if (arr.length < 5) arr.push(r.result);
  }
  return map;
}

async function calculateStrengthsCutoff(leagueId, seasonId, cutoffDate) {
  const [avg, raw, haMap, formMap] = await Promise.all([
    leagueAvgGoalsCutoff(leagueId, seasonId, cutoffDate),
    teamRawStatsCutoff(leagueId, seasonId, cutoffDate),
    teamHomeAwaySplitCutoff(leagueId, seasonId, cutoffDate),
    teamFormCutoff(leagueId, seasonId, cutoffDate),
  ]);

  const mu = avg || 1.35;

  return raw.map(t => {
    const played = Number(t.played) || 0;
    const gf     = Number(t.goals_for) || 0;
    const ga     = Number(t.goals_against) || 0;
    const ppg    = played > 0 ? (Number(t.points) / played) : 0;

    const avgScored   = played > 0 ? gf / played : mu;
    const avgConceded = played > 0 ? ga / played : mu;
    const attack      = avgScored   / mu;
    const defense     = avgConceded / mu;

    const ha   = haMap.get(Number(t.team_id)) || { home_win_pct: 0, away_win_pct: 0 };
    const form = formMap.get(Number(t.team_id)) || [];
    const formPts = form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
    const formMax = form.length * 3 || 1;
    const formMod = 0.85 + 0.30 * (formPts / formMax);

    return {
      team_id:       Number(t.team_id),
      team_name:     t.team_name,
      played, goals_for: gf, goals_against: ga,
      goal_diff: gf - ga,
      points: Number(t.points),
      wins: Number(t.wins), draws: Number(t.draws), losses: Number(t.losses),
      ppg: parseFloat(ppg.toFixed(3)),
      attack:        parseFloat(attack.toFixed(4)),
      defense:       parseFloat(defense.toFixed(4)),
      form_mod:      parseFloat(formMod.toFixed(4)),
      form,
      home_win_pct:  ha.home_win_pct,
      away_win_pct:  ha.away_win_pct,
      league_mu:     mu,
    };
  }).sort((a, b) => b.points - a.points || b.goal_diff - a.goal_diff);
}

module.exports = { calculateStrengths, calculateHistoricalStrengths, calculateStrengthsCutoff, leagueAvgGoals };