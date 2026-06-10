/* ═══════════════════════════════════════════════════════════════
   routes/predictionRoutes.js — FutPicks AI FINAL
═══════════════════════════════════════════════════════════════ */
const express = require('express');
const router  = express.Router();
const c       = require('../controllers/predictionController');

/* Must be before /:leagueId routes to avoid param capture */
router.get('/next-season-year',              c.nextSeasonYear);

router.get('/match/:leagueId/:home/:away',   c.predictMatch);
router.get('/season/:leagueId/:year',        c.predictSeason);
router.get('/montecarlo/:leagueId/:year',    c.predictMonteCarlo);
router.get('/standings/:leagueId/:seasonId', c.realStandings);

router.get('/backtest/:leagueId',           c.backtestSeason);

module.exports = router;