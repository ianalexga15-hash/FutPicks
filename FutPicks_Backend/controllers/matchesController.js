const matchesModel =
require('../models/matchesModel');

async function getMatches(req, res) {

    try {

        const matches =
            await matchesModel.getAllMatches();

        res.json(matches);

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

}

module.exports = {
    getMatches
};