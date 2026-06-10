/* ═══════════════════════════════════════════════════════════════
   predictionModel.js — FIXED
   
   DB SEASON MAPPING (your actual database):
     season_id 1 → 2025_2026  ← MOST RECENT
     season_id 2 → 2024_2025
     season_id 3 → 2023_2024
     season_id 4 → 2022_2023
     season_id 5 → 2021_2022  ← OLDEST
   
   FIX: Never use Math.max(season_ids) to find most recent season.
        Sort by season_name descending to find the actual latest.
═══════════════════════════════════════════════════════════════ */
'use strict';

const db        = require('../config/db');
const calc      = require('../services/teamStrengthCalculator');
const engine    = require('../services/predictionEngine');
const scheduler = require('../services/scheduleGenerator');

/* ── All season IDs from DB ── */
async function getAllSeasonIds() {
  const [rows] = await db.query(`SELECT season_id FROM seasons ORDER BY season_id ASC`);
  return rows.map(r => Number(r.season_id));
}

/* ── Get the MOST RECENT season by season_name (not by ID) ──
   Sort '2025_2026' > '2024_2025' > ... lexicographically.
   This works because the format is YYYY_YYYY and year strings sort correctly. */
async function getMostRecentSeasonId() {
  const [rows] = await db.query(`
    SELECT season_id, season_name
    FROM seasons
    ORDER BY season_name DESC
    LIMIT 1
  `);
  return rows[0] ? Number(rows[0].season_id) : null;
}

/* ── Get all seasons sorted by name desc (most recent first) ── */
async function getAllSeasonsSorted() {
  const [rows] = await db.query(`
    SELECT season_id, season_name
    FROM seasons
    ORDER BY season_name DESC
  `);
  return rows;
}

/* ── Historical mu (league avg goals) ── */
async function historicalMu(leagueId, seasonIds) {
  if (!seasonIds.length) return 1.35;
  const placeholders = seasonIds.map(() => '?').join(',');
  const [rows] = await db.query(`
    SELECT ROUND(AVG(half), 4) AS mu
    FROM (
      SELECT home_goals AS half FROM matches WHERE league_id = ? AND season_id IN (${placeholders})
      UNION ALL
      SELECT away_goals FROM matches WHERE league_id = ? AND season_id IN (${placeholders})
    ) x
  `, [leagueId, ...seasonIds, leagueId, ...seasonIds]);
  return parseFloat(rows[0]?.mu) || 1.35;
}

/* ── Get the start year for the NEXT season after most recent ──
   If most recent is '2025_2026', next season starts 2026. */
async function getNextSeasonYear() {
  const [rows] = await db.query(`
    SELECT season_name FROM seasons ORDER BY season_name DESC LIMIT 1
  `);
  if (!rows[0]) return '2026';
  // '2025_2026' → split → ['2025','2026'] → take [1] → '2026'
  const parts = rows[0].season_name.split('_');
  return parts[1] || String(Number(parts[0]) + 1);
}

/* ══════════════════════════════════════════════════════════════
   SINGLE MATCH PREDICTION
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
   SEASON SIMULATION
   Uses most-recent season ID (by name, not by ID number)
   to get teams for the future schedule.
══════════════════════════════════════════════════════════════ */
async function simulateFutureSeason(leagueId, targetSeasonYear, targetRound = null) {
  const [seasonIds, recentSeasonId] = await Promise.all([
    getAllSeasonIds(),
    getMostRecentSeasonId(),  // ← FIXED: by name not by Math.max
  ]);

  const [strengths, mu, schedule] = await Promise.all([
    calc.calculateHistoricalStrengths(leagueId, seasonIds),
    historicalMu(leagueId, seasonIds),
    scheduler.generateFutureSchedule(leagueId, recentSeasonId, targetSeasonYear),
  ]);

  if (!schedule.teams.length) throw new Error('Sin equipos para simular.');

  const leagueTeamSet = new Set(schedule.teams);
  const teams = strengths.filter(t => leagueTeamSet.has(t.team_name));

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
    data_source:     `${seasonIds.length} temporadas históricas`,
    model:           'Dixon-Coles Poisson + Monte Carlo v1',
    ...simulation,
  };
}

/* ══════════════════════════════════════════════════════════════
   MONTE CARLO
══════════════════════════════════════════════════════════════ */
async function monteCarloProbabilities(leagueId, targetSeasonYear, simulations = 500) {
  const [seasonIds, recentSeasonId] = await Promise.all([
    getAllSeasonIds(),
    getMostRecentSeasonId(),  // ← FIXED
  ]);

  const [strengths, mu, schedule] = await Promise.all([
    calc.calculateHistoricalStrengths(leagueId, seasonIds),
    historicalMu(leagueId, seasonIds),
    scheduler.generateFutureSchedule(leagueId, recentSeasonId, targetSeasonYear),
  ]);

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
   REAL STANDINGS (season-correct, no mixing)
══════════════════════════════════════════════════════════════ */
async function realStandings(leagueId, seasonId) {
  return calc.calculateStrengths(leagueId, seasonId);
}

/* ══════════════════════════════════════════════════════════════
   EXPORT next season year (for frontend)
══════════════════════════════════════════════════════════════ */
module.exports = {
  predictSingleMatch,
  simulateFutureSeason,
  monteCarloProbabilities,
  realStandings,
  getNextSeasonYear,       // ← NEW export for frontend
  getMostRecentSeasonId,   // ← NEW export
};