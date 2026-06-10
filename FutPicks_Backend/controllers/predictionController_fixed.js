/* ═══════════════════════════════════════════════════════════════
   controllers/predictionController.js — FIXED
═══════════════════════════════════════════════════════════════ */
'use strict';
const pm = require('../models/predictionModel');

const wrap = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { console.error('[Prediction]', e.message); res.status(500).json({ error: e.message }); }
};

/* GET /api/predict/match/:leagueId/:home/:away */
const predictMatch = wrap(async req => {
  const { leagueId, home, away } = req.params;
  return pm.predictSingleMatch(Number(leagueId), decodeURIComponent(home), decodeURIComponent(away));
});

/* GET /api/predict/season/:leagueId/:year?round=N */
const predictSeason = wrap(async req => {
  const { leagueId, year } = req.params;
  const round = req.query.round ? Number(req.query.round) : null;
  return pm.simulateFutureSeason(Number(leagueId), year, round);
});

/* GET /api/predict/montecarlo/:leagueId/:year?sims=N */
const predictMonteCarlo = wrap(async req => {
  const { leagueId, year } = req.params;
  const sims = Math.min(Number(req.query.sims || 500), 2000);
  return pm.monteCarloProbabilities(Number(leagueId), year, sims);
});

/* GET /api/predict/standings/:leagueId/:seasonId */
const realStandings = wrap(async req => {
  const { leagueId, seasonId } = req.params;
  return pm.realStandings(Number(leagueId), Number(seasonId));
});

/* GET /api/predict/next-season-year
   Returns the year string for the next future season.
   Frontend uses this to populate the simulator dropdown. */
const nextSeasonYear = wrap(async () => {
  const year = await pm.getNextSeasonYear();
  return { year };
});

module.exports = { predictMatch, predictSeason, predictMonteCarlo, realStandings, nextSeasonYear };