const express = require('express');

const router = express.Router();

const seasonsController =
require('../controllers/seasonsController');

router.get('/', seasonsController.getSeasons);

/* Returns only seasons with actual match data for a specific league */
router.get('/league/:leagueId', seasonsController.getSeasonsByLeague);

module.exports = router;