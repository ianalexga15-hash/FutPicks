const express = require('express');
const router = express.Router();
const playersController = require('../controllers/playersController');
const statsController   = require('../controllers/statsController');

router.get('/', playersController.getPlayers);
router.get('/team/:teamName/season/:seasonId',       statsController.getTeamKeyPlayers);
router.get('/team/:teamName/season/:seasonId/cards', statsController.getTeamCardPlayers);

module.exports = router;
