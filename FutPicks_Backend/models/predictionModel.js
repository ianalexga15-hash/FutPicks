/* ═══════════════════════════════════════════════════════════════
   models/predictionModel.js — FutPicks AI FINAL
   
   DB SEASON ORDER (actual database):
     season_id 1 → 2025_2026  ← MOST RECENT
     season_id 2 → 2024_2025
     season_id 3 → 2023_2024
     season_id 4 → 2022_2023
     season_id 5 → 2021_2022  ← OLDEST
   
   KEY RULE: Never use Math.max(season_id) to find "most recent".
             Always sort by season_name DESC.
═══════════════════════════════════════════════════════════════ */
'use strict';

const db        = require('../config/db');
const calc      = require('../services/teamStrengthCalculator');
const engine    = require('../services/predictionEngine');
const scheduler = require('../services/scheduleGenerator');

/* ── All season IDs ── */
async function getAllSeasonIds() {
  const [rows] = await db.query(`SELECT season_id FROM seasons ORDER BY season_id ASC`);
  return rows.map(r => Number(r.season_id));
}

/* ── Most recent season by NAME (not by ID) ──
   '2025_2026' sorts after '2024_2025' lexicographically → correct */
async function getMostRecentSeasonId() {
  const [rows] = await db.query(`
    SELECT season_id FROM seasons ORDER BY season_name DESC LIMIT 1
  `);
  return rows[0] ? Number(rows[0].season_id) : 1;
}

/* ── Year that comes AFTER the most recent real season ──
   '2025_2026' → returns '2026' (start of 2026/2027) */
async function getNextSeasonYear() {
  const [rows] = await db.query(`
    SELECT season_name FROM seasons ORDER BY season_name DESC LIMIT 1
  `);
  if (!rows[0]) return '2026';
  const parts = rows[0].season_name.split('_');
  // '2025_2026' → parts[1] = '2026'
  return parts[1] || String(Number(parts[0]) + 1);
}

/* ── Historical mu ── */
async function historicalMu(leagueId, seasonIds) {
  if (!seasonIds.length) return 1.35;
  const ph = seasonIds.map(() => '?').join(',');
  const [rows] = await db.query(`
    SELECT ROUND(AVG(half), 4) AS mu FROM (
      SELECT home_goals AS half FROM matches WHERE league_id = ? AND season_id IN (${ph})
      UNION ALL
      SELECT away_goals FROM matches WHERE league_id = ? AND season_id IN (${ph})
    ) x
  `, [leagueId, ...seasonIds, leagueId, ...seasonIds]);
  return parseFloat(rows[0]?.mu) || 1.35;
}

/* ══════════════════════════════════════════════════════════════
   SINGLE MATCH PREDICTION
   Uses all historical seasons for strength calculation.
══════════════════════════════════════════════════════════════ */
async function predictSingleMatch(leagueId, homeTeamName, awayTeamName) {
  const seasonIds = await getAllSeasonIds();
  const [strengths, mu] = await Promise.all([
    calc.calculateHistoricalStrengths(leagueId, seasonIds),
    historicalMu(leagueId, seasonIds),
  ]);

  const homeStr = strengths.find(t => t.team_name === homeTeamName);
  const awayStr = strengths.find(t => t.team_name === awayTeamName);

  if (!homeStr || !awayStr) {
    throw new Error(`Equipo no encontrado en histórico: ${!homeStr ? homeTeamName : awayTeamName}`);
  }

  const prediction = engine.predictMatch(homeStr, awayStr, mu);
  return {
    ...prediction,
    model: 'Dixon-Coles Poisson v1',
    data_source: `${seasonIds.length} temporadas históricas`,
    mu_used: mu,
  };
}

/* ══════════════════════════════════════════════════════════════
   FUTURE SEASON SIMULATION
   
   targetSeasonYear: '2026' means 2026/2027
   targetRound: simulate up to this matchday (default = all)
   
   Process:
   1. Get all real season IDs
   2. Get teams from most recent REAL season (by name, not ID)
   3. Generate round-robin calendar
   4. Simulate round by round accumulating state
══════════════════════════════════════════════════════════════ */
async function simulateFutureSeason(leagueId, targetSeasonYear, targetRound = null) {
  const [seasonIds, recentSeasonId] = await Promise.all([
    getAllSeasonIds(),
    getMostRecentSeasonId(),
  ]);

  const [strengths, mu, schedule] = await Promise.all([
    calc.calculateHistoricalStrengths(leagueId, seasonIds),
    historicalMu(leagueId, seasonIds),
    scheduler.generateFutureSchedule(leagueId, recentSeasonId, targetSeasonYear),
  ]);

  if (!schedule.teams.length) {
    throw new Error(`Sin equipos para la liga ${leagueId}. Verifica que la liga tenga partidos en la DB.`);
  }

  const leagueTeamSet = new Set(schedule.teams);
  const teams = strengths.filter(t => leagueTeamSet.has(t.team_name));

  // Fill teams with no historical data with league averages
  for (const name of schedule.teams) {
    if (!teams.find(t => t.team_name === name)) {
      teams.push({ team_name: name, attack: 1.0, defense: 1.0, form_mod: 1.0, home_win_pct: 45, away_win_pct: 30, ppg: 1.5 });
    }
  }

  const maxRound = targetRound || schedule.total_matchdays;
  const simulation = engine.simulateSeason(teams, schedule.fixtures, mu, maxRound);

  return {
    season:          schedule.season_label,
    league_id:       leagueId,
    target_round:    maxRound,
    total_matchdays: schedule.total_matchdays,
    teams_count:     schedule.teams.length,
    mu_used:         mu,
    data_source:     `${seasonIds.length} temporadas históricas reales`,
    model:           'Dixon-Coles Poisson + Monte Carlo v1',
    ...simulation,
  };
}

/* ══════════════════════════════════════════════════════════════
   MONTE CARLO — probability distributions
══════════════════════════════════════════════════════════════ */
async function monteCarloProbabilities(leagueId, targetSeasonYear, simulations = 500) {
  const [seasonIds, recentSeasonId] = await Promise.all([
    getAllSeasonIds(),
    getMostRecentSeasonId(),
  ]);

  const [strengths, mu, schedule] = await Promise.all([
    calc.calculateHistoricalStrengths(leagueId, seasonIds),
    historicalMu(leagueId, seasonIds),
    scheduler.generateFutureSchedule(leagueId, recentSeasonId, targetSeasonYear),
  ]);

  if (!schedule.teams.length) {
    throw new Error(`Sin equipos para la liga ${leagueId}.`);
  }

  const leagueTeamSet = new Set(schedule.teams);
  const teams = strengths.filter(t => leagueTeamSet.has(t.team_name));
  for (const name of schedule.teams) {
    if (!teams.find(t => t.team_name === name)) {
      teams.push({ team_name: name, attack: 1.0, defense: 1.0, form_mod: 1.0 });
    }
  }

  const mc = engine.monteCarloSeason(teams, schedule.fixtures, mu, simulations);
  return {
    season:     schedule.season_label,
    league_id:  leagueId,
    simulations,
    ...mc,
  };
}

/* ══════════════════════════════════════════════════════════════
   REAL STANDINGS — season-correct, no mixing
══════════════════════════════════════════════════════════════ */
async function realStandings(leagueId, seasonId) {
  return calc.calculateStrengths(leagueId, seasonId);
}


/* ══════════════════════════════════════════════════════════════
   BACKTEST v2 — Simulación de standings desde jornada de corte
   
   Lógica:
   1. Divide la temporada actual en entrenamiento (jornadas 1..N)
      y prueba (jornadas N+1..fin, partidos ya jugados)
   2. Construye fuerzas con: temporadas históricas (peso 2x)
      + 2025-2026 hasta el corte (peso 5x)  
   3. Calcula standings reales hasta el corte
   4. Para los partidos de prueba: usa expected pts (prob*3 + prob*1)
      para proyectar standings finales
   5. Compara tabla proyectada vs tabla real final
══════════════════════════════════════════════════════════════ */

function buildStandings(matches) {
  const s = {};
  const ensure = name => {
    if (!s[name]) s[name] = { team: name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 };
  };
  for (const m of matches) {
    ensure(m.home_team); ensure(m.away_team);
    const hg = Number(m.home_goals), ag = Number(m.away_goals);
    s[m.home_team].played++; s[m.away_team].played++;
    s[m.home_team].gf += hg; s[m.home_team].ga += ag;
    s[m.away_team].gf += ag; s[m.away_team].ga += hg;
    if (hg > ag)      { s[m.home_team].won++;  s[m.home_team].pts += 3; s[m.away_team].lost++; }
    else if (hg < ag) { s[m.away_team].won++;  s[m.away_team].pts += 3; s[m.home_team].lost++; }
    else              { s[m.home_team].drawn++; s[m.home_team].pts++;    s[m.away_team].drawn++; s[m.away_team].pts++; }
  }
  return s;
}

function sortStandings(map) {
  return Object.values(map).sort((a, b) =>
    (b.pts - a.pts) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf)
  ).map((t, i) => ({ ...t, gd: t.gf - t.ga, rank: i + 1 }));
}

async function backtestCurrentSeason(leagueId, cutoffRound = null) {
  /* ── Temporada actual ── */
  const [[seasonRow]] = await db.query(
    `SELECT season_id, season_name FROM seasons ORDER BY season_name DESC LIMIT 1`
  );
  const seasonId   = Number(seasonRow.season_id);
  const seasonName = seasonRow.season_name;

  /* ── Partidos jugados de la temporada actual ── */
  const REGULAR = `AND (m.match_round IS NULL OR m.match_round LIKE '%Regular%')`;
  const [allPlayed] = await db.query(`
    SELECT m.match_id, m.match_date, m.match_round,
           ht.team_name AS home_team, at.team_name AS away_team,
           m.home_goals, m.away_goals
    FROM matches m
    JOIN teams ht ON ht.team_id = m.home_team_id
    JOIN teams at ON at.team_id = m.away_team_id
    WHERE m.league_id = ? AND m.season_id = ?
      AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
      ${REGULAR}
    ORDER BY m.match_date ASC, m.match_id ASC
  `, [leagueId, seasonId]);

  if (!allPlayed.length) throw new Error('Sin partidos jugados en esta liga/temporada.');

  /* ── Orden de jornadas ──
     Si la liga no tiene match_round (La Liga, etc.), agrupa por ventanas de 5 días:
     partidos dentro del mismo período de 5 días = misma jornada.
     Así 38 jornadas reales = 38 entradas, no 144. */
  const hasRoundLabels = allPlayed.some(m => m.match_round);
  
  // Asignar jornada sintética agrupando por ventana de 5 días cuando no hay labels
  if (!hasRoundLabels) {
    let rndNum = 0, windowEnd = null;
    for (const m of allPlayed) {
      const d = new Date(m.match_date);
      if (!windowEnd || d > windowEnd) {
        rndNum++;
        windowEnd = new Date(d.getTime() + 5 * 86400000); // +5 days window
      }
      m.match_round = `J${rndNum}`;
    }
  }

  const roundOrder = []; const seen = new Set();
  for (const m of allPlayed) {
    const rnd = m.match_round;
    if (!seen.has(rnd)) { seen.add(rnd); roundOrder.push(rnd); }
  }
  const totalRounds = roundOrder.length;
  const midpoint = cutoffRound
    ? Math.min(Math.max(1, cutoffRound), totalRounds - 1)
    : Math.floor(totalRounds / 2);

  /* ── Partición entrenamiento / prueba ── */
  const trainMatches = allPlayed.filter(m => roundOrder.indexOf(m.match_round) < midpoint);
  const testMatches  = allPlayed.filter(m => roundOrder.indexOf(m.match_round) >= midpoint);

  if (!trainMatches.length) throw new Error('Sin datos de entrenamiento.');
  if (!testMatches.length)  throw new Error('Sin partidos de prueba (temporada incompleta en ese corte).');

  /* ── Fecha de corte ── */
  const cutoffDate = new Date(Math.max(...trainMatches.map(m => new Date(m.match_date))));
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 10);

  /* ── Fuerzas: histórico (peso 2) + 2025-26 hasta corte (peso 5) ── */
  const allSeasonIds    = await getAllSeasonIds();
  const histSeasonIds   = allSeasonIds.filter(id => id !== seasonId);
  const [histStr, currStr, mu] = await Promise.all([
    histSeasonIds.length ? calc.calculateHistoricalStrengths(leagueId, histSeasonIds) : Promise.resolve([]),
    calc.calculateStrengthsCutoff(leagueId, seasonId, cutoffDateStr),
    historicalMu(leagueId, allSeasonIds),
  ]);

  /* Blend: peso 5 para datos actuales (primera mitad), peso 2 para histórico */
  const teamMap = new Map();
  const addW = (name, data, w) => {
    if (!teamMap.has(name)) teamMap.set(name, { wAtk:0, wDef:0, wFm:0, wH:0, wA:0, wPpg:0, tw:0 });
    const e = teamMap.get(name);
    e.wAtk += data.attack   * w; e.wDef += data.defense  * w;
    e.wFm  += data.form_mod * w; e.wH   += data.home_win_pct * w;
    e.wA   += data.away_win_pct * w; e.wPpg += (data.ppg || 1.5) * w;
    e.tw += w;
  };
  for (const t of histStr) addW(t.team_name, t, 2);
  for (const t of currStr) addW(t.team_name, t, 5);

  const blendedStrengths = [];
  for (const [name, e] of teamMap) {
    blendedStrengths.push({
      team_name:    name,
      attack:       parseFloat((e.wAtk / e.tw).toFixed(4)),
      defense:      parseFloat((e.wDef / e.tw).toFixed(4)),
      form_mod:     parseFloat((e.wFm  / e.tw).toFixed(4)),
      home_win_pct: parseFloat((e.wH   / e.tw).toFixed(1)),
      away_win_pct: parseFloat((e.wA   / e.tw).toFixed(1)),
      ppg:          parseFloat((e.wPpg / e.tw).toFixed(3)),
    });
  }
  const strMap = new Map(blendedStrengths.map(t => [t.team_name, t]));

  /* ── Standings reales hasta el corte ── */
  const trainStd = buildStandings(trainMatches);

  /* ── Proyectar partidos de prueba con expected pts ── */
  const projStd = JSON.parse(JSON.stringify(trainStd)); // deep copy
  let correct_winner = 0, tested = 0;
  const matchRows = [];

  for (const m of testMatches) {
    const hs = strMap.get(m.home_team);
    const as_ = strMap.get(m.away_team);

    /* Ensure teams exist in projStd */
    if (!projStd[m.home_team]) projStd[m.home_team] = { team: m.home_team, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, pts:0 };
    if (!projStd[m.away_team]) projStd[m.away_team] = { team: m.away_team, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, pts:0 };

    if (!hs || !as_) {
      /* Sin fuerza → usa resultado real */
      const hg = Number(m.home_goals), ag = Number(m.away_goals);
      projStd[m.home_team].played++; projStd[m.away_team].played++;
      projStd[m.home_team].gf += hg; projStd[m.home_team].ga += ag;
      projStd[m.away_team].gf += ag; projStd[m.away_team].ga += hg;
      if (hg > ag)      { projStd[m.home_team].won++;  projStd[m.home_team].pts += 3; projStd[m.away_team].lost++; }
      else if (hg < ag) { projStd[m.away_team].won++;  projStd[m.away_team].pts += 3; projStd[m.home_team].lost++; }
      else              { projStd[m.home_team].drawn++; projStd[m.home_team].pts++;    projStd[m.away_team].drawn++; projStd[m.away_team].pts++; }
      continue;
    }

    const pred = engine.predictMatch(hs, as_, mu);
    const pH   = pred.prob_home / 100;
    const pD   = pred.prob_draw / 100;
    const pA   = pred.prob_away / 100;

    /* Expected points */
    const expH = pH * 3 + pD * 1;
    const expA = pA * 3 + pD * 1;
    projStd[m.home_team].played++;  projStd[m.away_team].played++;
    projStd[m.home_team].pts += expH; projStd[m.away_team].pts += expA;
    /* Expected goals for gd estimate */
    projStd[m.home_team].gf += pred.lambda_home; projStd[m.home_team].ga += pred.lambda_away;
    projStd[m.away_team].gf += pred.lambda_away; projStd[m.away_team].ga += pred.lambda_home;

    /* Track winner accuracy */
    const realWin = Number(m.home_goals) > Number(m.away_goals) ? 'H'
                  : Number(m.home_goals) < Number(m.away_goals) ? 'A' : 'D';
    const predWin = pH > pA && pH > pD ? 'H' : pA > pH && pA > pD ? 'A' : 'D';
    tested++;
    if (predWin === realWin) correct_winner++;

    matchRows.push({
      match_date: String(m.match_date).slice(0,10),
      round:      m.match_round || '—',
      home_team:  m.home_team,
      away_team:  m.away_team,
      real_home:  Number(m.home_goals),
      real_away:  Number(m.away_goals),
      pred_home:  Math.round(pred.lambda_home),
      pred_away:  Math.round(pred.lambda_away),
      real_winner: realWin,
      pred_winner: predWin,
      correct:    predWin === realWin,
      home_win_prob: pred.prob_home,
      draw_prob:     pred.prob_draw,
      away_win_prob: pred.prob_away,
    });
  }

  /* ── Tablas finales ── */
  const projFinal = sortStandings(projStd).map(t => ({
    ...t, pts: parseFloat(t.pts.toFixed(1)), gf: parseFloat(t.gf.toFixed(1)), ga: parseFloat(t.ga.toFixed(1)), gd: parseFloat((t.gf - t.ga).toFixed(1))
  }));
  const realFinal = sortStandings(buildStandings(allPlayed));

  /* Rank delta: proj_rank - real_rank */
  const realRankMap = new Map(realFinal.map(t => [t.team, t.rank]));
  projFinal.forEach(t => { t.real_rank = realRankMap.get(t.team) ?? '?'; t.rank_delta = t.rank - (t.real_rank === '?' ? t.rank : t.real_rank); });

  /* Rank accuracy: % teams within ±1 and ±3 */
  const within1 = projFinal.filter(t => t.real_rank !== '?' && Math.abs(t.rank_delta) <= 1).length;
  const within3 = projFinal.filter(t => t.real_rank !== '?' && Math.abs(t.rank_delta) <= 3).length;
  const ranked  = projFinal.filter(t => t.real_rank !== '?').length;
  const avgRankErr = ranked > 0
    ? parseFloat((projFinal.filter(t => t.real_rank !== '?').reduce((s, t) => s + Math.abs(t.rank_delta), 0) / ranked).toFixed(2))
    : 0;

  return {
    season:        seasonName,
    league_id:     leagueId,
    total_rounds:  totalRounds,
    train_rounds:  midpoint,
    test_rounds:   totalRounds - midpoint,
    cutoff_round:  roundOrder[midpoint - 1],
    cutoff_date:   cutoffDateStr,
    train_matches: trainMatches.length,
    test_matches:  testMatches.length,
    metrics: {
      accuracy_winner_pct: tested > 0 ? parseFloat((correct_winner / tested * 100).toFixed(1)) : 0,
      rank_within_1_pct:   ranked > 0 ? parseFloat((within1 / ranked * 100).toFixed(1)) : 0,
      rank_within_3_pct:   ranked > 0 ? parseFloat((within3 / ranked * 100).toFixed(1)) : 0,
      avg_rank_error:      avgRankErr,
    },
    projected_standings: projFinal,
    actual_standings:    realFinal,
    match_predictions:   matchRows,
  };
}

module.exports = {
  predictSingleMatch,
  simulateFutureSeason,
  monteCarloProbabilities,
  realStandings,
  backtestCurrentSeason,
  getNextSeasonYear,
  getMostRecentSeasonId,
};