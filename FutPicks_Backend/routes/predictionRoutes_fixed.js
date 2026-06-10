/* ═══════════════════════════════════════════════════════════════
   routes/predictionRoutes.js — FIXED
═══════════════════════════════════════════════════════════════ */
const express = require('express');
const router  = express.Router();
const c       = require('../controllers/predictionController');

router.get('/next-season-year',              c.nextSeasonYear);   // ← NEW
router.get('/match/:leagueId/:home/:away',   c.predictMatch);
router.get('/season/:leagueId/:year',        c.predictSeason);
router.get('/montecarlo/:leagueId/:year',    c.predictMonteCarlo);
router.get('/standings/:leagueId/:seasonId', c.realStandings);

module.exports = router;