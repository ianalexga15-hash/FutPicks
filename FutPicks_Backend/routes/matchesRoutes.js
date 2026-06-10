const express = require('express');
const router = express.Router();
const matchesController = require('../controllers/matchesController');
const statsController   = require('../controllers/statsController');

router.get('/', matchesController.getMatches);

// These routes start with /matches/... and must live here,
// otherwise the /api/matches mount shadows them from statsRoutes.
router.get('/league/:leagueId',                  statsController.getMatchesByLeague);
router.get('/league/:leagueId/season/:seasonId', statsController.getMatchesByLeagueSeason);

module.exports = router;
