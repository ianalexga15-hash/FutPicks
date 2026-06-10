const express = require('express');

const router = express.Router();

const leaguesController =
require('../controllers/leaguesController');

router.get(
    '/',
    leaguesController.getLeagues
);

module.exports = router;