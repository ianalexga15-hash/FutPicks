/* ═══════════════════════════════════════════════════════════════
   scheduleGenerator.js
   Genera calendarios futuros analizando patrones históricos.

   Detecta:
     - Número de jornadas por temporada
     - Días de semana más frecuentes
     - Separación entre jornadas
     - Estructura round-robin
═══════════════════════════════════════════════════════════════ */
'use strict';

const db = require('../config/db');

/* ── Analizar patrones de calendario ── */
async function analyzeCalendarPatterns(leagueId) {
  const [rows] = await db.query(`
    SELECT
      match_date,
      DAYOFWEEK(match_date) AS dow,
      season_id,
      COUNT(*) OVER (PARTITION BY season_id) AS season_total
    FROM matches
    WHERE league_id = ?
      AND match_date IS NOT NULL
    ORDER BY match_date
  `, [leagueId]);

  if (!rows.length) return { avgMatchdays: 38, preferredDow: [7, 1], matchInterval: 7 };

  // Días de semana más frecuentes (1=Dom, 7=Sáb en MySQL)
  const dowCount = {};
  for (const r of rows) {
    const d = Number(r.dow);
    dowCount[d] = (dowCount[d] || 0) + 1;
  }
  const preferredDow = Object.entries(dowCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([d]) => Number(d));

  // Promedio de partidos por temporada / equipos → jornadas
  const bySeasonCount = new Map();
  for (const r of rows) {
    bySeasonCount.set(r.season_id, Number(r.season_total));
  }
  const matchCounts = [...bySeasonCount.values()];
  const avgMatches  = matchCounts.reduce((s, v) => s + v, 0) / (matchCounts.length || 1);

  // Intervalo promedio entre fechas de la misma temporada
  const dates = rows.map(r => new Date(r.match_date)).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < Math.min(dates.length, 50); i++) {
    const diff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
    if (diff > 0 && diff < 21) intervals.push(diff);
  }
  const matchInterval = intervals.length
    ? Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length)
    : 7;

  // Teams per season
  const [teamRows] = await db.query(`
    SELECT season_id, COUNT(DISTINCT home_team_id) AS n FROM matches WHERE league_id = ? GROUP BY season_id
  `, [leagueId]);
  const teamCounts = teamRows.map(r => Number(r.n)).filter(n => n > 0);
  const avgTeams   = teamCounts.length
    ? Math.round(teamCounts.reduce((s, v) => s + v, 0) / teamCounts.length)
    : 20;

  // Jornadas = (teams - 1) * 2 en liga regular
  const matchdays = (avgTeams - 1) * 2;

  return {
    avgMatchdays:  matchdays,
    avgTeams,
    preferredDow,
    matchInterval: Math.max(6, matchInterval),
    avgMatches,
  };
}

/* ── Obtener equipos de una liga (temporada más reciente) ── */
async function getLeagueTeams(leagueId, seasonId) {
  const [rows] = await db.query(`
    SELECT DISTINCT t.team_name
    FROM teams t
    JOIN (
      SELECT home_team_id AS tid FROM matches WHERE league_id = ? AND season_id = ?
      UNION
      SELECT away_team_id FROM matches WHERE league_id = ? AND season_id = ?
    ) x ON x.tid = t.team_id
    ORDER BY t.team_name
  `, [leagueId, seasonId, leagueId, seasonId]);
  return rows.map(r => r.team_name);
}

/* ── Generar round-robin doble ── */
function generateRoundRobin(teams) {
  const n      = teams.length;
  const rounds = (n % 2 === 0 ? n - 1 : n) * 2;
  const list   = [...teams];
  if (n % 2 !== 0) list.push('__BYE__');
  const m = list.length;
  const fixtures = [];

  for (let r = 0; r < m - 1; r++) {
    const roundHome = [];
    const roundAway = [];
    for (let i = 0; i < m / 2; i++) {
      const home = list[i];
      const away = list[m - 1 - i];
      if (home !== '__BYE__' && away !== '__BYE__') {
        roundHome.push({ matchday: r + 1,            home_team: home, away_team: away });
        roundAway.push({ matchday: r + 1 + (m - 1), home_team: away, away_team: home });
      }
    }
    fixtures.push(...roundHome, ...roundAway);
    // Rotar: fija el primer elemento, rota el resto
    list.splice(1, 0, list.pop());
  }

  return fixtures.sort((a, b) => a.matchday - b.matchday);
}

/* ── Asignar fechas reales a los fixtures ── */
function assignDates(fixtures, startDate, preferredDow, matchInterval) {
  let current  = new Date(startDate);
  let matchday = 1;
  const byMatchday = new Map();

  for (const f of fixtures) {
    if (!byMatchday.has(f.matchday)) byMatchday.set(f.matchday, []);
    byMatchday.get(f.matchday).push(f);
  }

  const out = [];
  const days = [...byMatchday.keys()].sort((a, b) => a - b);

  for (const day of days) {
    // Avanzar al próximo día preferido
    let candidate = new Date(current);
    for (let i = 0; i < 14; i++) {
      const dow = candidate.getDay() + 1; // convertir a MySQL DAYOFWEEK (1=Dom)
      if (preferredDow.includes(dow)) break;
      candidate.setDate(candidate.getDate() + 1);
    }

    const dateStr = candidate.toISOString().split('T')[0];
    for (const f of byMatchday.get(day)) {
      out.push({ ...f, match_date: dateStr });
    }

    // Siguiente jornada
    current = new Date(candidate);
    current.setDate(current.getDate() + matchInterval);
  }

  return out;
}

/* ── FUNCIÓN PRINCIPAL ────────────────────────────────────────
   Genera el calendario completo de una temporada futura.
   seasonYear: 'YYYY' del año de inicio (ej. 2026 para 2026-2027)
──────────────────────────────────────────────────────────────── */
async function generateFutureSchedule(leagueId, recentSeasonId, seasonYear) {
  const [patterns, teams] = await Promise.all([
    analyzeCalendarPatterns(leagueId),
    getLeagueTeams(leagueId, recentSeasonId),
  ]);

  if (!teams.length) throw new Error('No se encontraron equipos para la liga/temporada dada.');

  const fixtures  = generateRoundRobin(teams);
  const startDate = `${seasonYear}-08-10`; // inicio típico agosto
  const scheduled = assignDates(fixtures, startDate, patterns.preferredDow, patterns.matchInterval);

  return {
    season_label: `${seasonYear}/${Number(seasonYear) + 1}`,
    teams,
    total_matchdays: Math.max(...fixtures.map(f => f.matchday)),
    total_fixtures:  fixtures.length,
    fixtures:        scheduled,
    patterns,
  };
}

module.exports = { generateFutureSchedule, getLeagueTeams, analyzeCalendarPatterns };