const leaguesModel =
require('../models/leaguesModel');

async function getLeagues(req, res) {

    try {

        const leagues =
            await leaguesModel.getAllLeagues();

        res.json(leagues);

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

}

module.exports = {
    getLeagues
};