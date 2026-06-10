const seasonsModel =
require('../models/seasonsModel');

async function getSeasons(req, res) {

    try {

        const seasons =
            await seasonsModel.getAllSeasons();

        res.json(seasons);

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

}

async function getSeasonsByLeague(req, res) {
    try {
        const seasons = await seasonsModel.getSeasonsByLeague(req.params.leagueId);
        res.json(seasons);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    getSeasons,
    getSeasonsByLeague,
};