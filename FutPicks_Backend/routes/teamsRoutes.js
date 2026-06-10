const express = require('express');
const router = express.Router();
const teamsController  = require('../controllers/teamsController');
const statsController  = require('../controllers/statsController');

router.get('/', teamsController.getTeams);

// These routes start with /teams/... and must live here,
// otherwise the /api/teams mount shadows them from statsRoutes.
router.get('/league/:leagueId',                statsController.getTeamsByLeague);
router.get('/league/:leagueId/season/:seasonId', statsController.getTeamsByLeagueSeason);

module.exports = router;
